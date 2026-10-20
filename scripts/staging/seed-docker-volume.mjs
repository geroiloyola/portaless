import fs from "node:fs";
import path from "node:path";

const databaseSource = "/seed-data/portaless.sqlite";
const privateSource = "/seed-private";
const dataRoot = "/data";
if (!fs.existsSync(databaseSource)) throw new Error("Synthetic staging database missing.");
fs.mkdirSync(dataRoot, { recursive: true });
fs.copyFileSync(databaseSource, path.join(dataRoot, "portaless.sqlite"), fs.constants.COPYFILE_EXCL);
const privateTarget = path.join(dataRoot, "private-archive");
fs.mkdirSync(privateTarget, { recursive: true, mode: 0o700 });
for (const name of [".airchive-synthetic.md", ".env.synthetic"]) {
  const source = path.join(privateSource, name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(privateTarget, name), fs.constants.COPYFILE_EXCL);
}
console.log("seeded only synthetic SQLite and private archive fixtures into the owned volume");
