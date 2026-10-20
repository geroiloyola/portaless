#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const marker = `PORTALESS_PRIVATE_PACKAGE_MARKER_${randomBytes(8).toString("hex")}`;
const archiveDir = path.join(ROOT, ".airchive");
const createdDir = !fs.existsSync(archiveDir);
const markerFile = path.join(archiveDir, `${marker}.txt`);

try {
  if (fs.existsSync(archiveDir) && (fs.lstatSync(archiveDir).isSymbolicLink() || !fs.lstatSync(archiveDir).isDirectory())) {
    throw new Error(".airchive must be a real directory for the synthetic pack boundary check.");
  }
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(markerFile, marker, { flag: "wx", mode: 0o600 });
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const packed = JSON.parse(output);
  const files = packed[0]?.files ?? [];
  const forbidden = files.filter((file) => {
    const components = file.path.split("/");
    return components.some((component) =>
      component === ".airchive" || component === ".kilo" || component === "backups" ||
      component === "data" || component === "credentials.json" || component === "config.json" ||
      component === "portaless-secrets.json" || component === ".npmrc" || component === "SETUP_CODE.txt" ||
      /^service-account.*\.json$/i.test(component) ||
      /^\.env(?:\..+)?$/i.test(component) && component !== ".env.example" ||
      /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i.test(component) ||
      /\.(?:db|sqlite|sqlite3|pem|key|p12|pfx|crt|secret|token)(?:[-.].*)?$/i.test(component)
    );
  });
  if (forbidden.length || files.some((file) => file.path.includes(marker))) {
    throw new Error(`npm package contains private files: ${forbidden.map((file) => file.path).join(", ")}`);
  }
  console.log(`npm source package excludes private inputs (${packed[0].entryCount} files checked).`);
} finally {
  fs.rmSync(markerFile, { force: true });
  if (createdDir) {
    try { fs.rmdirSync(archiveDir); } catch { /* preserve unrelated files */ }
  }
}
