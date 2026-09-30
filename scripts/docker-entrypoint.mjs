#!/usr/bin/env node
// scripts/docker-entrypoint.mjs -- PID 1 del contenedor (ADR-004).
//
// Railway y Render montan los volumenes persistentes como root, asi que un
// proceso que arranca directamente como `node` no puede escribir en /data.
// En vez de correr todo como root (RAILWAY_RUN_UID=0), este entrypoint:
//   1. Si corre como root, asigna /data al usuario no privilegiado (UID 1000).
//   2. Lanza el servidor (tsx scripts/start-docker.mjs) como ese usuario.
//   3. Reenvia SIGTERM/SIGINT y sale con el mismo codigo que el servidor.
// Solo usa modulos de Node: la imagen slim no trae gosu ni su-exec.

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { chownSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const uid = Number(process.env.PORTALESS_RUN_UID || 1000);
const gid = Number(process.env.PORTALESS_RUN_GID || 1000);
const sqlitePath = process.env.PORTALESS_SQLITE_PATH || "/data/portaless.db";
const dataDir = resolve(process.env.PORTALESS_DATA_DIR || dirname(sqlitePath));

function chownTree(path) {
  const stat = lstatSync(path);
  if (stat.uid !== uid || stat.gid !== gid) chownSync(path, uid, gid);
  if (stat.isDirectory()) for (const entry of readdirSync(path)) chownTree(join(path, entry));
}

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
if (isRoot) {
  mkdirSync(dataDir, { recursive: true });
  chownTree(dataDir);
}

const tsx = join(rootDir, "node_modules", ".bin", "tsx");
if (!existsSync(tsx)) {
  console.error("[Portaless] No se encontro tsx en node_modules/.bin. Debe estar en dependencies.");
  process.exit(1);
}

const child = spawn(tsx, [join(rootDir, "scripts", "start-docker.mjs")], {
  stdio: "inherit",
  env: isRoot ? { ...process.env, HOME: "/home/node", USER: "node" } : process.env,
  ...(isRoot ? { uid, gid } : {}),
});

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => { if (!child.killed) child.kill(signal); });
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1)));
child.on("error", (error) => {
  console.error("[Portaless] No se pudo iniciar el servidor:", error.message);
  process.exit(1);
});
