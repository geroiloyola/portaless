// Fixtures locales y desechables para staging/QA. No usan Docker, red externa,
// home del usuario ni credenciales reales. Cada instancia obtiene un directorio
// nuevo bajo el temp del sistema y servicios fake ligados exclusivamente a
// 127.0.0.1.
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import net from "node:net";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, lstat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER_FILE = ".portaless-staging-owner.json";
const MARKER_KIND = "portaless-disposable-staging-v1";
const ID_RE = /^[a-f0-9]{24}$/;
// Los specs del navegador usan el username contractual `admin` tras cambiar y
// restaurar la contraseña; sigue siendo una cuenta efímera dentro del staging.
export const STAGING_ADMIN_USER = "admin";
export const STAGING_ADMIN_PASSWORD = "Synthetic-Staging-Only-42!";
export const STAGING_ADMIN_EMAIL = "staging-admin@example.invalid";
export const STAGING_VIEWER_USER = "staging-viewer";
export const STAGING_VIEWER_PASSWORD = "Synthetic-Viewer-Only-37!";
export const STAGING_PUBLIC_MARKER = "PORTALESS_PUBLIC_STAGING_MARKER_7E191C";
export const STAGING_DRAFT_MARKER = "PORTALESS_PRIVATE_DRAFT_MARKER_2A810D";
export const STAGING_ARCHIVE_MARKER = "PORTALESS_PRIVATE_ARCHIVE_MARKER_5B0F31";
export const STAGING_SECRET_MARKER = "PORTALESS_SYNTHETIC_SECRET_MARKER_9C280A";

function makeHttpServer() {
  const requests = [];
  const server = createHttpServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
    }
    // Captura solo en memoria para assertions. Nunca escribe headers/body a logs.
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.writeHead(204, { connection: "close" }).end();
  });
  return { server, requests };
}

function makeSmtpServer() {
  const messages = [];
  const commands = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    socket.write("220 portaless staging SMTP\r\n");
    let commandBuffer = "";
    let dataBuffer = "";
    let inData = false;
    socket.on("data", (chunk) => {
      if (inData) {
        dataBuffer += chunk;
        const end = dataBuffer.indexOf("\r\n.\r\n");
        if (end >= 0) {
          messages.push(dataBuffer.slice(0, end));
          dataBuffer = "";
          inData = false;
          socket.write("250 2.0.0 synthetic message accepted\r\n");
        }
        return;
      }
      commandBuffer += chunk;
      let boundary;
      while ((boundary = commandBuffer.indexOf("\r\n")) >= 0) {
        const line = commandBuffer.slice(0, boundary);
        commandBuffer = commandBuffer.slice(boundary + 2);
        const command = line.split(" ", 1)[0].toUpperCase();
        commands.push(command);
        if (command === "EHLO" || command === "HELO") {
          // Multiline reply is intentional: exercise the same parser as a server.
          socket.write("250-staging.local\r\n250 SIZE 1048576\r\n");
        } else if (command === "MAIL" || command === "RCPT") {
          socket.write("250 2.1.0 OK\r\n");
        } else if (command === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command === "QUIT") {
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
        } else {
          socket.write("502 5.5.1 command not supported\r\n");
        }
      }
    });
  });
  return { server, messages, commands, sockets };
}

async function listenLoopback(server, kind) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error(`${kind} fake did not bind a TCP port`);
  return address.port;
}

async function closeServer(server, sockets = []) {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function assertOwnedStage(stageDir, expectedId, rootReal) {
  const stageReal = await realpath(stageDir);
  if (dirname(stageReal) !== rootReal) throw new Error("Refusing cleanup: stage is not a direct child of the staging root.");
  if (!stageReal.startsWith(rootReal + sep)) throw new Error("Refusing cleanup outside staging root.");
  const stageStat = await lstat(stageDir);
  if (!stageStat.isDirectory() || stageStat.isSymbolicLink()) throw new Error("Refusing cleanup: stage is not a real directory.");
  const markerPath = join(stageReal, MARKER_FILE);
  const markerStat = await lstat(markerPath).catch(() => null);
  if (!markerStat) throw new Error("Refusing cleanup: ownership marker is missing.");
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error("Refusing cleanup: ownership marker is not a regular file.");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  if (marker.kind !== MARKER_KIND || marker.id !== expectedId) throw new Error("Refusing cleanup: staging ownership marker mismatch.");
}

/**
 * Crea servicios fake y una DB completamente sintética.
 * `rootDir` se expone para pruebas que crean su propio tmp-root; los CLIs no
 * aceptan un path arbitrario y usan el directorio temporal del sistema.
 */
export async function createDisposableStaging({
  rootDir = join(tmpdir(), "portaless-disposable-staging"),
  seed = true,
  startFakes = true,
} = {}) {
  await mkdir(rootDir, { recursive: true, mode: 0o700 });
  const rootReal = await realpath(rootDir);
  const id = randomBytes(12).toString("hex");
  const stageDir = await mkdtemp(join(rootReal, `stage-${id}-`));
  const stageReal = await realpath(stageDir);
  const marker = { kind: MARKER_KIND, id, nonce: randomBytes(24).toString("hex"), createdAt: new Date().toISOString() };
  await writeFile(join(stageReal, MARKER_FILE), JSON.stringify(marker), { mode: 0o600, flag: "wx" });
  await mkdir(join(stageReal, "data"), { mode: 0o700 });
  await mkdir(join(stageReal, "workspace"), { mode: 0o700 });

  const webhook = makeHttpServer();
  const smtp = makeSmtpServer();
  let webhookPort;
  let smtpPort;
  let closed = false;
  try {
    if (startFakes) {
      webhookPort = await listenLoopback(webhook.server, "webhook");
      smtpPort = await listenLoopback(smtp.server, "SMTP");
    }
    const dbPath = join(stageReal, "data", "portaless.sqlite");
    const encryptionKey = randomBytes(32).toString("base64");
    const syntheticToken = `STAGING-WEBHOOK-${id}`;
    const env = {
      HOST: "127.0.0.1",
      PORT: "0",
      PORTALESS_SQLITE_PATH: dbPath,
      PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: encryptionKey,
      PORTALESS_PLUGIN_EMAIL_DAILY_LIMIT: "3",
    };

    if (seed) {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
      const { applySchema } = await import(join(root, "scripts/setup.mjs"));
      await applySchema(dbPath, { quiet: true });

      const { createUsersStore } = await import(join(root, "packages/auth/src/store-factory.ts"));
      const users = await createUsersStore(env);
      await users.createUser(STAGING_ADMIN_USER, STAGING_ADMIN_PASSWORD, "admin", STAGING_ADMIN_EMAIL);
      await users.createUser(STAGING_VIEWER_USER, STAGING_VIEWER_PASSWORD, "viewer");
      await users.close?.();

      const { createSiteIdentityStore } = await import(join(root, "packages/apw-resolver/src/did-apw/store-factory.ts"));
      const { generateApwDid } = await import(join(root, "packages/apw-resolver/src/did-apw/generate.ts"));
      const identityStore = await createSiteIdentityStore(env);
      await identityStore.create("default", await generateApwDid(`staging-${id}.example.invalid`), STAGING_ADMIN_USER);
      await identityStore.close?.();

      const { createPageStore } = await import(join(root, "packages/atomic-elements/src/persistence/store-factory.ts"));
      const pages = await createPageStore(env);
      await pages.save({
        version: "0.1", slug: "staging-public", title: "Synthetic public staging page",
        status: "published", root: [{ id: "pub", type: "Paragraph", props: { text: STAGING_PUBLIC_MARKER } }],
      });
      await pages.save({
        version: "0.1", slug: "staging-draft", title: STAGING_DRAFT_MARKER,
        status: "draft", root: [{ id: "draft", type: "Paragraph", props: { text: STAGING_DRAFT_MARKER } }],
      });
      await pages.save({
        version: "0.1", slug: "staging-private", title: STAGING_ARCHIVE_MARKER,
        status: "private", root: [{ id: "private", type: "Paragraph", props: { text: STAGING_ARCHIVE_MARKER } }],
      });
      await pages.close?.();

      const { createSiteSettingsStore } = await import(join(root, "packages/dashboard/src/site-settings/site-settings-store.ts"));
      const { emailSettingsToValues, sanitizeEmailInput } = await import(join(root, "packages/email-transport/src/config.ts"));
      // The normal config validator correctly rejects loopback webhook URLs.
      // Keep the production config disabled in staging; tests exercise the
      // loopback fake directly through sendViaWebhook, never through a bypass
      // flag in production validation.
      const settings = sanitizeEmailInput({ provider: { kind: "none" }, from: "staging@example.invalid", templates: [] });
      if (settings.rejected.length) throw new Error(`Invalid synthetic email config: ${settings.rejected.join("; ")}`);
      const siteSettings = await createSiteSettingsStore(env);
      await siteSettings.setMany({
        ...emailSettingsToValues(settings.settings),
        "staging.synthetic_secret": syntheticToken,
      });
      await siteSettings.close?.();
      await writeFile(join(stageReal, "workspace", ".airchive-synthetic.md"), `${STAGING_ARCHIVE_MARKER}\n`, { mode: 0o600, flag: "wx" });
      await writeFile(join(stageReal, "workspace", ".env.synthetic"), `${STAGING_SECRET_MARKER}=${syntheticToken}\n`, { mode: 0o600, flag: "wx" });
    }

    const close = async ({ destroy = true } = {}) => {
      if (closed) return;
      closed = true;
      await Promise.all([
        closeServer(webhook.server),
        closeServer(smtp.server, [...smtp.sockets]),
      ]);
      if (destroy) await destroyDisposableStaging({ id, rootDir: rootReal });
    };

    return {
      id,
      rootDir: rootReal,
      stageDir: stageReal,
      dbPath: join(stageReal, "data", "portaless.sqlite"),
      workspaceDir: join(stageReal, "workspace"),
      env,
      synthetic: {
        adminUser: STAGING_ADMIN_USER,
        adminPassword: STAGING_ADMIN_PASSWORD,
        webhookToken: syntheticToken,
        publicMarker: STAGING_PUBLIC_MARKER,
        draftMarker: STAGING_DRAFT_MARKER,
        archiveMarker: STAGING_ARCHIVE_MARKER,
        secretMarker: STAGING_SECRET_MARKER,
      },
      services: {
        webhookUrl: webhookPort ? `http://127.0.0.1:${webhookPort}/capture` : null,
        webhookRequests: webhook.requests,
        smtpPort,
        smtpMessages: smtp.messages,
        smtpCommands: smtp.commands,
      },
      close,
    };
  } catch (error) {
    await Promise.all([
      closeServer(webhook.server),
      closeServer(smtp.server, [...smtp.sockets]),
    ]);
    await destroyDisposableStaging({ id, rootDir: rootReal }).catch(() => {});
    throw error;
  }
}

/** Devuelve la ruta de una fixture solo tras validar ID, confinamiento y marker. */
export async function locateDisposableStaging({ id, rootDir = join(tmpdir(), "portaless-disposable-staging") } = {}) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error("Invalid staging ID; cleanup requires the generated 24-hex ID.");
  const rootReal = await realpath(rootDir);
  const prefix = `stage-${id}-`;
  const names = await (await import("node:fs/promises")).readdir(rootReal, { withFileTypes: true });
  const matches = names.filter((entry) => entry.name.startsWith(prefix));
  if (matches.length !== 1 || !matches[0].isDirectory() || matches[0].isSymbolicLink()) {
    throw new Error("Refusing cleanup: expected exactly one owned staging directory.");
  }
  const target = join(rootReal, matches[0].name);
  await assertOwnedStage(target, id, rootReal);
  return target;
}

/** Destruye SOLO una fixture con ID válido y ownership marker coincidente. */
export async function destroyDisposableStaging({ id, rootDir = join(tmpdir(), "portaless-disposable-staging") } = {}) {
  const target = await locateDisposableStaging({ id, rootDir });
  await rm(target, { recursive: true, force: false, maxRetries: 0 });
}

export async function destroyDisposableStagingById(id) {
  return destroyDisposableStaging({ id });
}

/** Best-effort synchronous cleanup for process `exit` handlers (no async hooks). */
export function destroyDisposableStagingSync({ id, rootDir = join(tmpdir(), "portaless-disposable-staging") } = {}) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error("Invalid staging ID; cleanup requires the generated 24-hex ID.");
  const rootReal = realpathSync(rootDir);
  const prefix = `stage-${id}-`;
  const matches = readdirSync(rootReal, { withFileTypes: true }).filter((entry) => entry.name.startsWith(prefix));
  if (matches.length !== 1 || !matches[0].isDirectory() || matches[0].isSymbolicLink()) {
    throw new Error("Refusing cleanup: expected exactly one owned staging directory.");
  }
  const target = join(rootReal, matches[0].name);
  const targetReal = realpathSync(target);
  if (dirname(targetReal) !== rootReal || !targetReal.startsWith(rootReal + sep)) throw new Error("Refusing cleanup outside staging root.");
  const markerPath = join(targetReal, MARKER_FILE);
  if (!existsSync(markerPath)) throw new Error("Refusing cleanup: ownership marker is missing.");
  const markerStat = lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error("Refusing cleanup: ownership marker is not a regular file.");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (marker.kind !== MARKER_KIND || marker.id !== id) throw new Error("Refusing cleanup: staging ownership marker mismatch.");
  rmSync(targetReal, { recursive: true, force: false, maxRetries: 0 });
}
