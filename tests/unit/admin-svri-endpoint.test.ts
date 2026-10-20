import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  snapshot: { siteId: "default", self: [], agent: [], community: [], escrowReports: [] },
  identity: { siteId: "default", did: "did:apw:example.org", domain: "example.org", publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "public" }, createdAt: "2026-10-01T00:00:00.000Z" },
  identityKeys: [] as any[],
  logEntries: [] as any[],
}));

vi.mock("../../packages/trust-layer/src/site-trust/store-factory.ts", () => ({
  createSiteTrustScoreStore: async () => ({ getSnapshot: async () => state.snapshot }),
}));
vi.mock("../../packages/trust-layer/src/site-trust/community-attestations.ts", () => ({
  createCommunityAttestationsStore: async () => ({ listBySite: async () => [] }),
}));
vi.mock("../../packages/trust-layer/src/site-trust/authorized-escrow-providers.ts", () => ({
  createAuthorizedEscrowProvidersStore: async () => ({ getPublicKeyJwk: async () => null }),
}));
vi.mock("../../packages/apw-resolver/src/did-apw/store-factory.ts", () => ({
  createSiteIdentityStore: async () => ({ get: async () => state.identity, listKeys: async () => state.identityKeys }),
  createAttestationLogStore: async () => ({ list: async (_siteId: string, from: number, limit: number) => state.logEntries.filter((entry: any) => entry.seq >= from).slice(0, limit) }),
}));
vi.mock("../../packages/apw-resolver/src/index.ts", () => ({ resolveApwIdentity: async () => ({ verified: false }) }));

import { onRequestGet } from "../../functions/admin/api/svri.js";
import { InMemorySiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation } from "../../packages/apw-resolver/src/did-apw/history-log";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import { signSelfAttestation } from "../../packages/apw-resolver/src/did-apw/site-jws";

function context(user: { role: string; username?: string } | null, siteId = "default") {
  return {
    data: { user },
    env: {},
    request: new Request(`https://portaless.test/admin/api/svri?siteId=${encodeURIComponent(siteId)}`),
  } as never;
}

describe("admin SVRI endpoint", () => {
  it("requires the administrator role before reading trust stores", async () => {
    expect((await onRequestGet(context(null))).status).toBe(401);
    expect((await onRequestGet(context({ role: "viewer" }))).status).toBe(403);
  });

  it("returns the detailed zero-evidence SVRI only to an admin and labels the history partial", async () => {
    const response = await onRequestGet(context({ role: "admin", username: "owner" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.svri).toMatchObject({
      score: 5,
      t1Count: 0,
      t2Count: 0,
      t3Count: 0,
      t4Count: 0,
      t5Count: 0,
      incompleteData: true,
      isInference: true,
      publicLevel: "pending",
    });
    expect(body.history).toMatchObject({ chainValid: true, status: "partial" });
    expect(body.history.events[0].source).toBe("initial-prior");
  });

  it("reverifies the source JWS and its site-chain inclusion before counting T2", async () => {
    const env = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(23)).toString("base64") };
    const identityStore = new InMemorySiteIdentityStore(env);
    const keyPair = await generateApwDid("example.org");
    await identityStore.create("default", keyPair, "admin");
    const key = await identityStore.getActiveSigningKey("default");
    const attestation = await signSelfAttestation({ did: keyPair.did, category: "privacy_policy", value: true }, key!);
    const logStore = new InMemoryAttestationLogStore();
    await appendAttestation({ identity: identityStore, log: logStore, siteId: "default" }, attestation.jws);
    state.identity = (await identityStore.get("default")) as any;
    state.identityKeys = await identityStore.listKeys("default");
    state.logEntries = await logStore.list("default", 1, 100);
    // The admin projection is replayed from the verified log, not copied from
    // the mutable SiteTrustScore snapshot.
    state.snapshot.self = [];

    const response = await onRequestGet(context({ role: "admin", username: "owner" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.svri).toMatchObject({ t2Count: 1, incompleteData: false });
    expect(body.verifiedSourceRecords).toContainEqual({ tier: "T2", issuer: keyPair.did, attestationId: attestation.jti });
    expect(body.history.events[1]).toMatchObject({ tier: "T2", accepted: true, attestationId: attestation.jti });
    expect(body.history.chainValid).toBe(true);
  });
});
