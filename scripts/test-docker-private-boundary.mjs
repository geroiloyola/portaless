#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const id = randomBytes(8).toString("hex");
const marker = `PORTALESS_PRIVATE_DOCKER_MARKER_${id}`;
const tag = process.argv[2] ?? `portaless-private-boundary:${id}`;
const createdFiles = [];
const createdDirs = [];

function writeFixture(relativePath, contents) {
  const target = path.join(ROOT, relativePath);
  if (!target.startsWith(`${ROOT}${path.sep}`)) throw new Error("fixture path escaped repo root");
  const parent = path.dirname(target);
  let current = ROOT;
  for (const component of path.relative(ROOT, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe fixture parent: ${current}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      fs.mkdirSync(current);
      createdDirs.push(current);
    }
  }
  fs.writeFileSync(target, contents, { flag: "wx", mode: 0o600 });
  createdFiles.push(target);
}

try {
  writeFixture(`.airchive/${id}.txt`, marker);
  writeFixture(`.env.private-${id}`, `PRIVATE_MARKER=${marker}\n`);
  writeFixture(`private-${id}.db`, marker);
  writeFixture(`private-${id}.pem`, marker);
  writeFixture(`backups/private-${id}.sqlite`, marker);
  writeFixture(`src/content/pages/private-docker-${id}.json`, JSON.stringify({ slug: `private-docker-${id}`, status: "private", title: marker }));
  writeFixture(`src/content/posts/private-docker-${id}.md`, `---\ntitle: Private\npubDate: 2026-01-01\ndraft: true\n---\n${marker}`);
  writeFixture(`docs/private-docker-${id}.md`, marker);

  execFileSync("docker", ["build", "-t", tag, ROOT], { stdio: "inherit" });
  execFileSync("docker", [
    "run", "--rm", "--entrypoint", "node", tag,
    "scripts/verify-private-artifacts.mjs", "/app", "--marker", marker, "--skip-node-modules",
  ], { stdio: "inherit" });
  console.log("Docker image excluded synthetic .airchive, env, database, key and backup markers.");
} finally {
  for (const file of createdFiles.reverse()) fs.rmSync(file, { force: true });
  for (const directory of createdDirs.reverse()) {
    try { fs.rmdirSync(directory); } catch { /* keep non-empty/pre-existing directories */ }
  }
}
