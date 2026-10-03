import { describe, expect, it } from "vitest";
import { handleEmit } from "../../functions/admin/api/reader-conduct/emit.js";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { InMemoryUsageLedgerStore } from "../../packages/trust-layer/src/ledger/log-writer";
import { verifyAttestation } from "../../packages/trust-layer/src/site-trust/attestation";

const SITE = "did:apw:site.example";
const READER = "did:apw:reader.example";

function req(body: unknown, user: unknown = { username: "ana", role: "admin" }) {
  return {
    request: new Request("https://site.example/admin/api/reader-conduct/emit", { method: "POST", body: JSON.stringify(body) }),
    data: user ? { user } : {},
    env: {},
  };
}

async function deps(opts: { stepUpOk?: boolean; withIdentity?: boolean } = {}) {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKeyJwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  const { kty, crv, x } = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as any;
  const key = { keyId: `${SITE}#key-1`, kid: "thumb-site", privateKeyJwk };
  const withIdentity = opts.withIdentity ?? true;
  const identity = {
    get: async () => (withIdentity ? { did: SITE } : null),
    getActiveSigningKey: async () => (withIdentity ? key : null),
  };
  const log = new InMemoryAttestationLogStore();
  const ledger = new InMemoryUsageLedgerStore();
  await ledger.put("2026-09", {
    period: "2026-09",
    generatedAt: "t",
    agents: [
      { operatorKeyId: "thumb-reader", readerDid: READER, requestsTotal: 4, requestsCharged: 0, requestsFreeTier: 4, revenueUsd: 0, policyViolationsDetected: 0, firstSeen: "t", lastSeen: "t" },
      { operatorKeyId: "sin-did", requestsTotal: 1, requestsCharged: 0, requestsFreeTier: 1, revenueUsd: 0, policyViolationsDetected: 0, firstSeen: "t", lastSeen: "t" },
    ],
  });
  const d = {
    verifyStepUp: async () => (opts.stepUpOk === false ? { ok: false, reason: "invalid_password" } : { ok: true }),
    identity,
    log,
    ledger,
    resolveTxtKey: async (h: string) => (h === "reader.example" ? "thumb-reader" : null),
  };
  return { d, log, pub: { kty, crv, x } as JsonWebKey, keyId: key.keyId };
}

describe("POST /admin/api/reader-conduct/emit (E-9)", () => {
  it("401 sin sesion y 403 para viewer", async () => {
    const { d } = await deps();
    expect((await handleEmit(req({}, null) as any, async () => d as any)).status).toBe(401);
    expect((await handleEmit(req({}, { username: "v", role: "viewer" }) as any, async () => d as any)).status).toBe(403);
  });

  it("400 con un periodo invalido", async () => {
    const { d } = await deps();
    const res = await handleEmit(req({ period: "2026-13", password: "x" }) as any, async () => d as any);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_period");
  });

  it("401 si el step-up falla y no emite nada", async () => {
    const { d, log } = await deps({ stepUpOk: false });
    const res = await handleEmit(req({ period: "2026-09", password: "mal" }) as any, async () => d as any);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("step_up_failed");
    expect(await log.head("default")).toBeNull();
  });

  it("404 sin identidad del sitio", async () => {
    const { d } = await deps({ withIdentity: false });
    const res = await handleEmit(req({ period: "2026-09", password: "ok" }) as any, async () => d as any);
    expect(res.status).toBe(404);
  });

  it("emite, anota en el historial con la clave activa y repetir no duplica", async () => {
    const { d, log, pub, keyId } = await deps();
    const first = await (await handleEmit(req({ period: "2026-09", password: "ok" }) as any, async () => d as any)).json();
    expect(first.emitted).toHaveLength(1);
    expect(first.emitted[0]).toMatchObject({ readerDid: READER, cat: "respected_policy" });
    expect(first.skipped.map((s: any) => s.reason)).toContain("no_reader_did");

    const entries = await log.list("default", 1, 10);
    expect(entries).toHaveLength(1);
    const jws = (entries[0] as any).attJws as string;
    expect(typeof jws).toBe("string");
    const v = await verifyAttestation(jws, pub, { sub: READER, src: "reader_conduct", iss: SITE, kid: keyId });
    expect(v.ok).toBe(true);

    const second = await (await handleEmit(req({ period: "2026-09", password: "ok" }) as any, async () => d as any)).json();
    expect(second.emitted).toHaveLength(0);
    expect(second.skipped.some((s: any) => s.reason === "already_emitted")).toBe(true);
    expect(await log.list("default", 1, 10)).toHaveLength(1);
  });

  it("periodo sin datos responde 200 vacio", async () => {
    const { d } = await deps();
    const body = await (await handleEmit(req({ period: "2025-01", password: "ok" }) as any, async () => d as any)).json();
    expect(body).toEqual({ period: "2025-01", emitted: [], skipped: [] });
  });
});
