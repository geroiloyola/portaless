import { describe, expect, it } from "vitest";
import { InMemorySiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation, type ChainKey } from "../../packages/apw-resolver/src/did-apw/history-log";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import { reconstructSvriHistory } from "../../packages/apw-resolver/src/scoring/svri-history";

const encryptionKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(19)));
const b64 = (value: string) => Buffer.from(value).toString("base64url");

function fakeSourceAttestation(claims: Record<string, unknown>): string {
  return `${b64(JSON.stringify({ alg: "EdDSA", kid: "source-key" }))}.${b64(JSON.stringify({ typ: "apw-attestation+jws", ...claims }))}.c2ln`;
}

describe("SVRI historical reconstruction", () => {
  it("replays only source JWS linked to a verified site-chain entry", async () => {
    const domain = "svri-history.example";
    const did = `did:apw:${domain}`;
    const identity = new InMemorySiteIdentityStore({ PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: encryptionKey });
    const keyPair = await generateApwDid(domain);
    await identity.create("default", keyPair, "admin");
    const log = new InMemoryAttestationLogStore();
    const claims = { iss: did, sub: did, src: "self", cat: "privacy_policy", val: true, iat: Math.floor(Date.now() / 1000), jti: "self-1" };
    const sourceJws = fakeSourceAttestation(claims);
    await appendAttestation({ identity, log, siteId: "default" }, sourceJws);
    await appendAttestation({ identity, log, siteId: "default" }, fakeSourceAttestation({
      iss: did, sub: "did:apw:reader.example", src: "reader_conduct", cat: "respected_policy", val: true,
      iat: Math.floor(Date.now() / 1000), jti: "reader-conduct-1",
    }));
    const entries = await log.list("default", 1, 100);
    const identityKeys = await identity.listKeys("default");
    const keys: ChainKey[] = identityKeys.map((key) => ({
      kid: key.kid, keyId: key.keyId, publicKeyJwk: key.publicKeyJwk,
      validFrom: key.validFrom, validTo: key.validTo,
    }));

    const result = await reconstructSvriHistory({
      siteId: "default", siteDid: did, entries, keys, activeFingerprint: identityKeys[0].kid,
      anchorHead: entries[1].entryHash,
      verifySource: async (_jws, parsed) => ({ verified: ["self-1", "reader-conduct-1"].includes(parsed.jti) }),
    });

    expect(result).toMatchObject({ status: "complete", chainValid: true, anchoredSeq: 2, unanchoredEntries: 0 });
    expect(result.events[1]).toMatchObject({ tier: "T2", issuer: did, attestationId: "self-1", accepted: true });
    expect(result.events[1].svri).toMatchObject({ t2Count: 1, incompleteData: false });
    expect(result.events[2]).toMatchObject({ tier: "T4", source: "reader_conduct", accepted: true });
    expect(result.events[2].svri).toMatchObject({ t2Count: 1, t4Count: 1 });
    expect(result.detail).toMatchObject({ svri: { t2Count: 1, t4Count: 1, incompleteData: false } });
    expect(result.detail?.verifiedSourceRecords).toHaveLength(2);
  });

  it("marks a missing/mismatched source JWS as partial instead of inventing a historical score", async () => {
    const domain = "svri-history-partial.example";
    const did = `did:apw:${domain}`;
    const identity = new InMemorySiteIdentityStore({ PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: encryptionKey });
    await identity.create("default", await generateApwDid(domain), "admin");
    const log = new InMemoryAttestationLogStore();
    const sourceJws = fakeSourceAttestation({ iss: did, sub: did, src: "self", cat: "privacy_policy", val: true, iat: 1, jti: "legacy" });
    await appendAttestation({ identity, log, siteId: "default" }, sourceJws);
    const entries = await log.list("default", 1, 100);
    entries[0] = { ...entries[0], attJws: "different-source-jws" };
    const identityKeys = await identity.listKeys("default");
    const result = await reconstructSvriHistory({
      siteId: "default", siteDid: did, entries,
      keys: identityKeys.map((key) => ({ kid: key.kid, keyId: key.keyId, publicKeyJwk: key.publicKeyJwk, validFrom: key.validFrom, validTo: key.validTo })),
      activeFingerprint: identityKeys[0].kid,
      verifySource: async () => ({ verified: true }),
    });
    expect(result.status).toBe("partial");
    expect(result.events[1]).toMatchObject({ accepted: false, reason: "source_jws_hash_mismatch" });
    expect(result.events[1].svri.t2Count).toBe(0);
  });
});
