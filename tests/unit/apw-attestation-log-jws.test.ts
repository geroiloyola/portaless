import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  SqliteAttestationLogStore,
  InMemoryAttestationLogStore,
  type AttestationLogEntry,
} from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { sha256B64Url } from "../../packages/apw-resolver/src/did-apw/history-log";

async function entry(seq: number, attJws: string | null): Promise<AttestationLogEntry> {
  return {
    siteId: "default",
    seq,
    entryJws: `e.${seq}.s`,
    entryHash: "h".repeat(43),
    prevHash: null,
    attHash: await sha256B64Url(attJws ?? `legacy-${seq}`),
    attJws,
    kid: "k".repeat(43),
    ts: "2026-10-03T00:00:00.000Z",
  };
}

describe("historial guarda el JWS de la atestacion (E-9)", () => {
  it("SQLite: guarda y lista att_jws; su hash es att", async () => {
    const store = new SqliteAttestationLogStore(new Database(":memory:"));
    await store.append(await entry(1, "a.b.c"));
    const [e] = await store.list("default", 1, 10);
    expect(e.attJws).toBe("a.b.c");
    expect(await sha256B64Url(e.attJws!)).toBe(e.attHash);
  });

  it("SQLite: una base anterior a E-9 se migra sola y sus entradas quedan con null", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE site_attestation_log (
      site_id TEXT NOT NULL, seq INTEGER NOT NULL, entry_jws TEXT NOT NULL, entry_hash TEXT NOT NULL,
      prev_hash TEXT, att_hash TEXT NOT NULL, kid TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (site_id, seq))`);
    db.prepare("INSERT INTO site_attestation_log VALUES ('default', 1, 'e', 'h', NULL, 'old', 'k', 't')").run();
    const store = new SqliteAttestationLogStore(db);
    await store.append(await entry(2, "x.y.z"));
    const rows = await store.list("default", 1, 10);
    expect(rows.map((r) => r.attJws)).toEqual([null, "x.y.z"]);
  });

  it("InMemory conserva att_jws", async () => {
    const store = new InMemoryAttestationLogStore();
    await store.append(await entry(1, "a.b.c"));
    expect((await store.head("default"))?.attJws).toBe("a.b.c");
  });
});
