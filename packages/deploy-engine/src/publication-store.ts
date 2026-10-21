// Durable publication-run state (C34). Rows contain identifiers and outcome
// metadata only: no page content, tokens, provider responses or error bodies.

import { openSqlite } from "../../sqlite-driver/src/open";

export type PublicationRunStatus =
  | "queued"
  | "building"
  | "deploying"
  | "published"
  | "failed"
  | "unpublishing"
  | "unpublished";

export interface PublicationRun {
  id: string;
  siteId: string;
  provider: string;
  snapshotHash: string;
  revisionIds: Record<string, string>;
  status: PublicationRunStatus;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  commitSha: string | null;
  pagesUrl: string | null;
}

export interface PublicationRunPatch {
  status?: PublicationRunStatus;
  attempts?: number;
  finishedAt?: string | null;
  errorCode?: string | null;
  commitSha?: string | null;
  pagesUrl?: string | null;
}

export interface PublicationRunStore {
  create(run: PublicationRun): Promise<void>;
  update(id: string, patch: PublicationRunPatch): Promise<PublicationRun | null>;
  get(id: string): Promise<PublicationRun | null>;
  latest(siteId: string): Promise<PublicationRun | null>;
  latestPublished(siteId: string): Promise<PublicationRun | null>;
  findBySnapshot(siteId: string, snapshotHash: string): Promise<PublicationRun | null>;
  list(siteId: string, limit?: number): Promise<PublicationRun[]>;
}

const COLUMNS = "id, site_id, provider, snapshot_hash, revision_ids_json, status, attempts, started_at, finished_at, error_code, commit_sha, pages_url";

function parseRevisionIds(raw: unknown): Record<string, string> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  } catch {
    return {};
  }
}

function rowToRun(row: any): PublicationRun {
  return {
    id: String(row.id),
    siteId: String(row.site_id),
    provider: String(row.provider),
    snapshotHash: String(row.snapshot_hash),
    revisionIds: parseRevisionIds(row.revision_ids_json),
    status: String(row.status) as PublicationRunStatus,
    attempts: Number(row.attempts),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ?? null,
    errorCode: row.error_code ?? null,
    commitSha: row.commit_sha ?? null,
    pagesUrl: row.pages_url ?? null,
  };
}

const INSERT = `INSERT INTO publication_runs (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function values(run: PublicationRun): unknown[] {
  return [
    run.id, run.siteId, run.provider, run.snapshotHash, JSON.stringify(run.revisionIds),
    run.status, run.attempts, run.startedAt, run.finishedAt, run.errorCode, run.commitSha, run.pagesUrl,
  ];
}

export class D1PublicationRunStore implements PublicationRunStore {
  constructor(private readonly db: any) {}
  async create(run: PublicationRun): Promise<void> { await this.db.prepare(INSERT).bind(...values(run)).run(); }
  async update(id: string, patch: PublicationRunPatch): Promise<PublicationRun | null> {
    const sets: string[] = [];
    const args: unknown[] = [];
    const map: Record<string, string> = {
      status: "status", attempts: "attempts", finishedAt: "finished_at",
      errorCode: "error_code", commitSha: "commit_sha", pagesUrl: "pages_url",
    };
    for (const [key, column] of Object.entries(map)) {
      if (!(key in patch)) continue;
      sets.push(`${column}=?`);
      args.push((patch as Record<string, unknown>)[key]);
    }
    if (sets.length) await this.db.prepare(`UPDATE publication_runs SET ${sets.join(", ")} WHERE id=?`).bind(...args, id).run();
    return this.get(id);
  }
  async get(id: string): Promise<PublicationRun | null> {
    const row = await this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE id=?`).bind(id).first();
    return row ? rowToRun(row) : null;
  }
  async latest(siteId: string): Promise<PublicationRun | null> {
    const row = await this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE site_id=? ORDER BY started_at DESC, id DESC LIMIT 1`).bind(siteId).first();
    return row ? rowToRun(row) : null;
  }
  async latestPublished(siteId: string): Promise<PublicationRun | null> {
    const row = await this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE site_id=? AND status='published' ORDER BY started_at DESC, id DESC LIMIT 1`).bind(siteId).first();
    return row ? rowToRun(row) : null;
  }
  async findBySnapshot(siteId: string, snapshotHash: string): Promise<PublicationRun | null> {
    const row = await this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE site_id=? AND snapshot_hash=? ORDER BY started_at DESC, id DESC LIMIT 1`).bind(siteId, snapshotHash).first();
    return row ? rowToRun(row) : null;
  }
  async list(siteId: string, limit = 20): Promise<PublicationRun[]> {
    const { results } = await this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE site_id=? ORDER BY started_at DESC, id DESC LIMIT ?`).bind(siteId, limit).all();
    return (results ?? []).map(rowToRun);
  }
}

export class SqlitePublicationRunStore implements PublicationRunStore {
  static async open(path: string): Promise<SqlitePublicationRunStore> { return new SqlitePublicationRunStore(await openSqlite(path)); }
  constructor(private readonly db: any) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS publication_runs (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, provider TEXT NOT NULL, snapshot_hash TEXT NOT NULL, revision_ids_json TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL, finished_at TEXT, error_code TEXT, commit_sha TEXT, pages_url TEXT);
      CREATE INDEX IF NOT EXISTS idx_publication_runs_snapshot ON publication_runs(snapshot_hash, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_publication_runs_status ON publication_runs(status, started_at DESC);`);
  }
  async create(run: PublicationRun): Promise<void> { this.db.prepare(INSERT).run(...values(run)); }
  async update(id: string, patch: PublicationRunPatch): Promise<PublicationRun | null> {
    const sets: string[] = []; const args: unknown[] = [];
    const map: Record<string, string> = { status: "status", attempts: "attempts", finishedAt: "finished_at", errorCode: "error_code", commitSha: "commit_sha", pagesUrl: "pages_url" };
    for (const [key, column] of Object.entries(map)) { if (key in patch) { sets.push(`${column}=?`); args.push((patch as Record<string, unknown>)[key]); } }
    if (sets.length) this.db.prepare(`UPDATE publication_runs SET ${sets.join(", ")} WHERE id=?`).run(...args, id);
    return this.get(id);
  }
  async get(id: string): Promise<PublicationRun | null> { const row = this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE id=?`).get(id); return row ? rowToRun(row) : null; }
  async latest(siteId: string): Promise<PublicationRun | null> { const row = this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE site_id=? ORDER BY started_at DESC, id DESC LIMIT 1`).get(siteId); return row ? rowToRun(row) : null; }
  async latestPublished(siteId: string): Promise<PublicationRun | null> { const row = this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE site_id=? AND status='published' ORDER BY started_at DESC, id DESC LIMIT 1`).get(siteId); return row ? rowToRun(row) : null; }
  async findBySnapshot(siteId: string, snapshotHash: string): Promise<PublicationRun | null> { const row = this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE site_id=? AND snapshot_hash=? ORDER BY started_at DESC, id DESC LIMIT 1`).get(siteId, snapshotHash); return row ? rowToRun(row) : null; }
  async list(siteId: string, limit = 20): Promise<PublicationRun[]> { return this.db.prepare(`SELECT ${COLUMNS} FROM publication_runs WHERE site_id=? ORDER BY started_at DESC, id DESC LIMIT ?`).all(siteId, limit).map(rowToRun); }
}

export class InMemoryPublicationRunStore implements PublicationRunStore {
  private readonly runs = new Map<string, PublicationRun>();
  async create(run: PublicationRun): Promise<void> { this.runs.set(run.id, { ...run, revisionIds: { ...run.revisionIds } }); }
  async update(id: string, patch: PublicationRunPatch): Promise<PublicationRun | null> {
    const run = this.runs.get(id);
    if (!run) return null;
    const next = { ...run, ...patch };
    this.runs.set(id, next);
    return { ...next, revisionIds: { ...next.revisionIds } };
  }
  async get(id: string): Promise<PublicationRun | null> { const run = this.runs.get(id); return run ? { ...run, revisionIds: { ...run.revisionIds } } : null; }
  async latest(siteId: string): Promise<PublicationRun | null> { return this.sorted(siteId)[0] ?? null; }
  async latestPublished(siteId: string): Promise<PublicationRun | null> { return this.sorted(siteId).find((run) => run.status === "published") ?? null; }
  async findBySnapshot(siteId: string, snapshotHash: string): Promise<PublicationRun | null> { return this.sorted(siteId).find((run) => run.snapshotHash === snapshotHash) ?? null; }
  async list(siteId: string, limit = 20): Promise<PublicationRun[]> { return this.sorted(siteId).slice(0, limit); }
  private sorted(siteId: string): PublicationRun[] {
    return [...this.runs.values()].filter((run) => run.siteId === siteId)
      .sort((a, b) => a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.id < b.id ? 1 : -1)
      .map((run) => ({ ...run, revisionIds: { ...run.revisionIds } }));
  }
}

export interface PublicationRunStoreEnv { DB?: unknown; PORTALESS_SQLITE_PATH?: string }
let cachedSqlite: SqlitePublicationRunStore | null = null;
const cachedD1 = new WeakMap<object, D1PublicationRunStore>();
export async function createPublicationRunStore(env: PublicationRunStoreEnv): Promise<PublicationRunStore> {
  if (env.DB) {
    const db = env.DB as object;
    let store = cachedD1.get(db);
    if (!store) { store = new D1PublicationRunStore(env.DB); cachedD1.set(db, store); }
    return store;
  }
  if (env.PORTALESS_SQLITE_PATH) {
    if (!cachedSqlite) cachedSqlite = await SqlitePublicationRunStore.open(env.PORTALESS_SQLITE_PATH);
    return cachedSqlite;
  }
  return new InMemoryPublicationRunStore();
}
export function __resetPublicationRunStoreForTests(): void { cachedSqlite = null; }
