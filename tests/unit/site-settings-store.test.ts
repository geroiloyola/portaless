// site_settings + analytics-config: el primer ajuste general del sitio.
// Cubre la tabla clave/valor en SQLite e InMemory, y la capa tipada de
// analytics (validacion, emision del /api/analytics y barrera de inyeccion:
// el admin nunca guarda JavaScript, solo proveedor + id + origen https).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../scripts/setup.mjs";
import {
  ANALYTICS_KEYS,
  EMPTY_ANALYTICS,
  InMemorySiteSettingsStore,
  SqliteSiteSettingsStore,
  analyticsSettingsToValues,
  buildAnalyticsJs,
  getAnalyticsSettings,
  isSafeAnalyticsId,
  isSafeScriptUrl,
  parseAnalyticsSettings,
  saveAnalyticsSettings,
  sanitizeAnalyticsInput,
} from "../../packages/dashboard/src/site-settings/site-settings-store";

const tmp = mkdtempSync(join(tmpdir(), "portaless-site-settings-"));
const DB = join(tmp, "portaless.db");

beforeAll(async () => {
  await applySchema(DB, { quiet: true });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("site_settings (SQLite)", () => {
  it("lee y escribe clave/valor con upsert", async () => {
    const store = await SqliteSiteSettingsStore.open(DB);
    expect(await store.get("k")).toBeNull();
    await store.set("k", "v1");
    expect(await store.get("k")).toBe("v1");
    await store.set("k", "v2");
    expect(await store.get("k")).toBe("v2");
    expect(await store.getAll(["k", "faltante"])).toEqual({ k: "v2", faltante: "" });
    store.close();
  });

  it("rechaza claves y valores fuera de rango (nunca persiste basura)", async () => {
    const store = await SqliteSiteSettingsStore.open(DB);
    await expect(store.set("", "x")).rejects.toThrow(/clave invalida/);
    await expect(store.set("x".repeat(65), "y")).rejects.toThrow(/clave invalida/);
    await expect(store.set("ok", "y".repeat(401))).rejects.toThrow(/demasiado largo/);
    store.close();
  });
});

describe("site_settings (InMemory)", () => {
  it("mismo contrato que el backend SQLite", async () => {
    const store = new InMemorySiteSettingsStore();
    expect(await store.get("a")).toBeNull();
    await store.setMany({ a: "1", b: "2" });
    expect(await store.getAll(["a", "b", "c"])).toEqual({ a: "1", b: "2", c: "" });
  });
});

describe("sanitizeAnalyticsInput", () => {
  it("acepta los proveedores oficiales y completa el script oficial", () => {
    const r = sanitizeAnalyticsInput({ provider: "plausible", id: "ejemplo.com" });
    expect(r.rejected).toEqual([]);
    expect(r.settings).toEqual({
      provider: "plausible",
      id: "ejemplo.com",
      scriptUrl: "https://plausible.io/js/script.js",
    });
  });

  it("none apaga y limpia todo", () => {
    expect(sanitizeAnalyticsInput({ provider: "none", id: "x" })).toEqual({
      settings: { ...EMPTY_ANALYTICS },
      rejected: [],
    });
    expect(sanitizeAnalyticsInput(undefined)).toEqual({ settings: { ...EMPTY_ANALYTICS }, rejected: [] });
  });

  it("custom exige un origen https", () => {
    expect(sanitizeAnalyticsInput({ provider: "custom", id: "", scriptUrl: "https://a.com/s.js" })).toEqual({
      settings: { provider: "custom", id: "", scriptUrl: "https://a.com/s.js" },
      rejected: [],
    });
    expect(sanitizeAnalyticsInput({ provider: "custom", id: "", scriptUrl: "javascript:alert(1)" }).rejected).toEqual([
      "scriptUrl",
    ]);
    expect(sanitizeAnalyticsInput({ provider: "custom", id: "", scriptUrl: "http://a.com/s.js" }).rejected).toEqual([
      "scriptUrl",
    ]);
  });

  it("rechaza proveedores inventados e ids inseguros", () => {
    expect(sanitizeAnalyticsInput({ provider: "ga4", id: "x" }).rejected).toEqual(["provider"]);
    expect(sanitizeAnalyticsInput({ provider: "plausible", id: '"><script>' }).rejected).toEqual(["id"]);
    expect(sanitizeAnalyticsInput({ provider: "plausible", id: "" }).rejected).toEqual(["id"]);
  });

  it("isSafeScriptUrl / isSafeAnalyticsId acotan a lo seguro", () => {
    expect(isSafeScriptUrl("https://plausible.io/js/script.js")).toBe(true);
    expect(isSafeScriptUrl("http://localhost:8787/s.js")).toBe(true);
    expect(isSafeScriptUrl("https://a.com/x.js?b=1&c=2")).toBe(true);
    expect(isSafeScriptUrl("https://a.com/x.js'\"`<>\\")).toBe(false);
    expect(isSafeAnalyticsId("ejemplo.com")).toBe(true);
    expect(isSafeAnalyticsId("a b")).toBe(false);
  });
});

describe("buildAnalyticsJs", () => {
  it("emite el beacon de Cloudflare con el token en JSON", () => {
    const js = buildAnalyticsJs({
      provider: "cloudflare",
      id: "token123",
      scriptUrl: "https://static.cloudflareinsights.com/beacon.min.js",
    });
    expect(js).toContain("https://static.cloudflareinsights.com/beacon.min.js");
    expect(js).toContain('setAttribute("data-cf-beacon"');
    // El valor del atributo es JSON dentro de un literal de JS: las
    // comillas internas van escapadas ("{\"token\":\"token123\"}").
    expect(js).toContain('token123');
    expect(js).toContain('\\"token\\":\\"token123\\"');
    expect(js).toContain("document.head.appendChild(s)");
  });

  it("emite data-domain para Plausible y data-website-id para umami", () => {
    expect(
      buildAnalyticsJs({ provider: "plausible", id: "ejemplo.com", scriptUrl: "https://plausible.io/js/script.js" })
    ).toContain('setAttribute("data-domain","ejemplo.com")');
    expect(
      buildAnalyticsJs({ provider: "umami", id: "uuid-1", scriptUrl: "https://cloud.umami.is/script.js" })
    ).toContain('setAttribute("data-website-id","uuid-1")');
  });

  it("sin config emite un no-op y nunca codigo del admin", () => {
    expect(buildAnalyticsJs({ provider: "none", id: "", scriptUrl: "" })).toContain("sin analytics configurado");
    const malicious = buildAnalyticsJs({ provider: "custom", id: "", scriptUrl: "https://a.com/s.js" });
    expect(malicious).not.toContain("eval");
    expect(malicious).toContain("s.src=" + JSON.stringify("https://a.com/s.js"));
  });
});

describe("parseAnalyticsSettings / helpers tipadas", () => {
  it("lee la config desde un objeto clave/valor y la normaliza", () => {
    expect(parseAnalyticsSettings({ analytics_provider: "plausible", analytics_id: "a.com" })).toEqual({
      provider: "plausible",
      id: "a.com",
      scriptUrl: "https://plausible.io/js/script.js",
    });
    expect(parseAnalyticsSettings({ analytics_provider: "plausible", analytics_id: '"><x>' })).toEqual({
      ...EMPTY_ANALYTICS,
    });
    // Fila tocada a mano: proveedor valido pero sin id -> nada que cargar
    // (sin id no hay como identificar el sitio en el proveedor).
    expect(parseAnalyticsSettings({ analytics_provider: "plausible", analytics_id: "" })).toEqual({
      ...EMPTY_ANALYTICS,
    });
    expect(parseAnalyticsSettings({ analytics_provider: "cloudflare", analytics_id: "" })).toEqual({
      ...EMPTY_ANALYTICS,
    });
    // custom sin origen tampoco carga nada.
    expect(parseAnalyticsSettings({ analytics_provider: "custom", analytics_id: "x", analytics_script_url: "" })).toEqual({
      ...EMPTY_ANALYTICS,
    });
    expect(parseAnalyticsSettings({})).toEqual({ ...EMPTY_ANALYTICS });
  });

  it("analyticsSettingsToValues redondea none a las tres claves vacias", () => {
    expect(analyticsSettingsToValues({ provider: "none", id: "", scriptUrl: "" })).toEqual({
      analytics_provider: "none",
      analytics_id: "",
      analytics_script_url: "",
    });
    expect(analyticsSettingsToValues({ provider: "umami", id: "u1", scriptUrl: "https://cloud.umami.is/script.js" })).toEqual({
      analytics_provider: "umami",
      analytics_id: "u1",
      analytics_script_url: "https://cloud.umami.is/script.js",
    });
  });

  it("get/save redondean contra el store y no persisten lo invalido", async () => {
    const store = new InMemorySiteSettingsStore();
    expect(await getAnalyticsSettings(store)).toEqual({ ...EMPTY_ANALYTICS });

    const bad = await saveAnalyticsSettings(store, { provider: "plausible", id: '"><script>' });
    expect(bad.rejected).toEqual(["id"]);
    expect(await store.get(ANALYTICS_KEYS[1])).toBeNull();

    const ok = await saveAnalyticsSettings(store, { provider: "plausible", id: "ejemplo.com" });
    expect(ok.rejected).toEqual([]);
    expect(await getAnalyticsSettings(store)).toEqual({
      provider: "plausible",
      id: "ejemplo.com",
      scriptUrl: "https://plausible.io/js/script.js",
    });

    await saveAnalyticsSettings(store, { provider: "none" });
    expect(await getAnalyticsSettings(store)).toEqual({ ...EMPTY_ANALYTICS });
  });
});
