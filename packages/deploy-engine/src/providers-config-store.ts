// v0.0.9.27 -- Configuracion dinamica de la GitHub App registrada via manifiesto.
// Los secretos (client_secret, pem, webhook_secret) llegan de GitHub en runtime
// y se guardan CIFRADOS con PORTALESS_OAUTH_TOKEN_ENCRYPTION_KEY. Separado de
// deployment_credentials: aca vive la identidad de la App, alla los tokens
// de usuario que esa App emite.
import { encryptToken, decryptToken } from "./token-crypto";
import { openSqlite } from "../../sqlite-driver/src/open";

export const GITHUB_APP_PROVIDER_ID = "github_app";

export interface ProviderConfig {
  providerId: string;
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string | null;
  htmlUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderConfigRow {
  provider_id: string;
  app_id: string;
  app_slug: string;
  client_id: string;
  client_secret_enc: string;
  private_key_enc: string;
  webhook_secret_enc: string | null;
  html_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderConfigStore {
  /** Solo INSERT: falla si ya existe (PK). La rotacion sera un flujo aparte. */
  insert(row: ProviderConfigRow): Promise<void>;
  get(providerId: string): Promise<ProviderConfigRow | null>;
}

const COLS =
  "provider_id, app_id, app_slug, client_id, client_secret_enc, private_key_enc, webhook_secret_enc, html_url, created_by, created_at, updated_at";
const INSERT = `INSERT INTO deployment_providers_config (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SELECT = `SELECT ${COLS} FROM deployment_providers_config WHERE provider_id = ?`;
const rowArgs = (r: ProviderConfigRow) => [
  r.provider_id, r.app_id, r.app_slug, r.client_id, r.client_secret_enc, r.private_key_enc,
  r.webhook_secret_enc, r.html_url, r.created_by, r.created_at, r.updated_at,
];

export class D1ProviderConfigStore implements ProviderConfigStore {
  constructor(private db: any) {}
  async insert(r: ProviderConfigRow) { await this.db.prepare(INSERT).bind(...rowArgs(r)).run(); }
  async get(id: string) { return ((await this.db.prepare(SELECT).bind(id).first()) as ProviderConfigRow) ?? null; }
}

export class SqliteProviderConfigStore implements ProviderConfigStore {
  constructor(private db: any) {}
  async insert(r: ProviderConfigRow) { this.db.prepare(INSERT).run(...rowArgs(r)); }
  async get(id: string) { return (this.db.prepare(SELECT).get(id) as ProviderConfigRow) ?? null; }
}

export class InMemoryProviderConfigStore implements ProviderConfigStore {
  private rows = new Map<string, ProviderConfigRow>();
  async insert(r: ProviderConfigRow) {
    if (this.rows.has(r.provider_id)) throw new Error(`UNIQUE constraint failed: ${r.provider_id}`);
    this.rows.set(r.provider_id, r);
  }
  async get(id: string) { return this.rows.get(id) ?? null; }
}

let memorySingleton: InMemoryProviderConfigStore | null = null;
export async function createProviderConfigStore(env: any): Promise<ProviderConfigStore> {
  if (env?.DB) return new D1ProviderConfigStore(env.DB);
  if (env?.PORTALESS_SQLITE_PATH) return new SqliteProviderConfigStore(await openSqlite(env.PORTALESS_SQLITE_PATH));
  console.warn("[Portaless Deploy] Sin DB ni PORTALESS_SQLITE_PATH. Config de la GitHub App solo en memoria.");
  return (memorySingleton ??= new InMemoryProviderConfigStore());
}

export async function saveProviderConfig(
  store: ProviderConfigStore,
  c: Omit<ProviderConfig, "createdAt" | "updatedAt">,
  encryptionKey: string
): Promise<void> {
  const t = new Date().toISOString();
  await store.insert({
    provider_id: c.providerId,
    app_id: c.appId,
    app_slug: c.appSlug,
    client_id: c.clientId,
    client_secret_enc: await encryptToken(c.clientSecret, encryptionKey),
    private_key_enc: await encryptToken(c.privateKey, encryptionKey),
    webhook_secret_enc: c.webhookSecret ? await encryptToken(c.webhookSecret, encryptionKey) : null,
    html_url: c.htmlUrl,
    created_by: c.createdBy,
    created_at: t,
    updated_at: t,
  });
}

/** Uso server-side exclusivo. Nunca exponer el resultado por HTTP. */
export async function getProviderConfig(
  store: ProviderConfigStore,
  providerId: string,
  encryptionKey: string
): Promise<ProviderConfig | null> {
  const r = await store.get(providerId);
  if (!r) return null;
  return {
    providerId: r.provider_id,
    appId: r.app_id,
    appSlug: r.app_slug,
    clientId: r.client_id,
    clientSecret: await decryptToken(r.client_secret_enc, encryptionKey),
    privateKey: await decryptToken(r.private_key_enc, encryptionKey),
    webhookSecret: r.webhook_secret_enc ? await decryptToken(r.webhook_secret_enc, encryptionKey) : null,
    htmlUrl: r.html_url,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
