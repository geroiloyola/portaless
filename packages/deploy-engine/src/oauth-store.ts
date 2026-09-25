// Persistencia del flujo OAuth de despliegue: states efimeros (anti-CSRF + PKCE)
// y credenciales cifradas por proveedor. D1 / SQLite / memoria.
// v0.0.9.27: el factory abre SQLite via openSqlite() (driver unico + guardia
// de runtime workerd), en vez de importar better-sqlite3 directo.
import { openSqlite } from "../../sqlite-driver/src/open";

export interface OAuthStateRecord {
  state: string;
  provider: string;
  codeVerifier: string;
  userId: string;
  expiresAt: string;
}
export interface DeploymentCredential {
  provider: string;
  accountLogin: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  connectedBy: string;
  updatedAt: string;
}
export interface DeploymentOAuthStore {
  saveState(r: OAuthStateRecord): Promise<void>;
  /** Lee y BORRA el state: un solo uso, evita replay del callback. */
  consumeState(state: string): Promise<OAuthStateRecord | null>;
  saveCredential(c: DeploymentCredential): Promise<void>;
  getCredential(provider: string): Promise<DeploymentCredential | null>;
  deleteCredential(provider: string): Promise<void>;
}

const now = () => new Date().toISOString();

function rowToState(r: any): OAuthStateRecord {
  return { state: r.state, provider: r.provider, codeVerifier: r.code_verifier, userId: r.user_id, expiresAt: r.expires_at };
}
function rowToCred(r: any): DeploymentCredential {
  return {
    provider: r.provider, accountLogin: r.account_login, accessTokenEnc: r.access_token_enc,
    refreshTokenEnc: r.refresh_token_enc, accessExpiresAt: r.access_expires_at,
    refreshExpiresAt: r.refresh_expires_at, connectedBy: r.connected_by, updatedAt: r.updated_at,
  };
}
const UPSERT = `INSERT INTO deployment_credentials
  (provider, account_login, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, connected_by, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider) DO UPDATE SET account_login=excluded.account_login,
    access_token_enc=excluded.access_token_enc, refresh_token_enc=excluded.refresh_token_enc,
    access_expires_at=excluded.access_expires_at, refresh_expires_at=excluded.refresh_expires_at,
    connected_by=excluded.connected_by, updated_at=excluded.updated_at`;
const credArgs = (c: DeploymentCredential) => [c.provider, c.accountLogin, c.accessTokenEnc, c.refreshTokenEnc,
  c.accessExpiresAt, c.refreshExpiresAt, c.connectedBy, c.updatedAt];

export class D1DeploymentOAuthStore implements DeploymentOAuthStore {
  constructor(private db: any) {}
  async saveState(r: OAuthStateRecord) {
    await this.db.prepare("DELETE FROM deployment_oauth_states WHERE expires_at < ?").bind(now()).run();
    await this.db.prepare(
      "INSERT INTO deployment_oauth_states (state, provider, code_verifier, user_id, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(r.state, r.provider, r.codeVerifier, r.userId, r.expiresAt).run();
  }
  async consumeState(state: string) {
    const row = await this.db.prepare("DELETE FROM deployment_oauth_states WHERE state = ? RETURNING *").bind(state).first();
    if (!row) return null;
    const rec = rowToState(row);
    return rec.expiresAt < now() ? null : rec;
  }
  async saveCredential(c: DeploymentCredential) { await this.db.prepare(UPSERT).bind(...credArgs(c)).run(); }
  async getCredential(provider: string) {
    const row = await this.db.prepare("SELECT * FROM deployment_credentials WHERE provider = ?").bind(provider).first();
    return row ? rowToCred(row) : null;
  }
  async deleteCredential(provider: string) {
    await this.db.prepare("DELETE FROM deployment_credentials WHERE provider = ?").bind(provider).run();
  }
}

export class SqliteDeploymentOAuthStore implements DeploymentOAuthStore {
  constructor(private db: any) {}
  async saveState(r: OAuthStateRecord) {
    this.db.prepare("DELETE FROM deployment_oauth_states WHERE expires_at < ?").run(now());
    this.db.prepare(
      "INSERT INTO deployment_oauth_states (state, provider, code_verifier, user_id, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).run(r.state, r.provider, r.codeVerifier, r.userId, r.expiresAt);
  }
  async consumeState(state: string) {
    const row = this.db.prepare("SELECT * FROM deployment_oauth_states WHERE state = ?").get(state);
    if (!row) return null;
    this.db.prepare("DELETE FROM deployment_oauth_states WHERE state = ?").run(state);
    const rec = rowToState(row);
    return rec.expiresAt < now() ? null : rec;
  }
  async saveCredential(c: DeploymentCredential) { this.db.prepare(UPSERT).run(...credArgs(c)); }
  async getCredential(provider: string) {
    const row = this.db.prepare("SELECT * FROM deployment_credentials WHERE provider = ?").get(provider);
    return row ? rowToCred(row) : null;
  }
  async deleteCredential(provider: string) {
    this.db.prepare("DELETE FROM deployment_credentials WHERE provider = ?").run(provider);
  }
}

export class InMemoryDeploymentOAuthStore implements DeploymentOAuthStore {
  private states = new Map<string, OAuthStateRecord>();
  private creds = new Map<string, DeploymentCredential>();
  async saveState(r: OAuthStateRecord) { this.states.set(r.state, r); }
  async consumeState(state: string) {
    const r = this.states.get(state);
    this.states.delete(state);
    if (!r || r.expiresAt < now()) return null;
    return r;
  }
  async saveCredential(c: DeploymentCredential) { this.creds.set(c.provider, c); }
  async getCredential(p: string) { return this.creds.get(p) ?? null; }
  async deleteCredential(p: string) { this.creds.delete(p); }
}

let memorySingleton: InMemoryDeploymentOAuthStore | null = null;
export async function createDeploymentOAuthStore(env: any): Promise<DeploymentOAuthStore> {
  if (env?.DB) return new D1DeploymentOAuthStore(env.DB);
  if (env?.PORTALESS_SQLITE_PATH) {
    return new SqliteDeploymentOAuthStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  }
  console.warn("[Portaless Deploy] Sin DB ni PORTALESS_SQLITE_PATH. Credenciales OAuth solo en memoria.");
  return (memorySingleton ??= new InMemoryDeploymentOAuthStore());
}
