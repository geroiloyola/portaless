// packages/plugin-sandbox/src/registry/stores/capability-token-store.ts
// (26 lineas sin cubrir a ~51%): los tres backends del store de tokens
// efimeros del Capability Bridge. D1 con fake sobre better-sqlite3,
// SQLite real sobre archivo temporal (el DDL esta en schema.sql, que
// applySchema ya aplico), e InMemory. Contrato: issue registra el
// snapshot de capacidades; validate reutilizable dentro del TTL (no es
// consume); tokens vencidos razonan "expired" y deleteExpired los borra.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../../scripts/setup.mjs";
import {
  D1CapabilityTokenStore,
  SqliteCapabilityTokenStore,
  InMemoryCapabilityTokenStore,
} from "../../packages/plugin-sandbox/src/registry/stores/capability-token-store";
import type { CapabilityTokenStore } from "../../packages/plugin-sandbox/src/registry/stores/capability-token-store";

const tmp = mkdtempSync(join(tmpdir(), "portaless-cap-tokens-"));

// El schema (27 fuentes) se aplica UNA vez a una plantilla; cada backend copia
// el archivo. Antes cada make() aplicaba el schema completo dentro del test y
// rozaba el timeout de 5s bajo carga de CI (mismo patron que 187db77/757b408).
let TEMPLATE: string;
beforeAll(async () => {
  TEMPLATE = join(tmp, "template.db");
  await applySchema(TEMPLATE, { quiet: true });
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

function backends(): Array<{ name: string; make: () => Promise<CapabilityTokenStore> }> {
  return [
    {
      name: "D1",
      make: async () => {
        const file = join(tmp, `d1-${Math.random().toString(36).slice(2)}.db`);
        copyFileSync(TEMPLATE, file);
        const db = new Database(file);
        return new D1CapabilityTokenStore(fakeD1(db));
      },
    },
    {
      name: "SQLite",
      make: async () => {
        const file = join(tmp, `sqlite-${Math.random().toString(36).slice(2)}.db`);
        copyFileSync(TEMPLATE, file);
        const db = new Database(file);
        return new SqliteCapabilityTokenStore(db);
      },
    },
    { name: "InMemory", make: async () => new InMemoryCapabilityTokenStore() },
  ];
}

for (const backend of backends()) {
  describe(`CapabilityTokenStore (${backend.name})`, () => {
    it("issue + validate: snapshot de capacidades y reutilizable dentro del TTL", async () => {
      const store = await backend.make();
      const issued = await store.issue("pless_tok_1", "commerce-plugin", ["content:read", "network:fetch"]);
      expect(issued).toMatchObject({ token: "pless_tok_1", pluginName: "commerce-plugin" });
      expect(issued.grantedCapabilities).toEqual(["content:read", "network:fetch"]);
      expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.parse(issued.issuedAt));

      const valid = await store.validate("pless_tok_1");
      expect(valid.valid).toBe(true);
      expect(valid.pluginName).toBe("commerce-plugin");
      expect(valid.grantedCapabilities).toEqual(["content:read", "network:fetch"]);
      // No es consume: una segunda llamada sigue valida.
      expect((await store.validate("pless_tok_1")).valid).toBe(true);
    });

    it("validate razona not_found y expired; deleteExpired borra solo vencidos", async () => {
      // La GC probabilistica de issue() (Math.random < 0.1) podria borrar el
      // token vencido antes de nuestra llamada explicita -- se fuerza random
      // alto para que el conteo de deleteExpired sea determinista.
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
      try {
        const store = await backend.make();
        expect(await store.validate("no-existe")).toEqual({ valid: false, reason: "not_found" });

        // Ojo: en InMemory, validate() de un token vencido lo BORRA del map
        // (D1/SQLite solo razonan expired). Primero se mide deleteExpired sin
        // haber validado antes, y despues se cubre la rama expired de validate.
        await store.issue("pless_viejo", "p", ["content:read"], -10);
        await store.issue("pless_fresco", "p", ["content:read"], 300);
        const deleted = await store.deleteExpired(new Date().toISOString());
        expect(deleted).toBe(1);
        expect((await store.validate("pless_fresco")).valid).toBe(true);

        await store.issue("pless_viejo2", "p", ["content:read"], -10);
        expect(await store.validate("pless_viejo2")).toEqual({ valid: false, reason: "expired" });
      } finally {
        randomSpy.mockRestore();
      }
    });

    it("el snapshot de capacidades pertenece al plugin emitido (scope por pluginName)", async () => {
      const store = await backend.make();
      await store.issue("pless_scoped", "plugin-a", ["content:read"]);
      const valid = await store.validate("pless_scoped");
      expect(valid.pluginName).toBe("plugin-a");
      expect(valid.grantedCapabilities).toEqual(["content:read"]);
    });
  });
}
