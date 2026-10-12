// packages/dashboard/src/skin-engine/site-skin-store.ts
//
// Skin activo del sitio (Phase 0 — visual identity foundation): una fila
// por site con el nombre del skin ("base" | "blog" | "tienda" |
// "trust-crm") + los overrides de tokens que el admin cambio desde
// /admin/appearance. El sitio publico y el dashboard leen lo mismo via
// GET /api/site-skin (hoja CSS con los tokens emitidos como variables en
// :root); no hay un segundo sistema de color.
//
// Mismo patron D1 -> SQLite -> InMemory con factory que el resto del repo
// (store-factory.ts de apw-resolver, store.ts de cloud-images). La tabla
// vive en schema-additions/site-skin.sql; el store tambien trae su DDL
// (CREATE TABLE IF NOT EXISTS) para arrancar en InMemory/SQLite vacio.
//
// Seguridad: los tokens del admin se emiten como CSS crudo en la hoja
// publica. sanitizeTokens() es la barrera (y se aplica TAMBIEN en el
// emisor, defensa en profundidad): valores sin llaves, punto y coma,
// comillas ni caracteres de markup, largo maximo 40.

import { openSqlite } from "../../../sqlite-driver/src/open";
import type { DesignTokens, SkinManifest } from "../types";
import { DEFAULT_DARK_TOKENS, TOKEN_TO_CSS_VAR } from "./tokens";
import { resolveSkin, StaticSkinSource } from "./loader";
import baseManifest from "../skins/base.json";
import blogManifest from "../skins/blog.json";
import tiendaManifest from "../skins/tienda.json";
import trustCrmManifest from "../skins/trust-crm.json";

export const SITE_ID = "default";
export const SKIN_NAMES = ["base", "blog", "tienda", "trust-crm"] as const;
export type SkinName = (typeof SKIN_NAMES)[number];

export function isSkinName(value: unknown): value is SkinName {
  return typeof value === "string" && (SKIN_NAMES as readonly string[]).includes(value);
}

const SKIN_MANIFESTS: Record<string, SkinManifest> = {
  base: baseManifest as SkinManifest,
  blog: blogManifest as SkinManifest,
  tienda: tiendaManifest as SkinManifest,
  "trust-crm": trustCrmManifest as SkinManifest,
};

export interface SiteSkinRecord {
  siteId: string;
  skin: SkinName;
  /** Overrides del admin sobre los tokens del skin (pueden ser {}). */
  tokens: DesignTokens;
  updatedAt: string;
}

export interface SiteSkinStore {
  get(siteId: string): Promise<SiteSkinRecord | null>;
  /** Upsert: crea o reemplaza la fila del site. */
  set(siteId: string, skin: SkinName, tokens: DesignTokens): Promise<SiteSkinRecord>;
}

export const SITE_SKIN_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS site_skin (" +
  "site_id TEXT PRIMARY KEY, " +
  "skin TEXT NOT NULL, " +
  "tokens_json TEXT NOT NULL DEFAULT '{}', " +
  "updated_at TEXT NOT NULL)";

// ---------------------------------------------------------------------------
// Sanitizacion de tokens (barrera de CSS injection)
// ---------------------------------------------------------------------------

const SAFE_TOKEN_KEYS = new Set(Object.keys(TOKEN_TO_CSS_VAR));
const SAFE_TOKEN_VALUE = /^[\w#(),.%\s/-]{1,40}$/;

/** Valor seguro para emitir en CSS (hex, px, palabras, functions simples). */
export function isSafeTokenValue(value: unknown): value is string {
  return typeof value === "string" && SAFE_TOKEN_VALUE.test(value);
}

/**
 * Filtra un objeto de tokens a las claves conocidas con valores seguros.
 * Devuelve { tokens, rejected }: rejected lista las claves descartadas
 * (invalidas o con valor inseguro) para que el endpoint pueda responder
 * 400 en vez de guardar basura en silencio.
 */
export function sanitizeTokens(input: unknown): { tokens: DesignTokens; rejected: string[] } {
  const tokens: DesignTokens = {};
  const rejected: string[] = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { tokens, rejected: input === undefined || input === null ? [] : ["<not-an-object>"] };
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!SAFE_TOKEN_KEYS.has(key)) {
      rejected.push(key);
      continue;
    }
    if (!isSafeTokenValue(value)) {
      rejected.push(key);
      continue;
    }
    (tokens as Record<string, string>)[key] = value;
  }
  return { tokens, rejected };
}

// ---------------------------------------------------------------------------
// Resolucion del skin activo -> tokens claro + oscuro listos para CSS
// ---------------------------------------------------------------------------

/** Claves de "marca" que el override del admin aplica en ambos temas. */
const BRAND_KEYS: (keyof DesignTokens)[] = [
  "accent", "accentText", "accent2", "radius", "density",
  "successBg", "successFg", "warningBg", "warningFg", "dangerBg", "dangerFg",
];

export interface ResolvedActiveSkin {
  light: DesignTokens;
  dark: DesignTokens;
}

/**
 * Resuelve el skin activo con sus overrides. light = cadena del skin
 * (herencia extends incluida) + overrides. dark = paleta oscura oficial +
 * overrides solo de claves de marca (bg/text/panel* quedan en la oscura
 * oficial: un override claro sobre fondo oscuro romperia el tema).
 */
export async function resolveActiveSkin(
  skin: string = "base",
  overrides: DesignTokens = {}
): Promise<ResolvedActiveSkin> {
  const name = isSkinName(skin) ? skin : "base";
  const resolved = await resolveSkin(name, new StaticSkinSource(SKIN_MANIFESTS));
  const light: DesignTokens = { ...resolved.tokens, ...overrides };
  const darkOverrides: DesignTokens = {};
  for (const key of BRAND_KEYS) {
    const value = overrides[key];
    if (value !== undefined) (darkOverrides as Record<string, string>)[key] = value;
  }
  const dark: DesignTokens = { ...DEFAULT_DARK_TOKENS, ...darkOverrides };
  return { light, dark };
}

/**
 * Emite la hoja CSS publica con los tokens como variables en el root.
 * Tres bloques: claro, oscuro por preferencia del SO, oscuro por
 * data-theme="dark". Los selectores usan html:root (especificidad
 * 0,1,1) en vez de :root (0,1,0) a proposito: global.css inlinea su
 * :root como <style> DESPUES de este <link> en el <head> construido, y
 * con igual especificidad la ultima hoja gana -- html:root le gana a
 * :root y a :root[data-theme]/:root:not(...) en los 4 escenarios de
 * tema (claro/oscuro SO/data-theme light/data-theme dark). Los valores
 * vuelven a pasar por sanitizeTokens aqui (defensa en profundidad: el
 * emisor nunca emite lo que no sobrevivio la barrera, aunque el caller
 * se salte el sanitize).
 */
export function emitSiteSkinCss(light: DesignTokens, dark: DesignTokens): string {
  const safeLight = sanitizeTokens(light).tokens;
  const safeDark = sanitizeTokens(dark).tokens;
  const block = (tokens: DesignTokens): string => {
    const lines: string[] = [];
    for (const [key, cssVar] of Object.entries(TOKEN_TO_CSS_VAR)) {
      const value = (tokens as Record<string, unknown>)[key];
      if (isSafeTokenValue(value)) lines.push(`  ${cssVar}: ${value};`);
    }
    return lines.join("\n");
  };
  return [
    "/* Generado por /api/site-skin — no editar a mano. */",
    "html:root {",
    block(safeLight),
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  html:root:not([data-theme=\"light\"]) {",
    block(safeDark),
    "  }",
    "}",
    "html:root[data-theme=\"dark\"] {",
    block(safeDark),
    "}",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Backends D1 / SQLite / InMemory
// ---------------------------------------------------------------------------

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
    };
  };
}

function rowToRecord(row: Record<string, unknown>): SiteSkinRecord {
  let tokens: DesignTokens = {};
  try {
    const parsed = JSON.parse(String(row.tokens_json ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      tokens = sanitizeTokens(parsed).tokens;
    }
  } catch {
    tokens = {};
  }
  return {
    siteId: row.site_id as string,
    skin: isSkinName(row.skin) ? row.skin : "base",
    tokens,
    updatedAt: row.updated_at as string,
  };
}

export class D1SiteSkinStore implements SiteSkinStore {
  private ready?: Promise<unknown>;
  constructor(private db: D1Like) {}

  private ensure() {
    return (this.ready ??= this.db.prepare(SITE_SKIN_TABLE_DDL).bind().run());
  }

  async get(siteId: string): Promise<SiteSkinRecord | null> {
    await this.ensure();
    const row = await this.db
      .prepare("SELECT site_id, skin, tokens_json, updated_at FROM site_skin WHERE site_id = ?")
      .bind(siteId)
      .first();
    return row ? rowToRecord(row) : null;
  }

  async set(siteId: string, skin: SkinName, tokens: DesignTokens): Promise<SiteSkinRecord> {
    await this.ensure();
    const updatedAt = new Date().toISOString();
    const tokensJson = JSON.stringify(sanitizeTokens(tokens).tokens);
    const existing = await this.db
      .prepare("SELECT site_id FROM site_skin WHERE site_id = ?")
      .bind(siteId)
      .first();
    if (existing) {
      await this.db
        .prepare("UPDATE site_skin SET skin = ?, tokens_json = ?, updated_at = ? WHERE site_id = ?")
        .bind(skin, tokensJson, updatedAt, siteId)
        .run();
    } else {
      await this.db
        .prepare("INSERT INTO site_skin (site_id, skin, tokens_json, updated_at) VALUES (?, ?, ?, ?)")
        .bind(siteId, skin, tokensJson, updatedAt)
        .run();
    }
    return { siteId, skin, tokens: sanitizeTokens(tokens).tokens, updatedAt };
  }
}

export class SqliteSiteSkinStore implements SiteSkinStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteSiteSkinStore> {
    return new SqliteSiteSkinStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error(
        "SqliteSiteSkinStore no acepta una ruta en el constructor. Usa: await SqliteSiteSkinStore.open(path)"
      );
    }
    this.db = db;
    this.db.exec(SITE_SKIN_TABLE_DDL);
  }

  get(siteId: string): Promise<SiteSkinRecord | null> {
    const row = this.db
      .prepare("SELECT site_id, skin, tokens_json, updated_at FROM site_skin WHERE site_id = ?")
      .get(siteId);
    return Promise.resolve(row ? rowToRecord(row) : null);
  }

  set(siteId: string, skin: SkinName, tokens: DesignTokens): Promise<SiteSkinRecord> {
    const updatedAt = new Date().toISOString();
    const tokensJson = JSON.stringify(sanitizeTokens(tokens).tokens);
    const existing = this.db.prepare("SELECT site_id FROM site_skin WHERE site_id = ?").get(siteId);
    if (existing) {
      this.db
        .prepare("UPDATE site_skin SET skin = ?, tokens_json = ?, updated_at = ? WHERE site_id = ?")
        .run(skin, tokensJson, updatedAt, siteId);
    } else {
      this.db
        .prepare("INSERT INTO site_skin (site_id, skin, tokens_json, updated_at) VALUES (?, ?, ?, ?)")
        .run(siteId, skin, tokensJson, updatedAt);
    }
    return Promise.resolve({ siteId, skin, tokens: sanitizeTokens(tokens).tokens, updatedAt });
  }

  close(): void {
    this.db.close();
  }
}

export class InMemorySiteSkinStore implements SiteSkinStore {
  private rows = new Map<string, SiteSkinRecord>();

  get(siteId: string): Promise<SiteSkinRecord | null> {
    return Promise.resolve(this.rows.get(siteId) ?? null);
  }

  set(siteId: string, skin: SkinName, tokens: DesignTokens): Promise<SiteSkinRecord> {
    const record: SiteSkinRecord = {
      siteId,
      skin,
      tokens: sanitizeTokens(tokens).tokens,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(siteId, record);
    return Promise.resolve(record);
  }
}

export async function createSiteSkinStore(env: Record<string, any>): Promise<SiteSkinStore> {
  if (env.DB) {
    return new D1SiteSkinStore(env.DB);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return new SqliteSiteSkinStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  }
  console.warn(
    "createSiteSkinStore: sin DB ni PORTALESS_SQLITE_PATH — usando InMemory (no persiste entre reinicios)."
  );
  return new InMemorySiteSkinStore();
}
