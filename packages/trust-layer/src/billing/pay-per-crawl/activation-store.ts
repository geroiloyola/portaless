// Activaciones de proveedores pay-per-crawl. D1 / SQLite / memoria, mismo
// patron que deploy-engine/src/oauth-store.ts.
//
// La credencial se guarda cifrada con token-crypto (AES-GCM) usando
// PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY: es una credencial de infraestructura
// en reposo, igual que deployment_credentials. El middleware NUNCA la
// descifra: solo lee si hay activacion; el token se usa al activar y al
// re-verificar.
//
// La tabla se crea con IF NOT EXISTS al primer uso de cada store, para no
// depender de regenerar schema.sql en este PR. Referencia:
// schema-additions/settlement-activations.sql.

import { openSqlite } from "../../../../sqlite-driver/src/open";

export interface SettlementActivation {
  providerId: string;
  credentialEnc: string;
  metadata: Record<string, string>;
  verifiedAt: string;
  activatedBy: string;
}

export interface SettlementActivationStore {
  get(providerId: string): Promise<SettlementActivation | null>;
  save(a: SettlementActivation): Promise<void>;
  delete(providerId: string): Promise<void>;
}

export const SETTLEMENT_ACTIVATIONS_DDL = `CREATE TABLE IF NOT EXISTS settlement_provider_activations (
  provider_id TEXT PRIMARY KEY,
  credential_enc TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT NOT NULL,
  activated_by TEXT NOT NULL
)`;

const UPSERT = `INSERT INTO settlement_provider_activations (provider_id, credential_enc, metadata_json, verified_at, activated_by)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(provider_id) DO UPDATE SET credential_enc=excluded.credential_enc, metadata_json=excluded.metadata_json,
    verified_at=excluded.verified_at, activated_by=excluded.activated_by`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(r: any): SettlementActivation {
  let metadata: Record<string, string> = {};
  try { metadata = JSON.parse(r.metadata_json || "{}"); } catch {}
  return { providerId: r.provider_id, credentialEnc: r.credential_enc, metadata, verifiedAt: r.verified_at, activatedBy: r.activated_by };
}
const args = (a: SettlementActivation) => [a.providerId, a.credentialEnc, JSON.stringify(a.metadata ?? {}), a.verifiedAt, a.activatedBy];

export class D1SettlementActivationStore implements SettlementActivationStore {
  private ready: Promise<void> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any) {}
  private ensure() { return (this.ready ??= this.db.prepare(SETTLEMENT_ACTIVATIONS_DDL).run().then(() => {})); }
  async get(providerId: string) {
    await this.ensure();
    const row = await this.db.prepare("SELECT * FROM settlement_provider_activations WHERE provider_id = ?").bind(providerId).first();
    return row ? rowTo(row) : null;
  }
  async save(a: SettlementActivation) { await this.ensure(); await this.db.prepare(UPSERT).bind(...args(a)).run(); }
  async delete(providerId: string) {
    await this.ensure();
    await this.db.prepare("DELETE FROM settlement_provider_activations WHERE provider_id = ?").bind(providerId).run();
  }
}

export class SqliteSettlementActivationStore implements SettlementActivationStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any) { this.db.exec(SETTLEMENT_ACTIVATIONS_DDL); }
  async get(providerId: string) {
    const row = this.db.prepare("SELECT * FROM settlement_provider_activations WHERE provider_id = ?").get(providerId);
    return row ? rowTo(row) : null;
  }
  async save(a: SettlementActivation) { this.db.prepare(UPSERT).run(...args(a)); }
  async delete(providerId: string) { this.db.prepare("DELETE FROM settlement_provider_activations WHERE provider_id = ?").run(providerId); }
}

export class InMemorySettlementActivationStore implements SettlementActivationStore {
  private rows = new Map<string, SettlementActivation>();
  async get(id: string) { return this.rows.get(id) ?? null; }
  async save(a: SettlementActivation) { this.rows.set(a.providerId, a); }
  async delete(id: string) { this.rows.delete(id); }
}

let memorySingleton: InMemorySettlementActivationStore | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createSettlementActivationStore(env: any): Promise<SettlementActivationStore> {
  if (env?.DB) return new D1SettlementActivationStore(env.DB);
  if (env?.PORTALESS_SQLITE_PATH) return new SqliteSettlementActivationStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  return (memorySingleton ??= new InMemorySettlementActivationStore());
}
