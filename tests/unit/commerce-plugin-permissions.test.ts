// v0.0.9.30: el commerce-plugin respeta el Centro de Permisos. El
// adaptador isolated-vm se reemplaza por un doble que registra que
// capacidades recibio (sin levantar un isolate real), y el PermissionStore
// por uno en memoria controlado por el test. manifest.json y
// plugin-entry.js son los reales.
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  grants: [] as { subject: { type: string; id: string }; capabilityId: string; granted: boolean }[],
  queried: [] as { type: string; id: string }[],
  executed: [] as Set<string>[],
}));

vi.mock("../../packages/plugin-sandbox/src/adapters/node-isolated-vm", () => ({
  NodeIsolatedVmAdapter: class {
    poolStats = { idle: 0, live: 0, max: 4 };
    async isAvailable() {
      return true;
    }
    async execute(input: { granted: Set<string> }) {
      state.executed.push(new Set(input.granted));
      return { success: true, output: [], deniedCapabilityAttempts: [], durationMs: 1, provider: "fake" };
    }
    disposePool() {}
  },
}));

vi.mock("../../packages/permissions/src/store-factory", () => ({
  createPermissionStore: async () => ({
    getGrantsFor: async (subject: { type: string; id: string }) => {
      state.queried.push({ type: subject.type, id: subject.id });
      return state.grants.filter((g) => g.subject.type === subject.type && g.subject.id === subject.id);
    },
  }),
}));

import {
  sandboxedFetchProducts,
  sandboxedIsCommerceEnabled,
  __resetCommerceAdapterForTests,
} from "../../packages/commerce-plugin/src/host-bridge";

const config = { medusaUrl: "https://tienda.test" };
const subject = { type: "plugin", id: "commerce-plugin" };

beforeEach(() => {
  __resetCommerceAdapterForTests();
  state.grants = [];
  state.queried = [];
  state.executed = [];
});

describe("commerce-plugin + Centro de Permisos", () => {
  it("sin network:fetch concedido no ejecuta el plugin", async () => {
    await expect(sandboxedFetchProducts(config)).rejects.toThrow(/network:fetch.*\/admin\/permissions/);
    expect(await sandboxedIsCommerceEnabled(config)).toBe(false);
    expect(state.executed).toHaveLength(0);
    expect(state.queried[0]).toEqual(subject);
  });

  it("un permiso revocado (granted:false) cuenta como no concedido", async () => {
    state.grants = [{ subject, capabilityId: "network:fetch", granted: false }];
    await expect(sandboxedFetchProducts(config)).rejects.toThrow(/network:fetch/);
    expect(state.executed).toHaveLength(0);
  });

  it("con network:fetch concedido ejecuta y recibe solo esa capacidad", async () => {
    state.grants = [{ subject, capabilityId: "network:fetch", granted: true }];
    expect(await sandboxedFetchProducts(config)).toEqual([]);
    expect([...state.executed[0]]).toEqual(["network:fetch"]);
  });

  it("una capacidad concedida pero no declarada en el manifiesto nunca llega al plugin", async () => {
    state.grants = [
      { subject, capabilityId: "network:fetch", granted: true },
      { subject, capabilityId: "storage:write", granted: true },
      { subject: { type: "plugin", id: "otro-plugin" }, capabilityId: "site:admin", granted: true },
    ];
    await sandboxedFetchProducts(config);
    expect([...state.executed[0]]).toEqual(["network:fetch"]);
  });
});
