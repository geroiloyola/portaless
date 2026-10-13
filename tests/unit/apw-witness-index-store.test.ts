// Portaless Index (APW 5.7, seccion 7): store de observaciones de testigos,
// ponderacion y entradas de directorio cacheadas.
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  InMemoryWitnessIndexStore,
  SqliteWitnessIndexStore,
  INVALID_WITNESS_WEIGHT,
  MAX_WITNESS_WEIGHT,
  type WitnessIndexStore,
  type WitnessObservationRecord,
} from "../../packages/apw-resolver/src/did-apw/witness-index-store";

const SITE = "default";
const SUBJECT = "did:apw:sujeto.example";
const OTHER_SUBJECT = "did:apw:otro.example";
const W1 = "did:apw:t1.example";
const W2 = "did:apw:t2.example";
const HEAD = "A".repeat(43);

function obs(overrides: Partial<WitnessObservationRecord> = {}): WitnessObservationRecord {
  return {
    siteId: SITE,
    subjectDid: SUBJECT,
    witnessDid: W1,
    observedSeq: 2,
    observedHead: HEAD,
    anchoredTs: "2026-10-01T10:00:00.000Z",
    statementJti: "wt-1",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

const backends: Array<{ name: string; make: () => WitnessIndexStore }> = [
  { name: "InMemory", make: () => new InMemoryWitnessIndexStore() },
  { name: "SQLite", make: () => new SqliteWitnessIndexStore(new Database(":memory:")) },
];

describe.each(backends)("witness_index ($name)", ({ make }) => {
  it("pesos: default ausente, upsert y validacion de rango", async () => {
    const store = make();
    expect(await store.getWeights(SITE)).toEqual({});
    await store.setWeight(SITE, W1, 0.75);
    await store.setWeight(SITE, W2, 1.5);
    expect(await store.getWeights(SITE)).toEqual({ [W1]: 0.75, [W2]: 1.5 });
    await store.setWeight(SITE, W1, 2);
    expect((await store.getWeights(SITE))[W1]).toBe(2);

    await expect(store.setWeight(SITE, W1, -0.1)).rejects.toThrow(INVALID_WITNESS_WEIGHT);
    await expect(store.setWeight(SITE, W1, Number.NaN)).rejects.toThrow(INVALID_WITNESS_WEIGHT);
    await expect(store.setWeight(SITE, W1, MAX_WITNESS_WEIGHT + 1)).rejects.toThrow(INVALID_WITNESS_WEIGHT);
  });

  it("observaciones: inserta, actualiza y NO deja que una anclada menor pise a la mayor", async () => {
    const store = make();
    expect(await store.upsertObservation(obs())).toBe("inserted");

    // Mismo (testigo, seq) con anchored_ts MAYOR: actualiza.
    expect(
      await store.upsertObservation(
        obs({ observedHead: "B".repeat(43), anchoredTs: "2026-10-02T10:00:00.000Z", statementJti: "wt-2" })
      )
    ).toBe("updated");

    // Mismo (testigo, seq) con anchored_ts MENOR: conserva la mayor.
    expect(
      await store.upsertObservation(
        obs({ observedHead: "C".repeat(43), anchoredTs: "2026-09-30T10:00:00.000Z", statementJti: "wt-old" })
      )
    ).toBe("kept");

    const rows = await store.listObservations(SITE, SUBJECT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      witnessDid: W1,
      observedSeq: 2,
      observedHead: "B".repeat(43),
      anchoredTs: "2026-10-02T10:00:00.000Z",
      statementJti: "wt-2",
    });
  });

  it("observaciones: seq y testigos distintos son filas distintas; el listado esta acotado al sujeto", async () => {
    const store = make();
    await store.upsertObservation(obs());
    await store.upsertObservation(obs({ observedSeq: 3, observedHead: null, statementJti: "wt-3" }));
    await store.upsertObservation(obs({ witnessDid: W2, statementJti: "wt-w2" }));
    await store.upsertObservation(obs({ subjectDid: OTHER_SUBJECT, statementJti: "wt-otro" }));

    const rows = await store.listObservations(SITE, SUBJECT);
    expect(rows.map((r) => `${r.witnessDid}|${r.observedSeq}`).sort()).toEqual([`${W1}|2`, `${W1}|3`, `${W2}|2`]);
    expect((await store.listObservations(SITE, OTHER_SUBJECT)).map((r) => r.statementJti)).toEqual(["wt-otro"]);
  });

  it("entradas de directorio: save upsertea, get/list devuelven el JSON crudo", async () => {
    const store = make();
    expect(await store.getSubjectEntry(SITE, SUBJECT)).toBeNull();

    const entry = { siteId: SITE, subjectDid: SUBJECT, domain: "sujeto.example", entryJson: '{"status":"consistent"}', updatedAt: "t1" };
    await store.saveSubjectEntry(entry);
    await store.saveSubjectEntry({ ...entry, entryJson: '{"status":"equivocation"}', updatedAt: "t2" });

    const rec = await store.getSubjectEntry(SITE, SUBJECT);
    expect(rec).toMatchObject({ entryJson: '{"status":"equivocation"}', updatedAt: "t2" });
    expect(await store.listSubjectEntries(SITE)).toHaveLength(1);
  });
});

describe.each(backends)("witness_index Phase 5 ($name)", ({ make }) => {
  it("calibracion: acumula acuerdos/desacuerdos por testigo y se queda sin datos en otros", async () => {
    const store = make();
    expect(await store.getCalibration(SITE)).toEqual({});

    await store.recordCalibration(SITE, W1, true);
    await store.recordCalibration(SITE, W1, true);
    await store.recordCalibration(SITE, W1, false);
    await store.recordCalibration(SITE, W2, false);

    expect(await store.getCalibration(SITE)).toEqual({
      [W1]: { agree: 2, disagree: 1 },
      [W2]: { agree: 0, disagree: 1 },
    });
    // Aislado por site: otro site no ve los contadores.
    expect(await store.getCalibration("otro-site")).toEqual({});
  });

  it("pares: alta idempotente, estado de sync, listado y baja", async () => {
    const store = make();
    expect(await store.listPeers(SITE)).toEqual([]);

    await store.addPeer({ siteId: SITE, peerDomain: "par.example", peerDid: null, addedAt: "t1" });
    await store.addPeer({ siteId: SITE, peerDomain: "par.example", peerDid: "did:apw:par.example", addedAt: "t2" });
    let peers = await store.listPeers(SITE);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ peerDomain: "par.example", lastStatus: "never_synced", lastSubjectsCount: 0 });

    await store.updatePeerStatus(SITE, "par.example", "ok", 3, "did:apw:par.example");
    peers = await store.listPeers(SITE);
    expect(peers[0]).toMatchObject({ lastStatus: "ok", lastSubjectsCount: 3, peerDid: "did:apw:par.example" });
    expect(peers[0].lastSyncAt).toBeTruthy();

    expect(await store.removePeer(SITE, "par.example")).toBe(true);
    expect(await store.removePeer(SITE, "par.example")).toBe(false);
    expect(await store.listPeers(SITE)).toEqual([]);
  });
});
