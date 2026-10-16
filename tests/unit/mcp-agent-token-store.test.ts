// packages/mcp-server/src/permissions/agent-token-store.ts (nuevo): los
// tres backends del store de tokens de agentes MCP (identidad por
// invocacion, Opcion B). D1 con fake sobre better-sqlite3, SQLite real
// sobre archivo temporal (el DDL esta en schema.sql, que applySchema ya
// aplico -- y el constructor de SqliteMcpAgentTokenStore tambien lo
// aplica por si sola), e InMemory. Contrato: issue rota (un solo token
// activo por agentKeyId), verify devuelve identidad o null, revoke corta
// por agente, list nunca expone hashes ni plaintexts, y el plaintext NO
// se persiste (solo su hash sha256).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../../scripts/setup.mjs";
import {
  D1McpAgentTokenStore,
  SqliteMcpAgentTokenStore,
  InMemoryMcpAgentTokenStore,
  createMcpAgentTokenStore,
  __resetMcpAgentTokenStoreFactoryForTests,
  hashMcpAgentToken,
  generateMcpAgentToken,
} from "../../packages/mcp-server/src/permissions/agent-token-store";
import type { McpAgentTokenStore } from "../../packages/mcp-server/src/permissions/agent-token-store";

const tmp = mkdtempSync(join(tmpdir(), "portaless-mcp-agent-tokens-"));

// El schema se aplica UNA vez a una plantilla en beforeAll (hook, 10s de
// presupuesto) y cada test D1 copia el archivo. Antes cada make() aplicaba el
// schema.sql completo dentro del test: en un runner lento eso roza el timeout
// de 5s por defecto y el test se cae por tiempo, no por contrato. El resto del
// repo ya usa este patron (beforeAll + applySchema).
let d1Template = "";
beforeAll(async () => {
  d1Template = join(tmp, "d1-template.db");
  await applySchema(d1Template, { quiet: true });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function fakeD1(database: any) {
  return {
    prepare(sql: string) {
      const stmt = database.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            run: async () => {
              const info = stmt.run(...(args as never[]));
              return { success: true, meta: { changes: Number(info.changes) } };
            },
            first: async () => stmt.get(...(args as never[])) ?? null,
            all: async () => ({ results: stmt.all(...(args as never[])) }),
          };
        },
      };
    },
  };
}

function backends(): Array<{ name: string; make: () => Promise<McpAgentTokenStore> }> {
  return [
    {
      name: "D1",
      make: async () => {
        const file = join(tmp, `d1-${Math.random().toString(36).slice(2)}.db`);
        copyFileSync(d1Template, file);
        const db = new Database(file);
        return new D1McpAgentTokenStore(fakeD1(db));
      },
    },
    {
      name: "SQLite",
      make: async () => SqliteMcpAgentTokenStore.open(join(tmp, `sqlite-${Math.random().toString(36).slice(2)}.db`)),
    },
    { name: "InMemory", make: async () => new InMemoryMcpAgentTokenStore() },
  ];
}

describe("McpAgentTokenStore -- contrato en los tres backends", () => {
  for (const backend of backends()) {
    describe(backend.name, () => {
      it("issue emite token pless_mcp_ verificable que devuelve la identidad registrada", async () => {
        const store = await backend.make();
        const { token, record } = await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "Agente A" });

        expect(token.startsWith("pless_mcp_")).toBe(true);
        expect(record).toMatchObject({ agentKeyId: "ed25519:agente-a", displayName: "Agente A", revoked: false });

        const identity = await store.verify(token);
        expect(identity).toEqual({ agentKeyId: "ed25519:agente-a", displayName: "Agente A" });
      });

      it("verify devuelve null para token desconocido", async () => {
        const store = await backend.make();
        await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "Agente A" });
        expect(await store.verify("pless_mcp_nunca-emitido")).toBeNull();
        expect(await store.verify("")).toBeNull();
      });

      it("issue rota: el token anterior queda revocado y solo el nuevo verifica", async () => {
        const store = await backend.make();
        const first = await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "Agente A" });
        const second = await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "Agente A v2" });

        expect(second.token).not.toBe(first.token);
        expect(await store.verify(first.token)).toBeNull();
        expect(await store.verify(second.token)).toEqual({
          agentKeyId: "ed25519:agente-a",
          displayName: "Agente A v2",
        });
      });

      it("revoke corta todos los tokens activos del agente (true si habia), sin tocar a otros", async () => {
        const store = await backend.make();
        const a = await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "A" });
        const b = await store.issue({ agentKeyId: "ed25519:agente-b", displayName: "B" });

        expect(await store.revoke("ed25519:agente-a")).toBe(true);
        expect(await store.verify(a.token)).toBeNull();
        expect(await store.verify(b.token)).toEqual({ agentKeyId: "ed25519:agente-b", displayName: "B" });

        expect(await store.revoke("ed25519:agente-a")).toBe(false); // ya no quedaba activo
        expect(await store.revoke("ed25519:agente-inexistente")).toBe(false);
      });

      it("list devuelve registros marcando revoked, y NUNCA expone token ni hash", async () => {
        const store = await backend.make();
        await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "A" });
        const rotated = await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "A" });
        await store.issue({ agentKeyId: "ed25519:agente-b", displayName: "B" });

        const records = await store.list();
        expect(records).toHaveLength(3);
        const revoked = records.filter((r) => r.revoked);
        const active = records.filter((r) => !r.revoked);
        expect(revoked).toHaveLength(1);
        expect(active).toHaveLength(2);
        expect(active.map((r) => r.agentKeyId).sort()).toEqual(["ed25519:agente-a", "ed25519:agente-b"]);
        expect(active.find((r) => r.agentKeyId === "ed25519:agente-a")).toBeDefined();

        for (const record of records) {
          expect(record).not.toHaveProperty("token");
          expect(record).not.toHaveProperty("tokenHash");
          expect(JSON.stringify(record)).not.toContain(rotated.token);
        }
      });
    });
  }
});

describe("McpAgentTokenStore -- hash-only storage (SQLite real)", () => {
  it("el plaintext del token NO se persiste: la fila guarda solo el sha256", async () => {
    const file = join(tmp, `plaintext-${Math.random().toString(36).slice(2)}.db`);
    const store = await SqliteMcpAgentTokenStore.open(file);
    const { token } = await store.issue({ agentKeyId: "ed25519:agente-a", displayName: "A" });
    store.close();

    const db = new Database(file);
    const rows = db.prepare("SELECT * FROM mcp_agent_tokens").all() as Array<Record<string, unknown>>;
    db.close();

    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(await hashMcpAgentToken(token));
    expect(rows[0].token_hash).not.toBe(token);

    const tableDump = JSON.stringify(rows);
    expect(tableDump).not.toContain(token);
    expect(tableDump).not.toContain("pless_mcp_");
  });
});

describe("generateMcpAgentToken", () => {
  it("genera tokens unicos en el formato esperado", () => {
    const a = generateMcpAgentToken();
    const b = generateMcpAgentToken();
    expect(a).toMatch(/^pless_mcp_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("createMcpAgentTokenStore (factory)", () => {
  it("sin DB ni ruta cae a InMemory con warning explicito", async () => {
    __resetMcpAgentTokenStoreFactoryForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = await createMcpAgentTokenStore({});
      expect(store).toBeInstanceOf(InMemoryMcpAgentTokenStore);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("tokens de agentes MCP en memoria"));
    } finally {
      warn.mockRestore();
      __resetMcpAgentTokenStoreFactoryForTests();
    }
  });

  it("con PORTALESS_SQLITE_PATH devuelve SQLite y cachea por ruta", async () => {
    __resetMcpAgentTokenStoreFactoryForTests();
    const file = join(tmp, `factory-${Math.random().toString(36).slice(2)}.db`);
    try {
      const first = await createMcpAgentTokenStore({ PORTALESS_SQLITE_PATH: file });
      const second = await createMcpAgentTokenStore({ PORTALESS_SQLITE_PATH: file });
      expect(first).toBeInstanceOf(SqliteMcpAgentTokenStore);
      expect(second).toBe(first);
    } finally {
      __resetMcpAgentTokenStoreFactoryForTests();
    }
  });
});
