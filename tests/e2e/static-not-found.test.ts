import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSelfHostServer } from "../../server/node-runtime.mjs";

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

async function boot(with404Page: boolean) {
  const root = mkdtempSync(join(tmpdir(), "portaless-404-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "docs"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "home");
  writeFileSync(join(dist, "docs", "index.html"), "docs");
  if (with404Page) writeFileSync(join(dist, "404.html"), "pagina-no-encontrada");
  const server = await createSelfHostServer({ rootDir: root, functionsDir: join(root, "functions"), staticDir: dist, env: {} });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", () => ok()); });
  const address = server.address();
  cleanup.push(() => server.close());
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

describe("paginas no encontradas en el runtime Node", () => {
  it("sirve 404.html con status 404", async () => {
    const base = await boot(true);
    const res = await fetch(base + "/no-existe");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("pagina-no-encontrada");
  });

  it("las paginas existentes siguen respondiendo 200", async () => {
    const base = await boot(true);
    expect((await fetch(base + "/")).status).toBe(200);
    expect((await fetch(base + "/docs")).status).toBe(200);
  });

  it("sin 404.html responde 404 en texto plano", async () => {
    const base = await boot(false);
    const res = await fetch(base + "/no-existe");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });
});
