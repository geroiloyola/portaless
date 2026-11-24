// Pure CloudImageStore port and InMemoryCloudImageStore (L2).
// SQLite/D1 adapters live in `@portaless/trust-storage-adapters` (Node-L0).

import { parseSidecar, type CloudImageSidecar, type DeclaredOrigin } from "./payload";

export interface CloudImageRecord {
  imageId: string;
  contentHash: string;
  contentType: string;
  byteLength: number;
  declaredOrigin: DeclaredOrigin;
  siteId: string;
  siteDid: string;
  keyId: string;
  keyAlgorithm: string;
  signedAt: string;
  sidecar: CloudImageSidecar;
  createdBy: string | null;
  createdAt: string;
}

export interface CloudImagePutInput {
  bytes: Uint8Array;
  sidecar: CloudImageSidecar;
  keyId: string;
  createdBy?: string | null;
}

export interface CloudImageStore {
  put(input: CloudImagePutInput): Promise<CloudImageRecord>;
  get(imageId: string): Promise<{ record: CloudImageRecord; bytes: Uint8Array } | null>;
  getByContentHash(contentHash: string): Promise<CloudImageRecord | null>;
  list(limit?: number): Promise<CloudImageRecord[]>;
  remove(imageId: string): Promise<boolean>;
}

export const CLOUD_IMAGES_TABLE_DDL = `CREATE TABLE IF NOT EXISTS cloud_images (
  image_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  declared_origin TEXT NOT NULL,
  site_id TEXT NOT NULL,
  site_did TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_algorithm TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  sidecar_json TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
)`;

export const CLOUD_IMAGES_HASH_INDEX_DDL =
  "CREATE INDEX IF NOT EXISTS idx_cloud_images_created ON cloud_images(created_at DESC)";

export class InMemoryCloudImageStore implements CloudImageStore {
  private rows = new Map<string, { record: CloudImageRecord; bytes: Uint8Array }>();

  put(input: CloudImagePutInput): Promise<CloudImageRecord> {
    const sidecar = parseSidecar(input.sidecar);
    if (!sidecar) return Promise.reject(new Error("invalid_sidecar"));
    const { payload } = sidecar;
    const record: CloudImageRecord = {
      imageId: payload.imageId,
      contentHash: payload.contentHash,
      contentType: payload.contentType,
      byteLength: payload.byteLength,
      declaredOrigin: payload.declaredOrigin,
      siteId: payload.siteId,
      siteDid: payload.siteDid,
      keyId: input.keyId,
      keyAlgorithm: payload.keyAlgorithm,
      signedAt: payload.signedAt,
      sidecar,
      createdBy: input.createdBy ?? null,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(record.imageId, { record, bytes: input.bytes.slice() });
    return Promise.resolve(record);
  }

  get(imageId: string): Promise<{ record: CloudImageRecord; bytes: Uint8Array } | null> {
    const row = this.rows.get(imageId);
    return Promise.resolve(row ? { record: row.record, bytes: row.bytes.slice() } : null);
  }

  getByContentHash(contentHash: string): Promise<CloudImageRecord | null> {
    for (const row of this.rows.values()) {
      if (row.record.contentHash === contentHash) return Promise.resolve(row.record);
    }
    return Promise.resolve(null);
  }

  list(limit = 100): Promise<CloudImageRecord[]> {
    const records = [...this.rows.values()]
      .map((row) => row.record)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return Promise.resolve(records);
  }

  remove(imageId: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(imageId));
  }
}
