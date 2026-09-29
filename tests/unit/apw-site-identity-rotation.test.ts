// Rotacion de la identidad did:apw (v0.0.9.30). Claves Ed25519 reales via
// generateApwDid, cifrado AES-GCM real. Cubre InMemory y SQLite real
// (better-sqlite3, tabla creada en memoria con las mismas columnas que usa
// el store). D1 comparte el mismo SQL de UPDATE que SQLite.
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import {
  InMemorySiteIdentityStore,
  SqliteSiteIdentityStore,
  SITE_IDENTITY_NOT_FOUND,
  type SiteIdentityStore,
} from "../../packages/apw-resolver/src/did-apw/site-identity-store";

const env = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) };

function sqliteStore(): SiteIdentityStore {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE site_identity (
    site_id TEXT PRIMARY KEY, did TEXT NOT NULL, domain TEXT NOT NULL, public_key_jwk TEXT NOT NULL,
    private_key_jwk_encrypted TEXT NOT NULL, private_key_encryption_iv TEXT NOT NULL,
    key_algorithm TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL)`);
  return new SqliteSiteIdentityStore(db, env);
}

const backends: [string, () => SiteIdentityStore][] = [
  ["InMemory", () => new InMemorySiteIdentityStore(env)],
  ["SQLite", sqliteStore],
];

for (const [name, make] of backends) {
  describe(`rotate() -- ${name}`, () => {
    it("reemplaza clave publica y privada, y la privada nueva se descifra", async () => {
      const store = make();
      const first = await generateApwDid("ejemplo.com");
      await store.create("default", first, "admin");

      const second = await generateApwDid("ejemplo.com");
      const rotated = await store.rotate("default", second, "admin2");

      expect(rotated.publicKeyJwk).toEqual(second.publicKeyJwk);
      expect(rotated.createdBy).toBe("admin2");
      const stored = await store.get("default");
      expect(stored?.publicKeyJwk).toEqual(second.publicKeyJwk);
      expect(stored?.publicKeyJwk).not.toEqual(first.publicKeyJwk);
      expect(await store.getDecryptedPrivateKey("default")).toEqual(second.privateKeyJwk);
    });

    it("lanza site_identity_not_found si no hay identidad", async () => {
      const store = make();
      const kp = await generateApwDid("ejemplo.com");
      await expect(store.rotate("default", kp, "admin")).rejects.toThrow(SITE_IDENTITY_NOT_FOUND);
      expect(await store.get("default")).toBeNull();
    });
  });
}
