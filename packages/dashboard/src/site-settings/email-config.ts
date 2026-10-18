// Configuracion de email transaccional del SITIO (TASK 5), en clave/valor sobre
// site_settings. PURA (sin imports de SQLite) para que el build estatico de
// Astro y los tests puedan importarla sin arrastrar better-sqlite3 -- mismo
// patron que analytics-config.ts.
//
// Modelo "Delegacion Ciega": un plugin NO construye correos en crudo. Envia
// { template, to, data } y el core:
//   1. verifica que la plantilla este APROBADA por el dueno del sitio;
//   2. renderiza subject/body con interpolacion {{var}};
//   3. inyecta el `from` desde el dominio verificado del sitio (el plugin nunca
//      lo elige);
//   4. aplica la cuota diaria por plugin.
// Asi un plugin malicioso solo puede enviar plantillas pre-aprobadas, con el
// remitente del dueno, y nunca texto libre en su nombre.

export type EmailProviderKind = "webhook" | "smtp" | "none";

export interface EmailProviderSettings {
  kind: EmailProviderKind;
  /** webhook: URL que recibe { from, to, subject, text }. */
  url?: string;
  /** webhook: token Bearer opcional. smtp: password. */
  token?: string;
  /** smtp: host/puerto/usuario. */
  host?: string;
  port?: number;
  username?: string;
}

export interface EmailTemplate {
  /** Identificador que el plugin usa: `email.send({ template: "order_confirmation" })`. */
  id: string;
  subject: string;
  /** Cuerpo en texto con `{{var}}`. */
  body: string;
}

export interface EmailSettings {
  provider: EmailProviderSettings;
  /** Plantillas aprobadas por el dueno. Una plantilla no listada NO se envia. */
  templates: EmailTemplate[];
  /**
   * Remitente del sitio. Lo inyecta el CORE en cada envio (el plugin nunca lo
   * elige). Debe ser del dominio verificado del sitio.
   */
  from?: string;
}

export const EMPTY_EMAIL_SETTINGS: EmailSettings = {
  provider: { kind: "none" },
  templates: [],
};

export const EMAIL_KEYS = {
  provider: "email.provider_json",
  templates: "email.templates_json",
  from: "email.from",
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value);
}

const TEMPLATE_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;

export function isEmailTemplateId(value: unknown): value is string {
  return typeof value === "string" && TEMPLATE_ID_RE.test(value);
}

/** ¿La URL es http(s) y no apunta a rangos internos obvios? */
export function isSafeEmailUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

export interface EmailValidation {
  settings: EmailSettings;
  rejected: string[];
}

/** Normaliza y valida la entrada del panel. Rechaza lo invalido, nunca lo inventa. */
export function sanitizeEmailInput(input: unknown): EmailValidation {
  const rejected: string[] = [];
  const raw = (input ?? {}) as { provider?: unknown; templates?: unknown; from?: unknown };

  let from: string | undefined;
  if (raw.from !== undefined && raw.from !== "") {
    if (!isEmailAddress(raw.from)) rejected.push("from: debe ser un email valido.");
    else from = raw.from;
  }

  const providerRaw = (raw.provider ?? {}) as Record<string, unknown>;
  const kind = providerRaw.kind;
  const provider: EmailProviderSettings = { kind: "none" };
  if (kind === "webhook") {
    if (!isSafeEmailUrl(providerRaw.url)) {
      rejected.push("provider.url: se requiere una URL http(s) publica para el webhook.");
    } else {
      provider.kind = "webhook";
      provider.url = providerRaw.url as string;
      if (typeof providerRaw.token === "string" && providerRaw.token.trim()) provider.token = providerRaw.token.trim();
    }
  } else if (kind === "smtp") {
    const port = Number(providerRaw.port);
    if (typeof providerRaw.host !== "string" || !providerRaw.host.trim()) {
      rejected.push("provider.host: se requiere el host SMTP.");
    } else if (!Number.isInteger(port) || port < 1 || port > 65535) {
      rejected.push("provider.port: puerto SMTP invalido (1-65535).");
    } else {
      provider.kind = "smtp";
      provider.host = providerRaw.host.trim();
      provider.port = port;
      if (typeof providerRaw.username === "string" && providerRaw.username.trim()) provider.username = providerRaw.username.trim();
      if (typeof providerRaw.token === "string" && providerRaw.token) provider.token = providerRaw.token;
    }
  } else if (kind !== "none" && kind !== undefined) {
    rejected.push('provider.kind: debe ser "webhook", "smtp" o "none".');
  }

  const templates: EmailTemplate[] = [];
  const seen = new Set<string>();
  const templatesRaw = Array.isArray(raw.templates) ? raw.templates : [];
  for (const t of templatesRaw) {
    const entry = (t ?? {}) as Record<string, unknown>;
    if (!isEmailTemplateId(entry.id)) {
      rejected.push(`template: id invalido (${JSON.stringify(entry.id)}); usa minusculas, numeros y guion bajo.`);
      continue;
    }
    if (seen.has(entry.id)) {
      rejected.push(`template: id duplicado (${entry.id}).`);
      continue;
    }
    if (typeof entry.subject !== "string" || !entry.subject.trim()) {
      rejected.push(`template ${entry.id}: falta el asunto.`);
      continue;
    }
    if (typeof entry.body !== "string" || !entry.body.trim()) {
      rejected.push(`template ${entry.id}: falta el cuerpo.`);
      continue;
    }
    seen.add(entry.id);
    templates.push({ id: entry.id, subject: entry.subject, body: entry.body });
  }

  return { settings: { provider, templates, from }, rejected };
}

/** Lee la config tipada desde un store clave/valor (clave ausente = vacio). */
export async function parseEmailSettings(store: { get(key: string): Promise<string | null> }): Promise<EmailSettings> {
  const [providerJson, templatesJson, from] = await Promise.all([
    store.get(EMAIL_KEYS.provider),
    store.get(EMAIL_KEYS.templates),
    store.get(EMAIL_KEYS.from),
  ]);
  let provider: unknown = {};
  let templates: unknown = [];
  try {
    if (providerJson) provider = JSON.parse(providerJson);
  } catch {
    provider = {};
  }
  try {
    if (templatesJson) templates = JSON.parse(templatesJson);
  } catch {
    templates = [];
  }
  return sanitizeEmailInput({ provider, templates, from: from ?? undefined }).settings;
}

export function emailSettingsToValues(settings: EmailSettings): Record<string, string> {
  return {
    [EMAIL_KEYS.provider]: JSON.stringify(settings.provider),
    [EMAIL_KEYS.templates]: JSON.stringify(settings.templates),
    [EMAIL_KEYS.from]: settings.from ?? "",
  };
}

/** Interpolacion `{{var}}` pura. Var ausente -> cadena vacia (nunca 'undefined'). */
export function renderEmailTemplate(
  template: EmailTemplate,
  data: Record<string, unknown> = {},
): { subject: string; text: string } {
  const interpolate = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(data[name] ?? ""));
  return { subject: interpolate(template.subject), text: interpolate(template.body) };
}
