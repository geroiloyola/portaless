// Pure SettlementActivationStore port and InMemory implementation (L2).
// SQLite/D1 adapters live in `@portaless/trust-storage-adapters` (Node-L0).

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

export class InMemorySettlementActivationStore implements SettlementActivationStore {
  private rows = new Map<string, SettlementActivation>();
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async save(a: SettlementActivation) {
    this.rows.set(a.providerId, a);
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
}
