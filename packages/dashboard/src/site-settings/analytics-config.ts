// packages/dashboard/src/site-settings/analytics-config.ts
//
// Configuracion de analytics del sitio: tipos, validacion y emision del
// /api/analytics. Pura (sin imports de SQLite ni de Web APIs) a proposito:
// functions/api/analytics.js la usa en runtime y src/pages/api/analytics.ts la
// usa en el build estatico de Astro.
//
// Seguridad (la misma barrera que sanitizeTokens en site-skin-store):
//   - scriptUrl solo https (http unicamente contra localhost);
//   - sin comillas, backslashes ni markup en url ni id;
//   - el valor guardado NUNCA se ejecuta como codigo del admin: se emite
//     como atributo de un <script> que Portaless crea, no como JS crudo.
//     Un admin malicioso no puede inyectar sentencias, solo apuntar a un
//     archivo js de un origen https.

// ---------------------------------------------------------------------------
// Analytics: tipos, validacion y emision
// ---------------------------------------------------------------------------

export const ANALYTICS_PROVIDERS = ["none", "plausible", "cloudflare", "umami", "custom"] as const;
export type AnalyticsProvider = (typeof ANALYTICS_PROVIDERS)[number];

export const ANALYTICS_KEYS = ["analytics_provider", "analytics_id", "analytics_script_url"] as const;

/** Script oficial de cada proveedor (el admin solo elige proveedor + id). */
const PROVIDER_SCRIPTS: Record<Exclude<AnalyticsProvider, "none">, string> = {
  plausible: "https://plausible.io/js/script.js",
  cloudflare: "https://static.cloudflareinsights.com/beacon.min.js",
  umami: "https://cloud.umami.is/script.js",
  custom: "",
};

/** Atributo del <script> que identifica el sitio en cada proveedor. */
const PROVIDER_ATTRS: Record<Exclude<AnalyticsProvider, "none">, string | null> = {
  plausible: "data-domain",
  cloudflare: null, // usa data-cf-beacon con el token en JSON
  umami: "data-website-id",
  custom: null,
};

export function isAnalyticsProvider(value: unknown): value is AnalyticsProvider {
  return typeof value === "string" && (ANALYTICS_PROVIDERS as readonly string[]).includes(value);
}

const SAFE_URL = /^https:\/\/[\w.-]+[^\s"'`<>\\]{0,180}$/;
const SAFE_LOCALHOST_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?[^\s"'`<>\\]{0,180}$/;
const SAFE_ID = /^[\w.-]{1,128}$/;

export function isSafeScriptUrl(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && (SAFE_URL.test(value) || SAFE_LOCALHOST_URL.test(value));
}

export function isSafeAnalyticsId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

export interface AnalyticsSettings {
  provider: AnalyticsProvider;
  /** Id del sitio en el proveedor (dominio en Plausible, token en CF, …). */
  id: string;
  /** Solo para provider "custom": origen del script. */
  scriptUrl: string;
}

export const EMPTY_ANALYTICS: AnalyticsSettings = { provider: "none", id: "", scriptUrl: "" };

/**
 * Lee la config tipada de un objeto key->value (lo que devuelve getAll).
 * Revalida al LEER, no solo al escribir: una fila tocada a mano en la base
 * no debe poder cargar un origen inseguro ni un proveedor inventado.
 * El script de los proveedores oficiales es siempre el del repo -- el
 * valor guardado se ignora, asi nadie puede cambiar el script de Plausible
 * desde la tabla.
 */
export function parseAnalyticsSettings(values: Record<string, string>): AnalyticsSettings {
  const provider = values.analytics_provider;
  if (!isAnalyticsProvider(provider) || provider === "none") return { ...EMPTY_ANALYTICS };

  const id = isSafeAnalyticsId(values.analytics_id) ? (values.analytics_id as string) : "";

  if (provider === "custom") {
    // custom: el origen ES el script, asi que es obligatorio y validado.
    if (!isSafeScriptUrl(values.analytics_script_url)) return { ...EMPTY_ANALYTICS };
    return { provider, id, scriptUrl: values.analytics_script_url as string };
  }

  // Proveedores oficiales: el id del sitio es lo unico que identifica.
  if (!id) return { ...EMPTY_ANALYTICS };
  return { provider, id, scriptUrl: PROVIDER_SCRIPTS[provider] };
}

/**
 * superficie minima que necesitan las helpers tipadas (el store real la
 * implementa). Declarada aqui para no importar el modulo de backends.
 */
export interface AnalyticsSettingsStore {
  getAll(keys: string[]): Promise<Record<string, string>>;
  setMany(values: Record<string, string>): Promise<void>;
}

export interface AnalyticsValidation {
  settings: AnalyticsSettings;
  rejected: string[];
}

/**
 * Valida lo que manda el admin. Devuelve rejected (para 400 en vez de
 * guardar basura en silencio) y las claves listas para setMany(). El
 * scriptUrl solo se acepta para provider "custom"; para los proveedores
 * conocidos el script es el oficial y el admin no puede cambiarlo.
 */
export function sanitizeAnalyticsInput(input: unknown): AnalyticsValidation {
  const rejected: string[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  const provider = raw.provider ?? "none";
  if (!isAnalyticsProvider(provider)) {
    return { settings: { ...EMPTY_ANALYTICS }, rejected: ["provider"] };
  }
  if (provider === "none") {
    return { settings: { ...EMPTY_ANALYTICS }, rejected: [] };
  }

  // El id es obligatorio en los proveedores conocidos (sin el no hay como
  // identificar el sitio); en "custom" es opcional porque hay scripts que
  // no llevan id, pero si viene tiene que ser seguro.
  const rawId = raw.id ?? "";
  const idRequired = provider !== "custom";
  if (rawId === "") {
    if (idRequired) rejected.push("id");
  } else if (!isSafeAnalyticsId(rawId)) {
    rejected.push("id");
  }

  let scriptUrl = "";
  if (provider === "custom") {
    if (!isSafeScriptUrl(raw.scriptUrl)) rejected.push("scriptUrl");
    else scriptUrl = raw.scriptUrl as string;
  } else {
    scriptUrl = PROVIDER_SCRIPTS[provider];
  }

  return {
    settings: { provider, id: rejected.includes("id") ? "" : (rawId as string), scriptUrl },
    rejected,
  };
}

export function analyticsSettingsToValues(settings: AnalyticsSettings): Record<string, string> {
  if (settings.provider === "none") {
    return { analytics_provider: "none", analytics_id: "", analytics_script_url: "" };
  }
  return {
    analytics_provider: settings.provider,
    analytics_id: settings.id,
    analytics_script_url: settings.scriptUrl,
  };
}

/** JS que crea el <script> del proveedor. Vacio (comentario) si no hay config. */
export function buildAnalyticsJs(settings: AnalyticsSettings): string {
  if (settings.provider === "none") {
    return "/* Portaless: sin analytics configurado (/admin/analytics). */\n";
  }
  const url = settings.scriptUrl || PROVIDER_SCRIPTS[settings.provider as Exclude<AnalyticsProvider, "none">];
  if (!isSafeScriptUrl(url)) return "/* Portaless: sin analytics configurado (/admin/analytics). */\n";

  const attrs: string[] = [];
  const attr = PROVIDER_ATTRS[settings.provider as Exclude<AnalyticsProvider, "none">];
  if (attr && settings.id) attrs.push(`s.setAttribute(${JSON.stringify(attr)},${JSON.stringify(settings.id)});`);
  if (settings.provider === "cloudflare" && settings.id) {
    attrs.push(`s.setAttribute("data-cf-beacon",${JSON.stringify(JSON.stringify({ token: settings.id }))});`);
  }

  return [
    "/* Generado por Portaless — no editar a mano (config en /admin/analytics). */",
    "(function(){",
    `var s=document.createElement("script");s.defer=true;s.src=${JSON.stringify(url)};`,
    ...attrs,
    'document.head.appendChild(s);',
    "})();",
    "",
  ].join("\n");
}

/** Lee la config de analytics desde un store (clave ausente = vacio). */
export async function getAnalyticsSettings(store: AnalyticsSettingsStore): Promise<AnalyticsSettings> {
  return parseAnalyticsSettings(await store.getAll([...ANALYTICS_KEYS]));
}

/** Persiste la config validada. Rechaza lo que sanitizeAnalyticsInput rechazo. */
export async function saveAnalyticsSettings(
  store: AnalyticsSettingsStore,
  input: unknown
): Promise<AnalyticsValidation> {
  const result = sanitizeAnalyticsInput(input);
  if (result.rejected.length === 0) {
    await store.setMany(analyticsSettingsToValues(result.settings));
  }
  return result;
}
