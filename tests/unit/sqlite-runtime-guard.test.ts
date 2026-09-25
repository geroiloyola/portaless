// v0.0.9.27: dentro de workerd, openSqlite() debe fallar con un mensaje
// arquitectonico claro ANTES de importar el binario nativo.
import { describe, it, expect, afterEach, vi } from "vitest";
import { openSqlite, isWorkerdRuntime } from "../../packages/sqlite-driver/src/open";

afterEach(() => vi.unstubAllGlobals());

describe("guardia de runtime de openSqlite", () => {
  it("en Node no detecta workerd", () => {
    expect(isWorkerdRuntime()).toBe(false);
  });

  it("simulando workerd, falla con mensaje claro que menciona D1", async () => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(isWorkerdRuntime()).toBe(true);
    await expect(openSqlite("/tmp/x.db")).rejects.toThrow(/no puede ejecutarse en Cloudflare Pages Functions.*D1/s);
  });
});
