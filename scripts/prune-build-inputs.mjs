import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUILD_ONLY_PATHS = [".astro", "docs", "src/content/pages", "src/content/posts"];

export function pruneBuildInputs(rootDir) {
  const root = path.resolve(rootDir);
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
    throw new Error(`Invalid runtime application root: ${root}`);
  }
  for (const relative of BUILD_ONLY_PATHS) {
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Refusing to prune outside app root: ${relative}`);
    if (!fs.existsSync(target)) continue;
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error(`Refusing to prune symlink: ${relative}`);
    fs.rmSync(target, { recursive: true, force: false });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root || process.argv.length !== 3) {
    console.error("Usage: node scripts/prune-build-inputs.mjs <app-root>");
    process.exit(2);
  }
  pruneBuildInputs(root);
}
