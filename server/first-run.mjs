// server/first-run.mjs -- Primer arranque seguro para Portaless self-hosted (Node).
//
// Ver .airchive/project_memory/adr-002-first-run-trust-root.md y
// adr-003-generated-volume-secrets.md.
//
// Este modulo SOLO se usa desde el runtime Node (scripts/start-docker.mjs).
// Nunca se importa desde functions/: el servicio llega a los handlers como
// env.__PORTALESS_FIRST_RUN, asi Cloudflare Pages no carga node:fs ni SQLite.
//
// Garantias:
//   - El setup code se persiste solo como hash SHA-256 con sal; nunca en claro
//     dentro de portaless-secrets.json.
//   - Expira a los 60 minutos y admite 5 intentos fallidos.
//   - Se consume una sola vez: tras crear el admin, el hash se borra, se marca
//     consumed=true y se elimina SETUP_CODE.txt. consumed nunca vuelve a false.
//   - Si ya existe cualquier usuario, el setup queda deshabilitado.
//   - Las respuestas no distinguen entre codigo incorrecto, vencido o agotado.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const STATE_FILE = "portaless-secrets.json";
export const SETUP_CODE_FILE = "SETUP_CODE.txt";
export const STATE_VERSION = 1;
export const SETUP_TTL_MS = 60 * 60 * 1000;
export const SETUP_MAX_ATTEMPTS = 5;
export const MIN_PASSWORD_LENGTH = 12;
const KEY_ENV = "PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

export function generateSetupCode(length = 8) {
  let code = "";
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function normalizeSetupCode(code) {
  return String(code ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
}

function hashCode(code, salt) {
  return createHash("sha256").update(salt).update(":").update(normalizeSetupCode(code)).digest("hex");
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), "hex");
  const y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

// Base64 ESTANDAR (no base64url): site-identity-store.ts decodifica con atob().
export function generateEncryptionKey() {
  return randomBytes(32).toString("base64");
}

function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch {}
}

async function defaultUsersStoreFactory(sqlitePath) {
  const { SqliteUsersStore } = await import("../packages/auth/src/stores/sqlite-users-store.ts");
  return SqliteUsersStore.open(sqlitePath);
}

async function defaultEnsureInitialAdmin(store, username, password) {
  const { ensureInitialAdmin } = await import("../packages/auth/src/users-store.ts");
  return ensureInitialAdmin(store, username, password);
}

async function defaultApplySchema(sqlitePath) {
  const { applySchema } = await import("../scripts/setup.mjs");
  return applySchema(sqlitePath, { quiet: true });
}

export function createFirstRunService(options = {}) {
  const env = options.env || process.env;
  const sqlitePath = resolve(options.sqlitePath || env.PORTALESS_SQLITE_PATH || "/data/portaless.db");
  const dataDir = resolve(options.dataDir || env.PORTALESS_DATA_DIR || dirname(sqlitePath));
  const statePath = join(dataDir, STATE_FILE);
  const codePath = join(dataDir, SETUP_CODE_FILE);
  const now = options.now || (() => Date.now());
  const log = options.log || ((line) => console.log(line));
  const openUsersStore = options.usersStoreFactory || defaultUsersStoreFactory;
  const createAdmin = options.ensureInitialAdmin || defaultEnsureInitialAdmin;
  const applySchema = options.applySchema || defaultApplySchema;

  let state = null;
  let keySource = null;
  let queue = Promise.resolve();
  const serialize = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  function loadState() {
    if (!existsSync(statePath)) return { version: STATE_VERSION, setup: { consumed: false } };
    const parsed = JSON.parse(readFileSync(statePath, "utf-8"));
    if (parsed?.version !== STATE_VERSION) throw new Error(`${STATE_FILE}: version no soportada (${parsed?.version}).`);
    parsed.setup = parsed.setup || { consumed: false };
    return parsed;
  }
  const saveState = () => writeJsonAtomic(statePath, state);

  async function countUsers() {
    const store = await openUsersStore(sqlitePath);
    try { return (await store.listUsers()).length; } finally { store.close?.(); }
  }

  async function prepare() {
    mkdirSync(dataDir, { recursive: true });
    state = loadState();

    // Clave de cifrado: la variable de entorno tiene prioridad y NUNCA se copia al volumen.
    let encryptionKey;
    if (env[KEY_ENV]) {
      encryptionKey = env[KEY_ENV];
      keySource = "environment";
    } else {
      if (!state.siteIdentityEncryptionKey) state.siteIdentityEncryptionKey = generateEncryptionKey();
      encryptionKey = state.siteIdentityEncryptionKey;
      keySource = "generated-volume";
    }
    state.siteIdentityKeySource = keySource;

    await applySchema(sqlitePath);
    const users = await countUsers();

    if (users > 0 || state.setup.consumed) {
      state.setup = { consumed: true };
      rmSync(codePath, { force: true });
      saveState();
      return { needsSetup: false, envPatch: { [KEY_ENV]: encryptionKey } };
    }

    const fromPlatform = Boolean(env.PORTALESS_SETUP_CODE);
    const code = fromPlatform ? normalizeSetupCode(env.PORTALESS_SETUP_CODE) : generateSetupCode();
    const salt = randomBytes(16).toString("hex");
    state.setup = {
      consumed: false,
      salt,
      codeHash: hashCode(code, salt),
      expiresAt: new Date(now() + SETUP_TTL_MS).toISOString(),
      attemptsRemaining: SETUP_MAX_ATTEMPTS,
      source: fromPlatform ? "environment" : "generated",
    };
    saveState();

    if (fromPlatform) {
      rmSync(codePath, { force: true });
      log("[Portaless] Setup pendiente. Usa el PORTALESS_SETUP_CODE configurado en tu plataforma en /setup (vence en 60 minutos).");
    } else {
      writeFileSync(codePath, code + "\n", { mode: 0o600 });
      log("[Portaless] ================================================================");
      log(`[Portaless] CODIGO DE CONFIGURACION: ${code}`);
      log("[Portaless] Abrilo en /setup. Vence en 60 minutos y admite 5 intentos.");
      log(`[Portaless] Tambien quedo en ${codePath} y se borra al completar el setup.`);
      log("[Portaless] ================================================================");
    }
    if (keySource === "generated-volume") {
      log(`[Portaless] AVISO: ${KEY_ENV} se genero dentro del volumen de datos. Configurala como secreto de la plataforma y respaldala por separado.`);
    }
    return { needsSetup: true, envPatch: { [KEY_ENV]: encryptionKey } };
  }

  function status() {
    return { needsSetup: Boolean(state && !state.setup.consumed), keySourceWarning: keySource === "generated-volume" };
  }

  function complete(input) {
    return serialize(async () => {
      if (!state) return { status: 503, body: { success: false, error: "setup_not_ready" } };
      if (state.setup.consumed || (await countUsers()) > 0) {
        return { status: 410, body: { success: false, error: "setup_disabled" } };
      }

      const username = typeof input?.username === "string" ? input.username.trim() : "";
      const password = typeof input?.password === "string" ? input.password : "";
      if (!USERNAME_RE.test(username)) {
        return { status: 400, body: { success: false, error: "invalid_username", message: "Usuario de 3 a 32 caracteres: letras, numeros, punto, guion o guion bajo." } };
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return { status: 400, body: { success: false, error: "weak_password", message: `La contrasena debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` } };
      }

      const setup = state.setup;
      const expired = !setup.expiresAt || now() > Date.parse(setup.expiresAt);
      const exhausted = !(setup.attemptsRemaining > 0);
      const matches = !expired && !exhausted && safeEqualHex(hashCode(input?.code, setup.salt), setup.codeHash);
      if (!matches) {
        if (!expired && !exhausted) {
          setup.attemptsRemaining -= 1;
          saveState();
        }
        return { status: 403, body: { success: false, error: "invalid_setup_code" } };
      }

      const store = await openUsersStore(sqlitePath);
      try {
        await createAdmin(store, username, password);
        const created = await store.findByUsername(username);
        if (!created || created.role !== "admin") throw new Error("El admin no quedo persistido.");
      } finally {
        store.close?.();
      }

      state.setup = { consumed: true, completedAt: new Date(now()).toISOString() };
      saveState();
      rmSync(codePath, { force: true });
      log(`[Portaless] Setup completado: admin "${username}" creado. El codigo de configuracion quedo invalidado.`);
      return { status: 201, body: { success: true, redirect: "/admin/login" } };
    });
  }

  return { prepare, status, complete, paths: { sqlitePath, dataDir, statePath, codePath } };
}
