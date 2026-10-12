// witness/record.js (E-10, testigo de cadenas ajenas) y
// site-trust/[siteId]/self.js (autoevaluacion firmada). Ambos a 0% de
// cobertura. Los stores de identidad/historial se comparten en memoria
// (con clave de cifrado) y se siembra UNA sola vez en el test 422 de
// witness: los tests de "sin identidad" corren antes del seed porque los
// stores compartidos no se pueden vaciar. resolveApwHistory se mockea
// (DNS + red); el firmado Ed25519, el JWS self, el encadenamiento y la
// deteccion de duplicados son reales.

import { describe, it, expect, vi } from "vitest";

const history = vi.hoisted(() => ({ resolveApwHistory: vi.fn() }));
vi.mock("../../packages/apw-resolver/src/did-apw/history-resolver", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../packages/apw-resolver/src/did-apw/history-resolver")
  >();
  return { ...original, resolveApwHistory: history.resolveApwHistory };
});

vi.mock("../../packages/apw-resolver/src/did-apw/store-factory", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/apw-resolver/src/did-apw/store-factory")>();
  const { InMemorySiteIdentityStore } = await import("../../packages/apw-resolver/src/did-apw/site-identity-store");
  const { InMemoryAttestationLogStore } = await import("../../packages/apw-resolver/src/did-apw/attestation-log-store");
  const identity = new InMemorySiteIdentityStore({
    PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))),
  });
  const log = new InMemoryAttestationLogStore();
  return {
    ...original,
    createSiteIdentityStore: async () => identity,
    createAttestationLogStore: async () => log,
    __identity: identity,
    __log: log,
  };
});

import * as self from "../../functions/admin/site-trust/[siteId]/self";
import * as witness from "../../functions/admin/api/witness/record";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import * as apwStoreFactory from "../../packages/apw-resolver/src/did-apw/store-factory";

const admin = { username: "admin", role: "admin" };
const viewer = { username: "v", role: "viewer" };

function ctx(opts: { user?: { username: string; role: string } | null; body?: unknown; rawBody?: string; siteId?: string } = {}) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    headers["content-type"] = "application/json";
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return {
    request: new Request("http://x.test/admin/api", { method: "POST", headers, body }),
    env: {},
    params: { siteId: opts.siteId ?? "default" },
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

describe("site-trust/[siteId]/self.js (sin identidad did:apw)", () => {
  it("401 sin sesion, 403 como viewer", async () => {
    expect((await self.onRequestPut(ctx({ user: null }))).status).toBe(401);
    const res = await self.onRequestPut(ctx({ user: viewer, body: { category: "privacy_policy", declaredValue: true } }));
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain("viewer");
  });

  it("400 sin siteId, con JSON roto, categoria invalida o declaredValue no boolean", async () => {
    expect((await self.onRequestPut(ctx({ user: admin, siteId: "" as any }))).status).toBe(400);
    expect((await self.onRequestPut(ctx({ user: admin, rawBody: "{" }))).status).toBe(400);
    const badCategory = await self.onRequestPut(ctx({ user: admin, body: { category: "no-existe", declaredValue: true } }));
    expect(badCategory.status).toBe(400);
    expect((await badCategory.json()).error).toBe("invalid_category");
    const badValue = await self.onRequestPut(
      ctx({ user: admin, body: { category: "gdpr_compliance", declaredValue: "si" } })
    );
    expect(badValue.status).toBe(400);
  });

  it("declaracion sin identidad: ok true, signed false, reason site_identity_not_found", async () => {
    const res = await self.onRequestPut(
      ctx({ user: admin, body: { category: "privacy_policy", declaredValue: true, evidenceUrl: " https://x.test/p " } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, signed: false, reason: "site_identity_not_found" });
  });
});

describe("admin/api/witness/record.js", () => {
  it("401 sin sesion, 403 como viewer", async () => {
    expect((await witness.onRequestPost(ctx({ user: null }))).status).toBe(401);
    const res = await witness.onRequestPost(ctx({ user: viewer, body: { domain: "sujeto.example" } }));
    expect(res.status).toBe(403);
  });

  it("400 con JSON roto o domain que no es hostname", async () => {
    expect((await witness.onRequestPost(ctx({ user: admin, rawBody: "no" }))).status).toBe(400);
    const bad = await witness.onRequestPost(ctx({ user: admin, body: { domain: "https://no-es-host" } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_domain");
  });

  it("404 si el sitio no tiene identidad did:apw propia", async () => {
    const res = await witness.onRequestPost(ctx({ user: admin, body: { domain: "sujeto.example" } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("site_identity_not_found");
  });

  it("422 si la cadena del sujeto no verifico; 400 self_witness", async () => {
    // Seed UNICO de la identidad del testigo (los stores son compartidos).
    const keyPair = await generateApwDid("testigo.example");
    await (apwStoreFactory as any).__identity.create("default", keyPair, "admin");

    history.resolveApwHistory.mockResolvedValueOnce({
      verified: false,
      reason: "txt_not_found",
      domain: "sujeto.example",
    });
    const unverified = await witness.onRequestPost(ctx({ user: admin, body: { domain: "sujeto.example" } }));
    expect(unverified.status).toBe(422);
    expect((await unverified.json()).reason).toBe("txt_not_found");

    const selfWitness = await witness.onRequestPost(ctx({ user: admin, body: { domain: "testigo.example" } }));
    expect(selfWitness.status).toBe(400);
    expect((await selfWitness.json()).error).toBe("self_witness");
  });

  it("201 al registrar; repetir el mismo head responde already_recorded", async () => {
    // Congelamos el reloj ANTES del primer registro para poder repetir el
    // mismo JWS en el segundo llamado (ver comentario mas abajo).
    vi.useFakeTimers({ toFake: ["Date"] });
    const frozen = new Date("2026-10-11T12:00:00.000Z");
    vi.setSystemTime(frozen);
    try {
      history.resolveApwHistory.mockResolvedValue({
        verified: true,
        reason: "ok",
        domain: "sujeto.example",
        length: 2,
        head: "HhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhH",
        anchoredSeq: 2,
      });
      const res = await witness.onRequestPost(ctx({ user: admin, body: { domain: "sujeto.example" } }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.recorded).toBe(true);
      expect(body.subject).toBe("did:apw:sujeto.example");
      expect(body.subjectSeq).toBe(2);
      expect(body.subjectHead).toBe("HhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhHhH");
      expect(body.subjectAnchoredSeq).toBe(2);
      expect(body.ownSeq).toBe(1);
      expect(body.ownHead).toBeTruthy();
      expect(body.statementJti).toMatch(/^wt-/);

      // El dedupe es por att_hash = sha256(jws): el payload lleva ts, asi que
      // dos observaciones en milisegundos distintos generarian JWS distintos y
      // NO chocarian. Con el reloj congelado el JWS es identico (Ed25519 es
      // determinista) y el indice unico del store dispara already_recorded.
      const again = await witness.onRequestPost(ctx({ user: admin, body: { domain: "sujeto.example" } }));
      expect(again.status).toBe(200);
      const dup = await again.json();
      expect(dup.recorded).toBe(false);
      expect(dup.reason).toBe("already_recorded");
      expect(dup.subject).toBe(body.subject);
      expect(dup.subjectHead).toBe(body.subjectHead);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("site-trust/[siteId]/self.js (con identidad, tras el seed)", () => {
  it("declaracion firmada: JWS real, anotada en el historial (logged true)", async () => {
    const res = await self.onRequestPut(
      ctx({ user: admin, body: { category: "payment_security", declaredValue: false } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.signed).toBe(true);
    expect(body.jti).toBeTruthy();
    expect(String(body.attestation).split(".")).toHaveLength(3); // JWS compacto
    expect(body.logged).toBe(true);
    expect(body.logReason).toBeUndefined();
  });

  it("siteId ajeno: signed false con reason not_this_site (sin firmar)", async () => {
    const res = await self.onRequestPut(ctx({ user: admin, siteId: "otro", body: { category: "gdpr_compliance", declaredValue: true } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, signed: false, reason: "not_this_site" });
  });
});
