// v0.0.9.27: logica pura de setup:d1 (sin invocar Wrangler).
import { describe, it, expect } from "vitest";
import { parseArgs, sqlStr, buildAdminInsertSql } from "../../scripts/setup-d1.mjs";

describe("setup:d1", () => {
  it("exige --db y un destino explicito", () => {
    expect(() => parseArgs(["--local"])).toThrow(/--db/);
    expect(() => parseArgs(["--db", "x"])).toThrow(/--local o --remote/);
    expect(() => parseArgs(["--db", "x", "--local", "--remote"])).toThrow(/solo uno/);
  });

  it("parsea config y persist-to", () => {
    expect(parseArgs(["--db", "p", "--local", "-c", "w.toml", "--persist-to", ".st"])).toEqual({
      db: "p", mode: "--local", config: "w.toml", persistTo: ".st",
    });
  });

  it("escapa comillas simples en literales SQL", () => {
    expect(sqlStr("a'b")).toBe("'a''b'");
  });

  it("rechaza usernames que podrian inyectar SQL", () => {
    expect(() => buildAdminInsertSql("x'); DROP TABLE users;--", "h", "t")).toThrow(/invalido/);
  });

  it("el INSERT fija role='admin' y no contiene la contraseña en claro", () => {
    const sql = buildAdminInsertSql("admin", "scrypt$abc", "2026-09-25T00:00:00.000Z");
    expect(sql).toContain("'admin', '2026-09-25T00:00:00.000Z'");
    expect(sql).toContain("'scrypt$abc'");
  });
});
