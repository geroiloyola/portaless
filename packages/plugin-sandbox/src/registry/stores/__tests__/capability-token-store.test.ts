// Tests del CapabilityTokenStore -- ciclo de vida completo de los
// tokens efimeros del Capability Bridge HTTP. Ver hallazgo de seguridad
// en ROADMAP.md y el store real en
// packages/plugin-sandbox/src/registry/stores/capability-token-store.ts.
//
// Usa InMemoryCapabilityTokenStore como sujeto de prueba -- comparte la
// misma logica de TTL y GC que D1CapabilityTokenStore/
// SqliteCapabilityTokenStore (delegada a maybeGc(), no reimplementada
// por cada clase), asi que cubrir el contrato aqui cubre las 3
// implementaciones sin necesitar un D1/SQLite real en el test.
//
// Manipulacion de tiempo: se usa vi.useFakeTimers() en vez de esperas
// reales -- el TTL de 5 minutos (300_000ms) se verifica adelantando el
// reloj con vi.advanceTimersByTime(), no con un setTimeout real.
//
// FIX (esta sesion, hallazgo real de CI): el test de deleteExpired()
// era flaky -- no mockeaba Math.random(), asi que la GC probabilistica
// (10% de probabilidad en cada issue(), ver maybeGc() en el store real)
// podia disparar una limpieza de fondo AL EMITIR pless_nuevo, borrando
// pless_viejo ANTES de que el test llamara a deleteExpired() de forma
// explicita -- dejando 0 tokens vencidos para contar en 1 de cada ~10
// corridas. Se fuerza Math.random() a un valor alto (0.9) en este test
// especifico para desactivar la GC de fondo y aislar el comportamiento
// de la llamada EXPLICITA a deleteExpired() que el test quiere verificar.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryCapabilityTokenStore } from "../capability-token-store";

describe("InMemoryCapabilityTokenStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("issue() registra el token y validate() lo acepta dentro del TTL", async () => {
    const store = new InMemoryCapabilityTokenStore();

    const issued = await store.issue("pless_test1", "hello-plugin", ["content:read", "content:write"]);

    expect(issued.token).toBe("pless_test1");
    expect(issued.pluginName).toBe("hello-plugin");

    const result = await store.validate("pless_test1");

    expect(result.valid).toBe(true);
    expect(result.pluginName).toBe("hello-plugin");
    expect(result.grantedCapabilities).toEqual(["content:read", "content:write"]);
  });

  it("validate() devuelve valid:false con reason:not_found para un token que nunca se emitio", async () => {
    const store = new InMemoryCapabilityTokenStore();

    const result = await store.validate("pless_nunca_existio");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("validate() devuelve valid:false con reason:expired justo despues del TTL (300_000ms + 1ms)", async () => {
    const store = new InMemoryCapabilityTokenStore();

    await store.issue("pless_test2", "hello-plugin", ["content:read"], 300);

    vi.advanceTimersByTime(300_001);

    const result = await store.validate("pless_test2");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("validate() sigue siendo valid:true justo ANTES de que expire el TTL", async () => {
    const store = new InMemoryCapabilityTokenStore();

    await store.issue("pless_test3", "hello-plugin", ["content:read"], 300);

    vi.advanceTimersByTime(299_999);

    const result = await store.validate("pless_test3");

    expect(result.valid).toBe(true);
  });

  it("validate() no consume el token -- un mismo token respalda varias llamadas dentro del TTL", async () => {
    const store = new InMemoryCapabilityTokenStore();

    await store.issue("pless_test4", "hello-plugin", ["content:read", "content:write"]);

    const first = await store.validate("pless_test4");
    const second = await store.validate("pless_test4");
    const third = await store.validate("pless_test4");

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    expect(third.valid).toBe(true);
  });

  it("deleteExpired() borra solo los tokens vencidos, preservando los vigentes", async () => {
    // Math.random() forzado por encima de GC_PROBABILITY (0.1) para que
    // ningun issue() de este test dispare la GC de fondo -- se aisla asi
    // el comportamiento de la llamada EXPLICITA a deleteExpired() que
    // este test quiere verificar, sin interferencia de la limpieza
    // probabilistica (ver nota de FIX al inicio del archivo).
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const store = new InMemoryCapabilityTokenStore();

    await store.issue("pless_viejo", "hello-plugin", ["content:read"], 300);
    vi.advanceTimersByTime(300_001);
    await store.issue("pless_nuevo", "hello-plugin", ["content:read"], 300);

    const deletedCount = await store.deleteExpired(new Date().toISOString());

    expect(deletedCount).toBe(1);
    expect((await store.validate("pless_viejo")).valid).toBe(false);
    expect((await store.validate("pless_nuevo")).valid).toBe(true);
  });

  it("GC probabilistica: forzando Math.random() a un valor bajo, issue() dispara deleteExpired() en background", async () => {
    const store = new InMemoryCapabilityTokenStore();
    const deleteExpiredSpy = vi.spyOn(store, "deleteExpired");

    await store.issue("pless_viejo", "hello-plugin", ["content:read"], 300);
    vi.advanceTimersByTime(300_001);

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.05); // < GC_PROBABILITY (0.1)
    await store.issue("pless_nuevo", "hello-plugin", ["content:read"], 300);
    randomSpy.mockRestore();

    expect(deleteExpiredSpy).toHaveBeenCalled();
  });

  it("GC probabilistica: con Math.random() alto, issue() NO dispara deleteExpired()", async () => {
    const store = new InMemoryCapabilityTokenStore();
    const deleteExpiredSpy = vi.spyOn(store, "deleteExpired");

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5); // > GC_PROBABILITY (0.1)
    await store.issue("pless_test5", "hello-plugin", ["content:read"], 300);
    randomSpy.mockRestore();

    expect(deleteExpiredSpy).not.toHaveBeenCalled();
  });

  it("tokens de distintos plugins son independientes -- el snapshot de uno no afecta al otro", async () => {
    const store = new InMemoryCapabilityTokenStore();

    await store.issue("pless_hello", "hello-plugin", ["content:read"]);
    await store.issue("pless_commerce", "commerce-plugin", ["commerce:read", "commerce:checkout"]);

    const helloResult = await store.validate("pless_hello");
    const commerceResult = await store.validate("pless_commerce");

    expect(helloResult.pluginName).toBe("hello-plugin");
    expect(helloResult.grantedCapabilities).toEqual(["content:read"]);
    expect(commerceResult.pluginName).toBe("commerce-plugin");
    expect(commerceResult.grantedCapabilities).toEqual(["commerce:read", "commerce:checkout"]);
  });
});
