// Endpoints administrativos con 0% de cobertura: authorized-agents
// (allowlist de la fuente "agent") y apw-verification-status (checklist
// diferido del wizard). Mismo patron que admin-security-endpoints.test.ts:
// stores compartidos en memoria via vi.mock de los factories (los reales
// instancian de nuevo por request y el estado se perderia), y para
// apw-verification-status se mockea unicamente la resolucion DNS
// (resolveApwManifest/resolveApwIdentity); el resto -- thumbprint real
// Ed25519, manifiesto TXT sugerido, estados de anclaje -- es codigo real.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../packages/trust-layer/src/site-trust/authorized-agents", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/trust-layer/src/site-trust/authorized-agents")>();
  const store = new original.InMemoryAuthorizedAgentsStore();
  return { ...original, createAuthorizedAgentsStore: async () => store };
});

const apw = vi.hoisted(() => ({
  resolveApwManifest: vi.fn(),
  resolveApwIdentity: vi.fn(),
}));
vi.mock("../../packages/apw-resolver/src/index", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/apw-resolver/src/index")>();
  return { ...original, resolveApwManifest: apw.resolveApwManifest, resolveApwIdentity: apw.resolveApwIdentity };
});

vi.mock("../../packages/apw-resolver/src/did-apw/store-factory", async () => {
  const { InMemorySiteIdentityStore } = await import("../../packages/apw-resolver/src/did-apw/site-identity-store");
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const env = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: key };
  const identity = new InMemorySiteIdentityStore(env);
  const log = { head: async () => null as any };
  return {
    createSiteIdentityStore: async () => identity,
    createAttestationLogStore: async () => log,
    __identityStore: identity,
    __env: env,
  };
});

import * as authorizedAgents from "../../functions/admin/api/authorized-agents";
import * as apwStatus from "../../functions/admin/api/apw-verification-status";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import { jwkThumbprint } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import * as storeFactory from "../../packages/apw-resolver/src/did-apw/store-factory";

function ctx(opts: { user?: { username: string; role: string } | null; body?: unknown; url?: string; rawBody?: string } = {}) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    headers["content-type"] = "application/json";
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const request = new Request(opts.url ?? "http://x.test/admin/api/authorized-agents", {
    method: "POST",
    headers,
    body,
  });
  return {
    request,
    env: {},
    params: {},
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

const admin = { username: "admin", role: "admin" };
const viewer = { username: "v", role: "viewer" };

describe("functions/admin/api/authorized-agents.js", () => {
  it("GET sin sesion responde 401", async () => {
    const res = await authorizedAgents.onRequestGet(ctx({ user: null }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("GET con sesion devuelve la lista (vacia al principio)", async () => {
    const res = await authorizedAgents.onRequestGet(ctx({ user: admin }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agents: [] });
  });

  it("POST sin sesion 401 y como viewer 403 (el guard es server-side)", async () => {
    expect((await authorizedAgents.onRequestPost(ctx({ user: null, body: {} }))).status).toBe(401);
    const forbidden = await authorizedAgents.onRequestPost(
      ctx({ user: viewer, body: { agentKeyId: "k", signatureAgentUrl: "https://o", displayName: "d" } })
    );
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).message).toContain("viewer");
  });

  it("POST con body invalido responde 400 (JSON roto y grant incompleto)", async () => {
    const broken = await authorizedAgents.onRequestPost(ctx({ user: admin, rawBody: "no-json" }));
    expect(broken.status).toBe(400);
    const incomplete = await authorizedAgents.onRequestPost(ctx({ user: admin, body: { agentKeyId: "solo-id" } }));
    expect(incomplete.status).toBe(400);
    expect((await incomplete.json()).error).toBe("invalid_grant_body");
  });

  it("grant como admin aparece en el listado y revoke lo quita del activo", async () => {
    const grant = await authorizedAgents.onRequestPost(
      ctx({
        user: admin,
        body: {
          agentKeyId: "agent-key-1",
          signatureAgentUrl: "https://operator.example.com",
          displayName: "Operador de prueba",
          keyAlgorithm: "ed25519",
        },
      })
    );
    expect(grant.status).toBe(200);
    expect(await grant.json()).toEqual({ ok: true });

    const listed = await (await authorizedAgents.onRequestGet(ctx({ user: admin }))).json();
    expect(listed.agents).toHaveLength(1);
    expect(listed.agents[0].agentKeyId).toBe("agent-key-1");
    expect(listed.agents[0].authorizedBy).toBe("admin");

    const badRevoke = await authorizedAgents.onRequestPatch(ctx({ user: admin, body: {} }));
    expect(badRevoke.status).toBe(400);
    const brokenRevoke = await authorizedAgents.onRequestPatch(ctx({ user: admin, rawBody: "{" }));
    expect(brokenRevoke.status).toBe(400);
    expect((await authorizedAgents.onRequestPatch(ctx({ user: null, body: {} }))).status).toBe(401);
    expect((await authorizedAgents.onRequestPatch(ctx({ user: viewer, body: { agentKeyId: "x" } }))).status).toBe(403);

    const revoke = await authorizedAgents.onRequestPatch(ctx({ user: admin, body: { agentKeyId: "agent-key-1" } }));
    expect(revoke.status).toBe(200);
    const after = await (await authorizedAgents.onRequestGet(ctx({ user: admin }))).json();
    expect(after.agents.filter((a: any) => a.active === 1 || a.active === true)).toHaveLength(0);
  });
});

describe("functions/admin/api/apw-verification-status.js", () => {
  const url = "http://mysite.example/admin/api/apw-verification-status";

  it("sin sesion responde 401", async () => {
    const res = await apwStatus.onRequestGet(ctx({ user: null, url }));
    expect(res.status).toBe(401);
  });

  it("sin identidad local ni TXT: verified false y anchor no_identity (manifiesto v1 sugerido)", async () => {
    apw.resolveApwManifest.mockResolvedValueOnce({ resolved: false, reason: "txt_not_found", domain: "mysite.example" });
    const res = await apwStatus.onRequestGet(ctx({ user: admin, url }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain).toBe("mysite.example");
    expect(body.verified).toBe(false);
    expect(body.identity).toBeNull();
    expect(body.anchor.status).toBe("no_identity");
    expect(body.txtRecord.name).toBe("_apw.mysite.example");
    expect(body.txtRecord.withinLimit).toBe(true);
    expect(body.txtRecord.value).not.toContain('"k"'); // v1 sin clave: no hay identidad
  });

  async function seedIdentity() {
    const keyPair = await generateApwDid("mysite.example");
    const identityStore = (storeFactory as any).__identityStore;
    await identityStore.create("default", keyPair, "admin");
    return { keyPair, k: await jwkThumbprint(keyPair.publicKeyJwk) };
  }

  it("con identidad y TXT con el mismo h: verified true, anchor up_to_date, identity completa", async () => {
    const { k } = await seedIdentity();
    apw.resolveApwManifest.mockResolvedValueOnce({
      resolved: true,
      reason: "ok",
      domain: "mysite.example",
      manifest: { h: "h-igual", k },
    });
    apw.resolveApwIdentity.mockResolvedValueOnce({ verified: true, reason: null });
    const res = await apwStatus.onRequestGet(ctx({ user: admin, url }));
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.identity.did).toBe("did:apw:mysite.example");
    expect(body.identity.k).toBe(k);
    // sin historial local aun: el estado es no_history (no txt_without_h,
    // que es lo contrario: historial local sin h publicado)
    expect(body.anchor.status).toBe("no_history");
    expect(body.txtRecord.value).toContain(k); // v2: el TXT sugerido trae la huella
  });

  it("TXT publica un h distinto del local: anchor stale", async () => {
    const { k } = await seedIdentity();
    const logStore = {
      head: async () => ({ entryHash: "h-local", seq: 4 }),
    };
    vi.spyOn(storeFactory, "createAttestationLogStore").mockResolvedValueOnce(logStore as any);
    apw.resolveApwManifest.mockResolvedValueOnce({
      resolved: true,
      reason: "ok",
      domain: "mysite.example",
      manifest: { h: "h-viejo", k },
    });
    apw.resolveApwIdentity.mockResolvedValueOnce({ verified: true, reason: null });
    const res = await apwStatus.onRequestGet(ctx({ user: admin, url }));
    const body = await res.json();
    expect(body.anchor).toEqual({ status: "stale", publishedH: "h-viejo", localH: "h-local", localSeq: 4 });
    expect(body.identity.h).toBe("h-local");
  });

  it("con identidad pero sin TXT en DNS: anchor no_txt", async () => {
    await seedIdentity();
    apw.resolveApwManifest.mockResolvedValueOnce({ resolved: false, reason: "txt_not_found", domain: "mysite.example" });
    const res = await apwStatus.onRequestGet(ctx({ user: admin, url }));
    const body = await res.json();
    expect(body.anchor.status).toBe("no_txt");
    expect(body.identity.did).toBe("did:apw:mysite.example");
  });
});
