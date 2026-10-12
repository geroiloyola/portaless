// POST /trust/images/verify: el endpoint standalone contra el registro
// APW. El verificador real (verifySidecarRemote) tiene sus propios tests
// con deps inyectadas; aca se mockea para no hacer red y se cubre el
// contrato del endpoint: 400 con body/sidecar invalidos, 200 pass-through
// del resultado estructurado con CORS y no-store.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocked = vi.hoisted(() => ({
  verifySidecarRemote: vi.fn(async () => ({
    valid: true,
    signature: { valid: true },
    contentHash: { status: "match" as const },
    keySource: "history" as const
  }))
}));

vi.mock("../../packages/cloud-images/src/verify-remote", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/cloud-images/src/verify-remote")>();
  return { ...original, verifySidecarRemote: mocked.verifySidecarRemote };
});

import * as verify from "../../functions/trust/images/verify";
import { buildCloudImagePayload, sha256Hash } from "../../packages/cloud-images/src/payload";
import { signCloudImage } from "../../packages/cloud-images/src/sign";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";

function ctx(body: unknown) {
  const request = new Request("http://x.test/trust/images/verify", {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, env: {}, params: {}, data: {}, next: async () => new Response("static") } as any;
}

async function validSidecar() {
  const keyPair = await generateApwDid("ejemplo.com");
  const payload = buildCloudImagePayload({
    imageId: "img-1",
    contentHash: await sha256Hash(new TextEncoder().encode("x")),
    contentType: "image/png",
    byteLength: 1,
    declaredOrigin: "mixed",
    siteId: "default",
    siteDid: "did:apw:ejemplo.com",
    signedAt: new Date().toISOString(),
    trust: null
  });
  const jws = await signCloudImage(payload, { keyId: "did:apw:ejemplo.com#key-1", privateKeyJwk: keyPair.privateKeyJwk });
  return { payload, jws };
}

beforeEach(() => {
  mocked.verifySidecarRemote.mockClear();
  mocked.verifySidecarRemote.mockResolvedValue({
    valid: true,
    signature: { valid: true },
    contentHash: { status: "match" },
    keySource: "history"
  } as never);
});

describe("POST /trust/images/verify", () => {
  it("400 si el body no es JSON valido o falta el sidecar", async () => {
    const bad = ctx(undefined);
    (bad.request as Request) = new Request("http://x.test/trust/images/verify", { method: "POST", body: "{basura" });
    expect((await verify.onRequestPost(bad)).status).toBe(400);

    const sinSidecar = await verify.onRequestPost(ctx({ imageBase64: "abc" }));
    expect(sinSidecar.status).toBe(400);
    expect((await sinSidecar.json()).error).toBe("invalid_sidecar");
    expect(mocked.verifySidecarRemote).not.toHaveBeenCalled();

    const payloadMalo = await verify.onRequestPost(ctx({ payload: { v: 9 }, jws: "a.b.c" }));
    expect((await payloadMalo.json()).error).toBe("invalid_sidecar");
  });

  it("200 pass-through del resultado con CORS y no-store; imageBase64 opcional", async () => {
    const sidecar = await validSidecar();
    const res = await verify.onRequestPost(ctx({ sidecar, imageBase64: "AAAA" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    expect(body).toMatchObject({ valid: true, keySource: "history" });
    expect(mocked.verifySidecarRemote).toHaveBeenCalledTimes(1);
    expect(mocked.verifySidecarRemote.mock.calls[0][1]).toMatchObject({ imageBase64: "AAAA" });

    const soloSidecar = await verify.onRequestPost(ctx({ sidecar }));
    expect(soloSidecar.status).toBe(200);
    expect(mocked.verifySidecarRemote.mock.calls[1][1]).toEqual({ imageBase64: undefined });
  });

  it("propaga un resultado invalido sin transformarlo", async () => {
    mocked.verifySidecarRemote.mockResolvedValue({
      valid: false,
      reason: "site_keys_unresolvable",
      signature: { valid: false, reason: "site_keys_unresolvable" },
      contentHash: { status: "not_checked" },
      keySource: "none"
    } as never);
    const sidecar = await validSidecar();
    const res = await verify.onRequestPost(ctx({ sidecar }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ valid: false, reason: "site_keys_unresolvable", keySource: "none" });
  });
});
