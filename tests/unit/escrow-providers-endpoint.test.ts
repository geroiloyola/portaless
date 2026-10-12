// functions/admin/api/authorized-escrow-providers.js (allowlist de la
// fuente "escrow_report"): GET/POST/PUT/PATCH contra el backend SQLite
// REAL en un archivo temporal (ademas del endpoint, cubre grant/setPublicKey/
// revoke/list de SqliteAuthorizedEscrowProvidersStore). Contrato clave:
// la API key en texto plano solo aparece en la respuesta del grant (y rota
// al re-autorizar); GET jamas la expone; PUT cambia la clave publica sin
// rotar la API key; la clave Ed25519 se valida server-side.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";

import * as escrow from "../../functions/admin/api/authorized-escrow-providers";

const tmp = mkdtempSync(join(tmpdir(), "portaless-escrow-"));
const dbPath = join(tmp, "escrow.db");
const env = { PORTALESS_SQLITE_PATH: dbPath };

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const admin = { username: "admin", role: "admin" };
const viewer = { username: "v", role: "viewer" };

function ed25519PublicJwk(): Record<string, string> {
  const { publicKey } = generateKeyPairSync("ed25519");
  return publicKey.export({ format: "jwk" }) as Record<string, string>;
}

function ctx(opts: { user?: { username: string; role: string } | null; body?: unknown; rawBody?: string; method?: string } = {}) {
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
    request: new Request("http://x.test/admin/api/authorized-escrow-providers", {
      method: opts.method ?? "POST",
      headers,
      body,
    }),
    env,
    params: {},
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

describe("functions/admin/api/authorized-escrow-providers.js", () => {
  it("GET: 401 sin sesion; lista vacia con sesion", async () => {
    expect((await escrow.onRequestGet(ctx({ user: null }))).status).toBe(401);
    const res = await escrow.onRequestGet(ctx({ user: admin }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ providers: [] });
  });

  it("POST: 401/403 sin permiso, 400 en body invalido", async () => {
    expect((await escrow.onRequestPost(ctx({ user: null, body: {} }))).status).toBe(401);
    expect((await escrow.onRequestPost(ctx({ user: viewer, body: { providerId: "p", displayName: "d" } }))).status).toBe(403);
    expect((await escrow.onRequestPost(ctx({ user: admin, rawBody: "{" }))).status).toBe(400);
    const incomplete = await escrow.onRequestPost(ctx({ user: admin, body: { providerId: "solo" } }));
    expect(incomplete.status).toBe(400);
    expect((await incomplete.json()).error).toBe("invalid_grant_body");
  });

  it("grant devuelve apiKey en claro; re-grant la rota; GET nunca la expone", async () => {
    const first = await escrow.onRequestPost(
      ctx({ user: admin, body: { providerId: "prov-1", displayName: "Escrow Uno" } })
    );
    expect(first.status).toBe(200);
    const granted = await first.json();
    expect(granted.provider.providerId).toBe("prov-1");
    expect(granted.provider.authorizedBy).toBe("admin");
    expect(granted.provider.active).toBe(true);
    expect(typeof granted.apiKey).toBe("string");
    expect(granted.apiKey.length).toBeGreaterThan(10);
    expect(JSON.stringify(granted.provider)).not.toContain(granted.apiKey); // ni el hash ni la key en el provider

    const listed = await (await escrow.onRequestGet(ctx({ user: admin }))).json();
    expect(listed.providers).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(granted.apiKey);

    const rotated = await escrow.onRequestPost(
      ctx({ user: admin, body: { providerId: "prov-1", displayName: "Escrow Uno" } })
    );
    const rotatedBody = await rotated.json();
    expect(rotatedBody.apiKey).not.toBe(granted.apiKey); // re-autorizar rota la key
  });

  it("grant con publicKeyJwk invalida responde 400; con Ed25519 valida la persiste", async () => {
    const invalid = await escrow.onRequestPost(
      ctx({ user: admin, body: { providerId: "prov-2", displayName: "Dos", publicKeyJwk: { kty: "RSA" } } })
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe("invalid_public_key_jwk");

    const jwk = ed25519PublicJwk();
    const valid = await escrow.onRequestPost(
      ctx({ user: admin, body: { providerId: "prov-2", displayName: "Dos", publicKeyJwk: jwk } })
    );
    expect(valid.status).toBe(200);
    const body = await valid.json();
    expect(body.provider.publicKeyJwk).toMatchObject({ kty: "OKP", crv: "Ed25519", x: jwk.x });
  });

  it("PUT: 400 sin publicKeyJwk en el body, 404 inexistente; null/'' quitan la clave sin rotar la API key", async () => {
    const grant = await (
      await escrow.onRequestPost(ctx({ user: admin, body: { providerId: "prov-3", displayName: "Tres" } }))
    ).json();

    const missingField = await escrow.onRequestPut(ctx({ user: admin, body: { providerId: "prov-3" } }));
    expect(missingField.status).toBe(400);
    const notFound = await escrow.onRequestPut(
      ctx({ user: admin, body: { providerId: "no-existe", publicKeyJwk: null } })
    );
    expect(notFound.status).toBe(404);

    const jwk = ed25519PublicJwk();
    const set = await escrow.onRequestPut(
      ctx({ user: admin, body: { providerId: "prov-3", publicKeyJwk: jwk } })
    );
    expect(set.status).toBe(200);

    const remove = await escrow.onRequestPut(
      ctx({ user: admin, body: { providerId: "prov-3", publicKeyJwk: null } })
    );
    expect(remove.status).toBe(200);
    const listed = await (await escrow.onRequestGet(ctx({ user: admin }))).json();
    const prov3 = listed.providers.find((p: any) => p.providerId === "prov-3");
    expect(prov3.publicKeyJwk).toBeNull();

    // La API key NO roto con PUT.
    const again = await escrow.onRequestPut(
      ctx({ user: admin, body: { providerId: "prov-3", publicKeyJwk: "" } })
    );
    expect(again.status).toBe(200);
    expect(grant.apiKey).toBeTruthy();
  });

  it("PATCH: revoca (active 0) y validaciones de body/permiso", async () => {
    expect((await escrow.onRequestPatch(ctx({ user: null, body: { providerId: "prov-1" } }))).status).toBe(401);
    expect((await escrow.onRequestPatch(ctx({ user: viewer, body: { providerId: "prov-1" } }))).status).toBe(403);
    expect((await escrow.onRequestPatch(ctx({ user: admin, rawBody: "x" }))).status).toBe(400);
    const incomplete = await escrow.onRequestPatch(ctx({ user: admin, body: {} }));
    expect(incomplete.status).toBe(400);
    expect((await incomplete.json()).error).toBe("invalid_revoke_body");

    const revoke = await escrow.onRequestPatch(ctx({ user: admin, body: { providerId: "prov-1" } }));
    expect(revoke.status).toBe(200);
    const listed = await (await escrow.onRequestGet(ctx({ user: admin }))).json();
    const prov1 = listed.providers.find((p: any) => p.providerId === "prov-1");
    expect(prov1.active).toBe(false);
  });
});
