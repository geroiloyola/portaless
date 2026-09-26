#!/usr/bin/env node
// setup:d1 -- v0.0.9.27. Crea el schema y el admin inicial en Cloudflare D1
// (local de Miniflare o remoto) usando SOLO la CLI de Wrangler.
//
// Por que CLI y no un endpoint HTTP: un endpoint que cree el primer admin sin
// sesion previa permite que el primero que encuentre la URL de un deploy
// recien publicado se adueñe del sitio. Via Wrangler, solo puede hacerlo
// quien ya tiene credenciales sobre la cuenta de Cloudflare -- el mismo nivel
// de confianza que desplegar.
//
// Uso:
//   npm run setup:d1 -- --db portaless-local --local -c wrangler.local.toml --persist-to .wrangler/state
//   npm run setup:d1 -- --db portaless --remote
//
// Variables: PORTALESS_ADMIN_USERNAME (default "admin"), PORTALESS_ADMIN_PASSWORD
// (si falta, se genera y se imprime UNA vez). La contraseña nunca viaja a
// Wrangler: solo el hash, y via archivo temporal 0600 (no en argv, visible en ps).

import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const USERNAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

export function parseArgs(argv) {
  const out = { db: null, mode: null, config: null, persistTo: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = argv[++i];
    else if (a === "--local" || a === "--remote") {
      if (out.mode) throw new Error("Usa solo uno: --local o --remote");
      out.mode = a;
    } else if (a === "-c" || a === "--config") out.config = argv[++i];
    else if (a === "--persist-to") out.persistTo = argv[++i];
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (!out.db) throw new Error("Falta --db <NOMBRE_DB_D1>");
  if (!out.mode) throw new Error("Falta --local o --remote (sin default: el destino debe ser explicito)");
  return out;
}

export const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function buildAdminInsertSql(username, passwordHash, createdAt) {
  if (!USERNAME_RE.test(username)) throw new Error(`Username invalido: "${username}"`);
  return (
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (" +
    `${sqlStr(username)}, ${sqlStr(passwordHash)}, 'admin', ${sqlStr(createdAt)});`
  );
}

function wrangler(opts, extra, { json = false } = {}) {
  const args = ["wrangler", "d1", "execute", opts.db, opts.mode, ...extra];
  if (opts.config) args.push("-c", opts.config);
  if (opts.persistTo && opts.mode === "--local") args.push("--persist-to", opts.persistTo);
  if (json) args.push("--json");
  return execFileSync("npx", args, { cwd: rootDir, encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });
}

function queryRows(opts, sql) {
  const parsed = JSON.parse(wrangler(opts, ["--command", sql], { json: true }));
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const username = process.env.PORTALESS_ADMIN_USERNAME || "admin";
  if (!USERNAME_RE.test(username)) throw new Error(`PORTALESS_ADMIN_USERNAME invalido: "${username}"`);

  console.log(`Portaless -- setup D1 (${opts.db}, ${opts.mode})`);

  console.log("\n[1/3] Aplicando schema.sql ...");
  wrangler(opts, [`--file=${join(rootDir, "schema.sql")}`]);

  console.log("\n[2/3] Creando admin inicial si no existe ningun usuario ...");
  const existing = Number(queryRows(opts, "SELECT count(*) AS n FROM users")[0]?.n ?? 0);
  if (existing > 0) {
    console.log(`      SKIP -- ya existen ${existing} usuario(s). No se crea un admin nuevo.`);
    return;
  }

  const password = process.env.PORTALESS_ADMIN_PASSWORD || randomBytes(18).toString("base64url");
  const { hashPassword } = await import("../packages/auth/src/password.ts");
  const hash = await hashPassword(password);

  const dir = mkdtempSync(join(tmpdir(), "portaless-setup-d1-"));
  const file = join(dir, "admin.sql");
  try {
    writeFileSync(file, buildAdminInsertSql(username, hash, new Date().toISOString()), { mode: 0o600 });
    wrangler(opts, [`--file=${file}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("\n[3/3] Verificando persistencia en D1 ...");
  const n = Number(
    queryRows(opts, `SELECT count(*) AS n FROM users WHERE username = ${sqlStr(username)} AND role = 'admin'`)[0]?.n ?? 0
  );
  if (n !== 1) {
    throw new Error(`El admin "${username}" NO quedo persistido en D1 (${opts.db}). No se imprime la contraseña.`);
  }

  console.log(`      OK -- admin "${username}" persistido y verificado en D1.`);
  if (!process.env.PORTALESS_ADMIN_PASSWORD) {
    console.log("\n      ================================================================");
    console.log("      CONTRASEÑA GENERADA (guardala ahora, no se muestra de nuevo):");
    console.log(`      ${password}`);
    console.log("      ================================================================\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("\nFallo setup:d1:", err.message);
    process.exit(1);
  });
}
