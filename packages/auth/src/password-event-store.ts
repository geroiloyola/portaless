// Historial de cambios de contrasena (v0.0.9.30). Registra CUANDO y DESDE
// DONDE se cambio o reseteo una contrasena -- NUNCA la contrasena ni su
// hash. Sirve para que el admin detecte un cambio que no hizo el.
//
// Que se guarda: username, tipo (reset | change), fecha ISO, IP, user
// agent (recortado) y ubicacion APROXIMADA (pais/ciudad) que infiere
// Cloudflare de la IP. No se geolocaliza nada por cuenta propia y en
// self-hosted sin Cloudflare la ubicacion queda null.
//
// Privacidad: la IP es un dato personal. Se guarda completa porque es lo
// util para investigar un acceso indebido; si hace falta, se puede agregar
// una purga por antiguedad sobre occurred_at.

import { openSqlite } from "../../sqlite-driver/src/open";

export type PasswordEventKind = "reset" | "change";

export interface PasswordEventContext {
  ip?: string | null;
  userAgent?: string | null;
  country?: string | null;
  city?: string | null;
}

export interface PasswordEvent extends PasswordEventContext {
  username: string;
  kind: PasswordEventKind;
  occurredAt: string;
}

export interface PasswordEventStore {
  record(event: PasswordEvent): Promise<void>;
  listForUser(username: string, limit?: number): Promise<PasswordEvent[]>;
}

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS password_change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  country TEXT,
  city TEXT
)`;
const INSERT_SQL =
  "INSERT INTO password_change_events (username, kind, occurred_at, ip, user_agent, country, city) VALUES (?, ?, ?, ?, ?, ?, ?)";
const LIST_SQL =
  "SELECT username, kind, occurred_at, ip, user_agent, country, city FROM password_change_events WHERE username = ? ORDER BY occurred_at DESC, id DESC LIMIT ?";

function rowToEvent(row: any): PasswordEvent {
  return {
    username: row.username,
    kind: row.kind,
    occurredAt: row.occurred_at,
    ip: row.ip ?? null,
    userAgent: row.user_agent ?? null,
    country: row.country ?? null,
    city: row.city ?? null,
  };
}

function insertArgs(e: PasswordEvent): unknown[] {
  return [e.username, e.kind, e.occurredAt, e.ip ?? null, e.userAgent ?? null, e.country ?? null, e.city ?? null];
}

export class D1PasswordEventStore implements PasswordEventStore {
  private ready: Promise<unknown> | null = null;
  constructor(private readonly db: any) {}

  private ensure() {
    if (!this.ready) this.ready = this.db.prepare(CREATE_SQL).run();
    return this.ready;
  }

  async record(event: PasswordEvent): Promise<void> {
    await this.ensure();
    await this.db.prepare(INSERT_SQL).bind(...insertArgs(event)).run();
  }

  async listForUser(username: string, limit = 20): Promise<PasswordEvent[]> {
    await this.ensure();
    const { results } = await this.db.prepare(LIST_SQL).bind(username, limit).all();
    return (results ?? []).map(rowToEvent);
  }
}

export class SqlitePasswordEventStore implements PasswordEventStore {
  constructor(private readonly db: { prepare: (sql: string) => any }) {
    this.db.prepare(CREATE_SQL).run();
  }

  async record(event: PasswordEvent): Promise<void> {
    this.db.prepare(INSERT_SQL).run(...insertArgs(event));
  }

  async listForUser(username: string, limit = 20): Promise<PasswordEvent[]> {
    return (this.db.prepare(LIST_SQL).all(username, limit) as any[]).map(rowToEvent);
  }
}

export class InMemoryPasswordEventStore implements PasswordEventStore {
  private events: PasswordEvent[] = [];

  async record(event: PasswordEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async listForUser(username: string, limit = 20): Promise<PasswordEvent[]> {
    return this.events
      .filter((e) => e.username === username)
      .reverse()
      .slice(0, limit);
  }
}

/** Extrae IP, user agent y ubicacion aproximada (solo la que da Cloudflare) de un Request. */
export function passwordEventContextFromRequest(request: Request): PasswordEventContext {
  const h = request.headers;
  const forwarded = h.get("X-Forwarded-For")?.split(",")[0]?.trim() || null;
  const cf = (request as unknown as { cf?: { country?: string; city?: string } }).cf;
  return {
    ip: h.get("CF-Connecting-IP") || forwarded,
    userAgent: h.get("User-Agent")?.slice(0, 256) ?? null,
    country: cf?.country ?? h.get("CF-IPCountry") ?? null,
    city: cf?.city ?? null,
  };
}

let cachedSqlite: PasswordEventStore | null = null;
let cachedMemory: PasswordEventStore | null = null;

export async function createPasswordEventStore(env: { DB?: unknown; PORTALESS_SQLITE_PATH?: string }): Promise<PasswordEventStore> {
  if (env.DB) return new D1PasswordEventStore(env.DB);
  if (env.PORTALESS_SQLITE_PATH) {
    if (!cachedSqlite) cachedSqlite = new SqlitePasswordEventStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
    return cachedSqlite;
  }
  console.warn("[Portaless Auth] Sin DB ni PORTALESS_SQLITE_PATH -- el historial de contrasenas vive en memoria.");
  if (!cachedMemory) cachedMemory = new InMemoryPasswordEventStore();
  return cachedMemory;
}
