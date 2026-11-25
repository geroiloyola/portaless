// Portaless node SQLite/D1 storage adapters for pay-per-crawl settlement activations (Node-L0).
import { openSqlite } from "@portaless/sqlite-driver";
import {
  InMemorySettlementActivationStore,
  SETTLEMENT_ACTIVATIONS_DDL,
  type SettlementActivation,
  type SettlementActivationStore,
} from "@verared/trust-layer/billing";

const UPSERT = `INSERT INTO settlement_provider_activations (provider_id, credential_enc, metadata_json, verified_at, activated_by)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(provider_id) DO UPDATE SET credential_enc=excluded.credential_enc, metadata_json=excluded.metadata_json,
    verified_at=excluded.verified_at, activated_by=excluded.activated_by`;

function rowTo(r: any): SettlementActivation {
  let metadata: Record<string, string> = {};
  try {
    metadata = JSON.parse(r.metadata_json || "{}");
  } catch {}
  return {
    providerId: r.provider_id,
    credentialEnc: r.credential_enc,
    metadata,
    verifiedAt: r.verified_at,
    activatedBy: r.activated_by,
  };
}

const args = (a: SettlementActivation) => [
  a.providerId,
  a.credentialEnc,
  JSON.stringify(a.metadata ?? {}),
  a.verifiedAt,
  a.activatedBy,
];

export class D1SettlementActivationStore implements SettlementActivationStore {
  private ready: Promise<void> | null = null;
  constructor(private db: any) {}
  private ensure() {
    return (this.ready ??= this.db.prepare(SETTLEMENT_ACTIVATIONS_DDL).run().then(() => {}));
  }
  async get(providerId: string) {
    await this.ensure();
    const row = await this.db
      .prepare("SELECT * FROM settlement_provider_activations WHERE provider_id = ?")
      .bind(providerId)
      .first();
    return row ? rowTo(row) : null;
  }
  async save(a: SettlementActivation) {
    await this.ensure();
    await this.db.prepare(UPSERT).bind(...args(a)).run();
  }
  async delete(providerId: string) {
    await this.ensure();
    await this.db
      .prepare("DELETE FROM settlement_provider_activations WHERE provider_id = ?")
      .bind(providerId)
      .run();
  }
}

export class SqliteSettlementActivationStore implements SettlementActivationStore {
  constructor(private db: any) {
    this.db.exec(SETTLEMENT_ACTIVATIONS_DDL);
  }
  async get(providerId: string) {
    const row = this.db
      .prepare("SELECT * FROM settlement_provider_activations WHERE provider_id = ?")
      .get(providerId);
    return row ? rowTo(row) : null;
  }
  async save(a: SettlementActivation) {
    this.db.prepare(UPSERT).run(...args(a));
  }
  async delete(providerId: string) {
    this.db.prepare("DELETE FROM settlement_provider_activations WHERE provider_id = ?").run(providerId);
  }
}

let memorySingleton: InMemorySettlementActivationStore | null = null;
export async function createSettlementActivationStore(env: any): Promise<SettlementActivationStore> {
  if (env?.DB) return new D1SettlementActivationStore(env.DB);
  if (env?.PORTALESS_SQLITE_PATH) {
    return new SqliteSettlementActivationStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  }
  return (memorySingleton ??= new InMemorySettlementActivationStore());
}
