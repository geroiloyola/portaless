// Pure WebBotAuthNonceStore port and InMemory implementation (L2).
// SQLite/D1 adapters live in `@portaless/trust-storage-adapters` (Node-L0).

export interface WebBotAuthNonceStore {
  /**
   * Registra `nonce` si no existia vivo. Devuelve false si ya se registro
   * antes dentro de su ventana (replay).
   */
  registerIfUnseen(nonce: string, nowMs: number, ttlMs: number): Promise<boolean>;
}

export const NONCES_DDL =
  "CREATE TABLE IF NOT EXISTS webbotauth_nonces (" +
  "nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)";

export interface NonceStoreFactoryEnv {
  DB?: unknown;
  PORTALESS_SQLITE_PATH?: string;
}

export class InMemoryWebBotAuthNonceStore implements WebBotAuthNonceStore {
  private nonces = new Map<string, number>();

  async registerIfUnseen(nonce: string, nowMs: number, ttlMs: number): Promise<boolean> {
    for (const [seen, expiresAt] of this.nonces) {
      if (expiresAt <= nowMs) this.nonces.delete(seen);
    }
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, nowMs + ttlMs);
    return true;
  }

  clear(): void {
    this.nonces.clear();
  }
}
