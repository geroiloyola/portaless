import { describe, expect, it } from "vitest";
import { loadReaderConduct, type IssuerKey } from "../../packages/apw-resolver/src/scoring/reader-attestations";
import { signSiteJws, ATTESTATION_TYP } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { sha256B64Url } from "../../packages/apw-resolver/src/did-apw/history-log";
import { jwkThumbprint } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import { verifyAttestation } from "../../packages/trust-layer/src/site-trust/attestation";

const READER = "reader.example";
const RDID = `did:apw:${READER}`;
const AFTER = "2026-10-05T00:00:00.000Z";
const BEFORE = "2026-01-01T00:00:00.000Z";

interface Issuer { host: string; did: string; keyId: string; priv: JsonWebKey; pub: JsonWebKey }

async function issuer(host: string): Promise<Issuer> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    host,
    did: `did:apw:${host}`,
    keyId: `did:apw:${host}#key-1`,
    priv: (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey,
    pub: (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey,
  };
}

function conduct(iss: Issuer, sub: string, cat: string, val = true, signer: Issuer = iss) {
  return signSiteJws(
    { typ: ATTESTATION_TYP, iss: iss.did, sub, src: "reader_conduct", cat, val, iat: 1700000000, jti: crypto.randomUUID() },
    { keyId: iss.keyId, privateKeyJwk: signer.priv },
    ATTESTATION_TYP
  );
}

async function keysOf(...issuers: Issuer[]) {
  const map = new Map<string, IssuerKey[]>();
  for (const i of issuers) {
    const { kty, crv, x } = i.pub as any;
    const pub = { kty, crv, x } as JsonWebKey;
    map.set(i.host, [{ keyId: i.keyId, fingerprint: await jwkThumbprint(pub), publicKeyJwk: pub, validFrom: "2020-01-01T00:00:00Z", validTo: null }]);
  }
  return async (host: string) => map.get(host) ?? null;
}

/** Arma la cadena (hashes) y el paquete publicado. bundle permite alterar lo que publica el lector. */
async function harness(items: Array<{ jws: string | null; ts?: string }>, tweak?: (entries: any[]) => any[]) {
  const chain = await Promise.all(
    items.map(async (it, i) => ({ seq: i + 1, att: await sha256B64Url(it.jws ?? `legacy-${i}`), ts: it.ts ?? AFTER }))
  );
  let entries = chain.map((c, i) => ({ seq: c.seq, att: c.att, jws: items[i].jws }));
  if (tweak) entries = tweak(entries);
  return {
    resolveHistory: async () => ({ verified: true, reason: "ok", domain: READER, attestations: chain }),
    fetchImpl: (async () => new Response(JSON.stringify({ did: RDID, length: chain.length, entries, next: null }), { status: 200 })) as typeof fetch,
  };
}

describe("loadReaderConduct (E-9)", () => {
  it("lector completo: verifica contra el emisor y pasa a R-01, aunque el iat sea viejo", async () => {
    const a = await issuer("a.example");
    const b = await issuer("b.example");
    const h = await harness([{ jws: await conduct(a, RDID, "respected_policy") }, { jws: await conduct(b, RDID, "respected_policy") }]);
    const r = await loadReaderConduct(READER, { ...h, resolveIssuerKeys: await keysOf(a, b) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attestations).toHaveLength(2);
    expect(r.attestations.every((x) => x.dimension === "R-01" && x.value === 7 && x.sub === RDID)).toBe(true);
  });

  it("policy_violation cuenta como negativa", async () => {
    const a = await issuer("a.example");
    const h = await harness([{ jws: await conduct(a, RDID, "policy_violation") }]);
    const r = await loadReaderConduct(READER, { ...h, resolveIssuerKeys: await keysOf(a) });
    expect(r.ok && r.attestations[0]).toMatchObject({ dimension: "R-01", value: 1 });
  });

  it("ocultar el JWS de una entrada posterior al corte -> incomplete", async () => {
    const a = await issuer("a.example");
    const neg = await conduct(a, RDID, "policy_violation");
    const h = await harness([{ jws: await conduct(a, RDID, "respected_policy") }, { jws: neg }], (e) =>
      e.map((x) => (x.jws === neg ? { ...x, jws: null } : x))
    );
    expect(await loadReaderConduct(READER, { ...h, resolveIssuerKeys: await keysOf(a) })).toMatchObject({ ok: false, reason: "reader_conduct_incomplete", seq: 2 });
  });

  it("un JWS que no esta en la cadena -> not_in_chain", async () => {
    const a = await issuer("a.example");
    const extra = await conduct(a, RDID, "respected_policy");
    const h = await harness([{ jws: await conduct(a, RDID, "respected_policy") }], (e) => [
      ...e,
      { seq: 99, att: "x".repeat(43), jws: extra },
    ]);
    expect(await loadReaderConduct(READER, { ...h, resolveIssuerKeys: await keysOf(a) })).toMatchObject({ ok: false, reason: "reader_conduct_not_in_chain" });
  });

  it("un JWS cambiado por otro bajo el mismo att -> not_in_chain", async () => {
    const a = await issuer("a.example");
    const neg = await conduct(a, RDID, "policy_violation");
    const fake = await conduct(a, RDID, "respected_policy");
    const h = await harness([{ jws: neg }], (e) => e.map((x) => ({ ...x, jws: fake })));
    expect(await loadReaderConduct(READER, { ...h, resolveIssuerKeys: await keysOf(a) })).toMatchObject({ ok: false, reason: "reader_conduct_not_in_chain" });
  });

  it("firma con otra clave bajo el kid del emisor -> invalid_attestation", async () => {
    const a = await issuer("a.example");
    const mallory = await issuer("mallory.example");
    const h = await harness([{ jws: await conduct(a, RDID, "respected_policy", true, mallory) }]);
    expect(await loadReaderConduct(READER, { ...h, resolveIssuerKeys: await keysOf(a) })).toMatchObject({ ok: false, reason: "reader_conduct_invalid_attestation" });
  });

  it("emisor no resoluble -> issuer_unresolvable (no se descarta en silencio)", async () => {
    const a = await issuer("a.example");
    const h = await harness([{ jws: await conduct(a, RDID, "policy_violation") }]);
    expect(await loadReaderConduct(READER, { ...h, resolveIssuerKeys: async () => null })).toMatchObject({ ok: false, reason: "reader_conduct_issuer_unresolvable" });
  });

  it("entradas anteriores al corte sin JWS: ignore las saltea, reject rompe", async () => {
    const a = await issuer("a.example");
    const h = await harness([{ jws: null, ts: BEFORE }, { jws: await conduct(a, RDID, "respected_policy") }]);
    const keys = await keysOf(a);
    const ok = await loadReaderConduct(READER, { ...h, resolveIssuerKeys: keys });
    expect(ok).toMatchObject({ ok: true, ignoredLegacy: 1 });
    const strict = await loadReaderConduct(READER, {
      ...h,
      resolveIssuerKeys: keys,
      config: { maxAttestationsLoaded: 200, legacyEntriesWithoutJws: "reject", legacyCutoff: "2026-10-04T00:00:00.000Z" },
    });
    expect(strict).toMatchObject({ ok: false, reason: "reader_conduct_incomplete", seq: 1 });
  });

  it("lo que el lector emitio sobre otros y las autoemitidas no cuentan", async () => {
    const a = await issuer("a.example");
    const self = await issuer(READER);
    const h = await harness([
      { jws: await conduct(self, "did:apw:otro.example", "respected_policy") },
      { jws: await conduct(self, RDID, "respected_policy") },
      { jws: await conduct(a, RDID, "respected_policy") },
    ]);
    const r = await loadReaderConduct(READER, { ...h, resolveIssuerKeys: await keysOf(a, self) });
    expect(r.ok && r.attestations.map((x) => x.iss)).toEqual(["did:apw:a.example"]);
  });

  it("historial no verificado -> history_unverified", async () => {
    const r = await loadReaderConduct(READER, {
      resolveHistory: async () => ({ verified: false, reason: "head_mismatch", domain: READER }),
      fetchImpl: (async () => new Response("{}")) as typeof fetch,
    });
    expect(r).toMatchObject({ ok: false, reason: "reader_conduct_history_unverified" });
  });
});

describe("verifyAttestation skipIatWindow (E-9)", () => {
  it("un iat viejo falla al recibir y pasa al leer del historial", async () => {
    const a = await issuer("a.example");
    const jws = await conduct(a, RDID, "respected_policy");
    const { kty, crv, x } = a.pub as any;
    const exp = { sub: RDID, src: "reader_conduct" as const, iss: a.did, kid: a.keyId };
    expect(await verifyAttestation(jws, { kty, crv, x }, exp)).toMatchObject({ ok: false, reason: "iat_out_of_window" });
    expect(await verifyAttestation(jws, { kty, crv, x }, { ...exp, skipIatWindow: true })).toMatchObject({ ok: true });
  });
});
