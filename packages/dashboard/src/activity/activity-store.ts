// packages/dashboard/src/activity/activity-store.ts
//
// Feed de actividad del sitio (Fase 10). Una tabla append-only con lo que
// pasa en el dashboard y en el runtime: paginas guardadas/borradas,
// atestaciones comunitarias recibidas, cambios de permisos, statements de
// testigo grabados y cambios/resets de contrasena. Es el reemplazo honesto de
// los paneles mock que mostraban datos falsos (traffic, ledger, orders,
// revenue) -- ver ROADMAP.md, Fase 10.
//
// FUENTES ACTUALES (emitActivity en el punto de escritura): page.saved y
// page.deleted (functions/admin/pages/[slug].js), community.attestation
// (functions/trust/[siteId]/community-attestation.js), permission.granted /
// permission.revoked (functions/admin/permissions/index.js), witness.recorded
// (functions/admin/api/witness/record.js), password.changed
// (functions/admin/api/change-password.js) y password.reset
// (functions/admin/password-reset/confirm.js).
//
// NO ES FUENTE: posts. Los posts son markdown estatico
// (src/content/posts/*.md) que se publica en build; no hay escritor runtime,
// asi que no hay punto donde emitir. Se documenta en vez de inventar un
// emisor. (Tampoco lo son orders/revenue/trafico-humano: no existen como
// datos.)
//
// ADMIN-ONLY POR DISENO: activity_events alimenta /admin/api/recents, que
// corre bajo la sesion de /admin/*. No es una fuente publica. Por eso NO se
// guardan IPs, hashes de IP, ni user agents: eso vive (cuando aplica) en
// password_change_events, que es auditoria interna con otra superficie. Si
// algun dia se quiere un feed publico, es OTRA tabla y otra decision de
// privacidad -- no se filtra esta.
//
// SIN BACKFILL: el feed arranca vacio y solo registra lo que ocurre despues
// del deploy. Copiar filas desde tablas existentes divergiria de sus fuentes
// (la tabla ya no seria la verdad); el precio es que el historial previo no
// aparece, y eso se documenta en vez de inventarlo.
//
// UN SOLO ESCRITOR: emitActivity() es la unica puerta. Se llama desde cada
// punto de escritura (no hay triggers ni copias). Si falla, se traga el error
// con un warn: registrar actividad NUNCA debe romper la accion principal.
//
// Mismo patron D1 -> SQLite -> InMemory con factory que el resto del repo
// (site-settings-store.ts). La tabla vive en
// schema-additions/activity-events.sql; el store trae su DDL para arrancar
// en SQLite/InMemory vacio.

import { openSqlite } from "../../../sqlite-driver/src/open";

export interface ActivityEvent {
  id: number;
  kind: string;
  actor: string | null;
  subject: string;
  detail: string | null;
  occurredAt: string;
}

/** Lo que un punto de escritura declara. occurredAt por defecto = ahora. */
export interface ActivityInput {
  kind: string;
  subject: string;
  actor?: string | null;
  detail?: string | null;
  occurredAt?: string;
}

export interface ActivityStore {
  record(event: ActivityInput): Promise<void>;
  list(limit?: number): Promise<ActivityEvent[]>;
}

export const ACTIVITY_EVENTS_TABLE_DDL =
  "CREATE TABLE IF NOT EXISTS activity_events (" +
  "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
  "kind TEXT NOT NULL, " +
  "actor TEXT, " +
  "subject TEXT NOT NULL, " +
  "detail TEXT, " +
  "occurred_at TEXT NOT NULL)";

export const ACTIVITY_EVENTS_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_activity_events_occurred ON activity_events(occurred_at DESC, id DESC)";

const KIND_RE = /^[a-z][a-z0-9._-]{0,63}$/;
const MAX_ACTOR = 120;
const MAX_SUBJECT = 200;
const MAX_DETAIL = 200;

/** Normaliza y valida una entrada. Lanza si es invalida (el caller decide). */
function normalize(input: ActivityInput): ActivityEvent {
  if (!input || typeof input.kind !== "string" || !KIND_RE.test(input.kind)) {
    throw new Error(`activity_events: kind invalido (${String(input?.kind)})`);
  }
  if (typeof input.subject !== "string" || input.subject.length === 0 || input.subject.length > MAX_SUBJECT) {
    throw new Error("activity_events: subject invalido");
  }
  const actor = input.actor == null ? null : String(input.actor);
  const detail = input.detail == null ? null : String(input.detail);
  if (actor !== null && actor.length > MAX_ACTOR) throw new Error("activity_events: actor demasiado largo");
  if (detail !== null && detail.length > MAX_DETAIL) throw new Error("activity_events: detail demasiado largo");
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  return { id: 0, kind: input.kind, actor, subject: input.subject, detail, occurredAt };
}

function rowToEvent(row: Record<string, unknown>): ActivityEvent {
  return {
    id: Number(row.id ?? 0),
    kind: String(row.kind ?? ""),
    actor: row.actor == null ? null : String(row.actor),
    subject: String(row.subject ?? ""),
    detail: row.detail == null ? null : String(row.detail),
    occurredAt: String(row.occurred_at ?? ""),
  };
}

export class D1ActivityStore implements ActivityStore {
  private ready?: Promise<unknown>;
  constructor(private db: any) {}

  private ensure() {
    return (this.ready ??= this.db
      .prepare(ACTIVITY_EVENTS_TABLE_DDL)
      .bind()
      .run()
      .then(() => this.db.prepare(ACTIVITY_EVENTS_INDEX_DDL).bind().run()));
  }

  async record(input: ActivityInput): Promise<void> {
    const e = normalize(input);
    await this.ensure();
    await this.db
      .prepare("INSERT INTO activity_events (kind, actor, subject, detail, occurred_at) VALUES (?, ?, ?, ?, ?)")
      .bind(e.kind, e.actor, e.subject, e.detail, e.occurredAt)
      .run();
  }

  async list(limit = 50): Promise<ActivityEvent[]> {
    await this.ensure();
    const { results } = await this.db
      .prepare("SELECT id, kind, actor, subject, detail, occurred_at FROM activity_events ORDER BY occurred_at DESC, id DESC LIMIT ?")
      .bind(limit)
      .all();
    return (results ?? []).map(rowToEvent);
  }
}

export class SqliteActivityStore implements ActivityStore {
  private db: any;

  static async open(dbPath: string): Promise<SqliteActivityStore> {
    return new SqliteActivityStore(await openSqlite(dbPath));
  }

  constructor(db: any) {
    if (typeof db === "string") {
      throw new Error("SqliteActivityStore no acepta una ruta en el constructor. Usa: await SqliteActivityStore.open(path)");
    }
    this.db = db;
    this.db.exec(ACTIVITY_EVENTS_TABLE_DDL);
    this.db.exec(ACTIVITY_EVENTS_INDEX_DDL);
  }

  async record(input: ActivityInput): Promise<void> {
    const e = normalize(input);
    this.db
      .prepare("INSERT INTO activity_events (kind, actor, subject, detail, occurred_at) VALUES (?, ?, ?, ?, ?)")
      .run(e.kind, e.actor, e.subject, e.detail, e.occurredAt);
  }

  async list(limit = 50): Promise<ActivityEvent[]> {
    return (this.db
      .prepare("SELECT id, kind, actor, subject, detail, occurred_at FROM activity_events ORDER BY occurred_at DESC, id DESC LIMIT ?")
      .all(limit) as any[]).map(rowToEvent);
  }

  close(): void {
    this.db.close();
  }
}

export class InMemoryActivityStore implements ActivityStore {
  private rows: ActivityEvent[] = [];
  private nextId = 1;

  async record(input: ActivityInput): Promise<void> {
    const e = normalize(input);
    this.rows.push({ ...e, id: this.nextId++ });
  }

  async list(limit = 50): Promise<ActivityEvent[]> {
    return this.rows.slice().reverse().slice(0, limit);
  }
}

export async function createActivityStore(env: Record<string, any>): Promise<ActivityStore> {
  if (env.DB) {
    return new D1ActivityStore(env.DB);
  }
  if (env.PORTALESS_SQLITE_PATH) {
    return new SqliteActivityStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  }
  console.warn(
    "createActivityStore: sin DB ni PORTALESS_SQLITE_PATH — usando InMemory (no persiste entre reinicios)."
  );
  return new InMemoryActivityStore();
}

/**
 * UNICO escritor del feed. Nunca lanza: si el store falla, se registra un warn
 * y la accion que disparo el evento sigue su curso. Un feed de actividad no
 * puede hacer fallar un guardado, una atestacion ni un cambio de permisos.
 */
export async function emitActivity(env: Record<string, any>, input: ActivityInput): Promise<void> {
  try {
    const store = await createActivityStore(env);
    await store.record(input);
  } catch (err) {
    console.warn(`emitActivity: no se pudo registrar "${input?.kind}" — ${err instanceof Error ? err.message : err}`);
  }
}
