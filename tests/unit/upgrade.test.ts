// Test de upgrade (local + el mismo camino que corre upgrade.yml en CI):
// sembrar una base "de un tag anterior" (scripts/make-db-snapshot), migrarla
// con el codigo ACTUAL y verificar que los datos siguen intactos y el sitio
// arranca. La logica de verificacion vive en scripts/verify-upgrade.mjs para
// que CI y este test corran EXACTAMENTE lo mismo.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "../..");
const tsx = join(root, "node_modules/tsx/dist/cli.mjs");

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "portaless-upgrade-"));
  cleanup.push(dir);
  return join(dir, "snapshot.db");
}

describe("upgrade: snapshot de un tag anterior -> migrar a HEAD", () => {
  it("sembrar, migrar y verificar conserva los datos y arranca", () => {
    const db = tempDb();

    // 1. Sembrar (lo mismo que corre CI con el arbol del tag).
    execFileSync(process.execPath, [tsx, join(root, "scripts/make-db-snapshot.mjs"), db], {
      cwd: root,
      stdio: "pipe",
    });
    expect(existsSync(db)).toBe(true);

    // 2. Migrar con HEAD + verificar (lo mismo que verify-upgrade en CI).
    const out = execFileSync(process.execPath, [tsx, join(root, "scripts/verify-upgrade.mjs"), db], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toContain("v1 -> v9");
    expect(out).toContain("[upgrade] backup:");
    expect(out).toContain("[upgrade] OK");
  });
});
