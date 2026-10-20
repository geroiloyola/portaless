import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const markerIndex = process.argv.indexOf("--marker");
const marker = markerIndex >= 0 ? process.argv[markerIndex + 1] : null;
const skipNodeModules = process.argv.includes("--skip-node-modules");
const deniedComponents = new Set([".airchive", ".kilo", ".git", ".ssh", ".aws", ".gnupg", "backups", "data"]);
const deniedFiles = [
  /^\.env(?:\..+)?$/i,
  /^portaless-secrets\.json$/i,
  /^setup_code\.txt$/i,
  /^credentials\.json$/i,
  /^service-account.*\.json$/i,
  /^config\.json$/i,
  /^\.npmrc$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /^.*\.(?:db|sqlite|sqlite3)(?:[-.].*)?$/i,
  /^.*\.(?:pem|key|p12|pfx|crt)$/i,
  /^.*\.(?:secret|token)$/i,
];
const markerBytes = marker ? Buffer.from(marker) : null;
const failures = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skipNodeModules && entry.name === "node_modules") continue;
    const filename = path.join(directory, entry.name);
    const relative = path.relative(root, filename).split(path.sep).join("/");
    const components = relative.split("/");
    if (components.some((component) => deniedComponents.has(component))) {
      failures.push(`private path: ${relative}`);
      continue;
    }
    if (entry.isSymbolicLink()) {
      failures.push(`symlink in distribution: ${relative}`);
      continue;
    }
    if (deniedFiles.some((pattern) => pattern.test(entry.name)) && entry.name !== ".env.example") {
      failures.push(`private file: ${relative}`);
      continue;
    }
    if (entry.isDirectory()) {
      walk(filename);
    } else if (entry.isFile() && markerBytes) {
      const contents = fs.readFileSync(filename);
      if (contents.includes(markerBytes)) failures.push(`private marker found in: ${relative}`);
    }
  }
}

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Distribution root missing: ${root}`);
walk(root);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Private-artifact scan passed: ${root}`);
