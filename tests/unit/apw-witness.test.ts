import { describe, expect, it } from "vitest";
import {
  WITNESS_TYP,
  buildWitnessPayload,
  evaluateWitnesses,
  signWitnessStatement,
  verifyWitnessStatement,
  witnessJti,
  type ChainViewEntry,
  type WitnessObservation,
} from "../../packages/apw-resolver/src/did-apw/witness";

const WITNESS = "did:apw:testigo.example";
const SUBJECT = "did:apw:sujeto.example";
const HEAD_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const HEAD_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const HEAD_C = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

function chain(...entries: ChainViewEntry[]): ChainViewEntry[] {
  return entries;
}

describe("witness statements (E-10)", () => {
  it("buildWitnessPayload arma el payload con jti determinista", async () => {
    const p = await buildWitnessPayload({ iss: WITNESS, sub: SUBJECT, seq: 3, head: HEAD_A, ts: "2026-10-09T12:00:00.000Z" });
    expect(p).toMatchObject({ typ: WITNESS_TYP, iss: WITNESS, sub: SUBJECT, seq: 3, head: HEAD_A });
    expect(p.jti).toBe(await witnessJti(WITNESS, SUBJECT, 3, HEAD_A));
    const again = await buildWitnessPayload({ iss: WITNESS, sub: SUBJECT, seq: 3, head: HEAD_A, ts: "2026-10-09T12:00:00.000Z" });
    expect(again.jti).toBe(p.jti);
    const other = await buildWitnessPayload({ iss: WITNESS, sub: SUBJECT, seq: 4, head: HEAD_B, ts: "2026-10-09T12:00:00.000Z" });
    expect(other.jti).not.toBe(p.jti);
  });

  it("buildWitnessPayload rechaza seq/head inconsistentes y dids invalidos", async () => {
    const base = { iss: WITNESS, sub: SUBJECT, ts: "2026-10-09T12:00:00.000Z" };
    await expect(buildWitnessPayload({ ...base, seq: 1, head: null })).rejects.toThrow("invalid_input");
    await expect(buildWitnessPayload({ ...base, seq: 0, head: HEAD_A })).rejects.toThrow("invalid_input");
    await expect(buildWitnessPayload({ ...base, seq: -1, head: null })).rejects.toThrow("invalid_input");
    await expect(buildWitnessPayload({ ...base, seq: 1, head: "corto" })).rejects.toThrow("invalid_input");
    await expect(buildWitnessPayload({ ...base, seq: 1, head: HEAD_A, iss: "did:web:example.com" })).rejects.toThrow("invalid_input");
  });

  it("firma y verifica un statement; cualquier alteracion rompe la verificacion", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
    const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
    const kid = `${WITNESS}#key-1`;
    const signed = await signWitnessStatement(
      { iss: WITNESS, sub: SUBJECT, seq: 2, head: HEAD_A, ts: "2026-10-09T12:00:00.000Z" },
      { keyId: kid, privateKeyJwk: priv }
    );

    const ok = await verifyWitnessStatement(signed.jws, pub, { kid, expectedIss: WITNESS, expectedSub: SUBJECT });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.payload).toMatchObject({ seq: 2, head: HEAD_A });

    const wrongKid = await verifyWitnessStatement(signed.jws, pub, { kid: `${WITNESS}#key-2` });
    expect(wrongKid).toEqual({ ok: false, reason: "kid_mismatch" });

    const wrongSub = await verifyWitnessStatement(signed.jws, pub, { kid, expectedSub: "did:apw:otro.example" });
    expect(wrongSub).toEqual({ ok: false, reason: "sub_mismatch" });

    const otherKp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const otherPriv = (await crypto.subtle.exportKey("jwk", otherKp.privateKey)) as JsonWebKey;
    const forged = await signWitnessStatement(
      { iss: WITNESS, sub: SUBJECT, seq: 2, head: HEAD_A, ts: "2026-10-09T12:00:00.000Z" },
      { keyId: kid, privateKeyJwk: otherPriv }
    );
    const parts = signed.jws.split(".");
    const forgedParts = forged.jws.split(".");
    const forgedWithSameKid = `${parts[0]}.${forgedParts[1]}.${forgedParts[2]}`;
    const badSig = await verifyWitnessStatement(forgedWithSameKid, pub, { kid });
    expect(badSig).toEqual({ ok: false, reason: "bad_signature" });

    const malformed = await verifyWitnessStatement("no-jws", pub, { kid });
    expect(malformed).toEqual({ ok: false, reason: "malformed_statement" });
  });

  it("rechaza un payload con jti que no recalcula", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
    const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
    const kid = `${WITNESS}#key-1`;
    const { jws } = await signWitnessStatement(
      { iss: WITNESS, sub: SUBJECT, seq: 0, head: null, ts: "2026-10-09T12:00:00.000Z" },
      { keyId: kid, privateKeyJwk: priv }
    );
    // Re-sign manual con jti falsificado (JCS del payload con jti malo)
    const { signSiteJws } = await import("../../packages/apw-resolver/src/did-apw/site-jws");
    const forged = await signSiteJws(
      { typ: WITNESS_TYP, iss: WITNESS, sub: SUBJECT, seq: 0, head: null, ts: "2026-10-09T12:00:00.000Z", jti: "wt-forged" },
      { keyId: kid, privateKeyJwk: priv },
      WITNESS_TYP
    );
    void jws;
    const result = await verifyWitnessStatement(forged, pub, { kid });
    expect(result).toEqual({ ok: false, reason: "jti_mismatch" });
  });
});

describe("evaluateWitnesses (E-10)", () => {
  const obs = (over: Partial<WitnessObservation> = {}): WitnessObservation => ({
    witnessDid: WITNESS,
    seq: 1,
    head: HEAD_A,
    anchoredTs: "2026-10-09T12:00:00.000Z",
    ...over,
  });

  it("ok: la cadena actual coincide con las observaciones ancladas", () => {
    const c = chain(
      { seq: 1, hash: HEAD_A, ts: "2026-10-09T11:00:00.000Z" },
      { seq: 2, hash: HEAD_B, ts: "2026-10-09T13:00:00.000Z" }
    );
    const r = evaluateWitnesses([obs()], c);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.observationsChecked).toBe(1);
  });

  it("head_mismatch: la cadena se reescribio o trunco respecto de lo observado", () => {
    const rewritten = chain({ seq: 1, hash: HEAD_C, ts: "2026-10-09T11:00:00.000Z" });
    const r1 = evaluateWitnesses([obs()], rewritten);
    expect(r1.ok).toBe(false);
    expect(r1.findings).toContainEqual({ type: "head_mismatch", witnessDid: [WITNESS], seq: 1, observed: HEAD_A, actual: HEAD_C });

    const truncated = chain();
    const r2 = evaluateWitnesses([obs({ seq: 2, head: HEAD_B })], truncated);
    expect(r2.ok).toBe(false);
    expect(r2.findings[0]).toMatchObject({ type: "head_mismatch", seq: 2, observed: HEAD_B, actual: null });
  });

  it("equivocation: dos testigos anclaron heads distintos para la misma seq", () => {
    const other = "did:apw:otro-testigo.example";
    const c = chain({ seq: 1, hash: HEAD_A, ts: "2026-10-09T11:00:00.000Z" });
    const r = evaluateWitnesses([obs(), obs({ witnessDid: other, head: HEAD_B })], c);
    expect(r.ok).toBe(false);
    const eq = r.findings.find((f) => f.type === "equivocation");
    expect(eq).toBeDefined();
    expect(eq?.witnessDid?.sort()).toEqual([WITNESS, other].sort());
    expect((eq?.observed as Array<string | null>).sort()).toEqual([HEAD_A, HEAD_B].sort());
    // la observacion discordante tambien genera head_mismatch contra la cadena actual
    expect(r.findings.some((f) => f.type === "head_mismatch")).toBe(true);
  });

  it("backdated_entry: una entrada posterior al head observado no puede declarar un ts anterior", () => {
    const c = chain(
      { seq: 1, hash: HEAD_A, ts: "2026-10-09T11:00:00.000Z" },
      { seq: 2, hash: HEAD_B, ts: "2026-10-09T11:54:00.000Z" }
    );
    const r = evaluateWitnesses([obs()], c, { skewSeconds: 300 });
    expect(r.ok).toBe(false);
    expect(r.findings).toContainEqual({
      type: "backdated_entry",
      witnessDid: [WITNESS],
      seq: 2,
      observed: "2026-10-09T12:00:00.000Z",
      actual: "2026-10-09T11:54:00.000Z",
    });

    // Dentro del margen de skew: no es hallazgo.
    const withinSkew = chain(
      { seq: 1, hash: HEAD_A, ts: "2026-10-09T11:00:00.000Z" },
      { seq: 2, hash: HEAD_B, ts: "2026-10-09T11:58:00.000Z" }
    );
    expect(evaluateWitnesses([obs()], withinSkew, { skewSeconds: 300 }).ok).toBe(true);
  });

  it("cadena vacia observada: cualquier entrada futura con ts viejo es backdating", () => {
    const c = chain({ seq: 1, hash: HEAD_A, ts: "2026-10-09T10:00:00.000Z" });
    const r = evaluateWitnesses([obs({ seq: 0, head: null, anchoredTs: "2026-10-09T12:00:00.000Z" })], c);
    expect(r.ok).toBe(false);
    expect(r.findings[0]).toMatchObject({ type: "backdated_entry", seq: 1 });
  });
});
