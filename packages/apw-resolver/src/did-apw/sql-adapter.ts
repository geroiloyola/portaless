// packages/apw-resolver/src/did-apw/sql-adapter.ts
//
// Capa minima para que los stores de APW escriban el SQL una sola vez y
// corran igual en D1 (Cloudflare) y en SQLite (self-host, better-sqlite3).
// atomic() ejecuta varias sentencias como una unidad: db.batch() en D1 y
// BEGIN IMMEDIATE / COMMIT en SQLite (sin awaits entre medio, asi no se
// intercala con otra escritura del mismo proceso).

export interface SqlStatement {
  sql: string;
  params?: unknown[];
}

export interface SqlAdapter {
  run(sql: string, params?: unknown[]): Promise<number>;
  first<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  atomic(statements: SqlStatement[]): Promise<number[]>;
}

export class D1Adapter implements SqlAdapter {
  constructor(private readonly db: D1Database) {}

  private bound(sql: string, params: unknown[] = []) {
    return this.db.prepare(sql).bind(...params);
  }

  async run(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.bound(sql, params).run();
    return result?.meta?.changes ?? 0;
  }

  async first<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const row = await this.bound(sql, params).first<T>();
    return row ?? null;
  }

  async all<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.bound(sql, params).all<T>();
    return (result?.results ?? []) as T[];
  }

  async atomic(statements: SqlStatement[]): Promise<number[]> {
    const results = await this.db.batch(statements.map((s) => this.bound(s.sql, s.params)));
    return results.map((r: any) => r?.meta?.changes ?? 0);
  }
}

export class SqliteAdapter implements SqlAdapter {
  constructor(private readonly db: { prepare: (sql: string) => any }) {}

  async run(sql: string, params: unknown[] = []): Promise<number> {
    const result = this.db.prepare(sql).run(...params);
    return result?.changes ?? 0;
  }

  async first<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (this.db.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async all<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async atomic(statements: SqlStatement[]): Promise<number[]> {
    this.db.prepare('BEGIN IMMEDIATE').run();
    try {
      const changes = statements.map((s) => this.db.prepare(s.sql).run(...(s.params ?? [])).changes ?? 0);
      this.db.prepare('COMMIT').run();
      return changes;
    } catch (err) {
      try {
        this.db.prepare('ROLLBACK').run();
      } catch {
        // la transaccion ya no estaba abierta
      }
      throw err;
    }
  }
}
