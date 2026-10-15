// packages/cloud-images: (a) verificacion STANDALONE contra el registro
// APW -- C2PA sin autoridad central: historial encadenado (claves que
// sobreviven rotacion), fallback a did.json, kid perteneciente al siteDid,
// hash opcional de la imagen; nunca lanza. (b) captureSiteTrust: captura
// de la SiteTrustScore publica contemporanea dentro del payload firmado.

import { describe, it, expect } from "vitest";
import { verifySidecarRemote, type RemoteVerifyDeps } from "../../packages/cloud-images/src/verify-remote";
import { captureSiteTrust, IMAGE_SITE_ID, type SiteTrustSnapshotLike } from "../../packages/cloud-images/src/trust";
import { buildCloudImagePayload, sha256Hash, encodeBase64, type CloudImageSidecar } from "../../packages/cloud-images/src/payload";
import { signCloudImage } from "../../packages/cloud-images/src/sign";
import { embedPng, PNG_SIGNATURE, crc32 } from "../../packages/cloud-images/src/png";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import { jwkThumbprint } from "../../packages/apw-resolver/src/did-apw/fingerprint";

const SITE_DID = "did:apw:ejemplo.com";
const IMAGE = new TextEncoder().encode("contenido-de-la-imagen");

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function minimalPng(): Uint8Array {
  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    chunk("IDAT", Uint8Array.from([1, 2, 3, 4])),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function signedWorld(): Promise<{ keyPair: Awaited<ReturnType<typeof generateApwDid>>; sidecar: CloudImageSidecar }> {
  const keyPair = await generateApwDid("ejemplo.com");
  const payload = buildCloudImagePayload({
    imageId: "img-1",
    contentHash: await sha256Hash(IMAGE),
    contentType: "image/png",
    byteLength: IMAGE.length,
    declaredOrigin: "ai",
    siteId: "default",
    siteDid: SITE_DID,
    signedAt: new Date().toISOString(),
    trust: null,
  });
  const jws = await signCloudImage(payload, { keyId: `${SITE_DID}#key-1`, privateKeyJwk: keyPair.privateKeyJwk });
  return { keyPair, sidecar: { payload, jws } };
}

function historyDeps(keyPair: Awaited<ReturnType<typeof generateApwDid>>, extra: Partial<RemoteVerifyDeps> = {}): RemoteVerifyDeps {
  return {
    resolveHistory: async () => ({
      verified: true,
      keys: [{ kid: "fingerprint", keyId: `${SITE_DID}#key-1`, publicKeyJwk: keyPair.publicKeyJwk }],
    }),
    resolveDid: async () => ({ verified: false }),
    ...extra,
  };
}

describe("verifySidecarRemote (registro APW como SSOT)", () => {
  it("valido via historial encadenado (rotacion incluida): keySource=history", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const result = await verifySidecarRemote(sidecar, historyDeps(keyPair));
    expect(result).toMatchObject({ valid: true, keySource: "history", signature: { valid: true }, contentHash: { status: "not_checked" } });
    expect(result.payload?.imageId).toBe("img-1");
  });

  it("fallback a did.json cuando el sitio aun no tiene historial verificado", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const result = await verifySidecarRemote(
      sidecar,
      historyDeps(keyPair, {
        resolveHistory: async () => ({ verified: false }),
        resolveDid: async () => ({
          verified: true,
          did: SITE_DID,
          didDocument: { verificationMethod: [{ publicKeyJwk: keyPair.publicKeyJwk }] },
        })
      })
    );
    expect(result).toMatchObject({ valid: true, keySource: "did.json" });
    expect(result.payload?.siteDid).toBe(SITE_DID);
  });

  it("historial que lanza y did.json que lanza -> site_keys_unresolvable sin excepcion", async () => {
    const { sidecar } = await signedWorld();
    const result = await verifySidecarRemote(sidecar, {
      resolveHistory: async () => {
        throw new Error("sin red");
      },
      resolveDid: async () => {
        throw new Error("sin red");
      }
    });
    expect(result).toMatchObject({ valid: false, reason: "site_keys_unresolvable", keySource: "none" });
  });

  it("did.json con DID distinto del payload no se acepta", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const result = await verifySidecarRemote(
      sidecar,
      historyDeps(keyPair, {
        resolveHistory: async () => ({ verified: false }),
        resolveDid: async () => ({
          verified: true,
          did: "did:apw:otro.example",
          didDocument: { verificationMethod: [{ publicKeyJwk: keyPair.publicKeyJwk }] }
        })
      })
    );
    expect(result.reason).toBe("site_keys_unresolvable");
  });

  it("sidecar basura y kid de otro sitio se rechazan antes de resolver claves", async () => {
    expect((await verifySidecarRemote(null)).reason).toBe("invalid_sidecar");
    expect((await verifySidecarRemote({ payload: { v: 1 } })).reason).toBe("invalid_sidecar");

    // kid del header (did:apw:ejemplo.com) debe pertenecer al siteDid del
    // payload: con el siteDid cambiado se rechaza SIN consultar el registro
    const { sidecar } = await signedWorld();
    let historyCalls = 0;
    const payload = { ...sidecar.payload, siteDid: "did:apw:otro.example" as const };
    const cross = await verifySidecarRemote({ ...sidecar, payload }, {
      resolveHistory: async () => {
        historyCalls += 1;
        return { verified: false };
      }
    });
    expect(cross.reason).toBe("kid_did_mismatch");
    expect(historyCalls).toBe(0);
  });

  it("clave candidata equivocada -> key_not_found (no valida con cualquier llave)", async () => {
    const { sidecar } = await signedWorld();
    const otra = await generateApwDid("otro.example");
    const result = await verifySidecarRemote(sidecar, {
      resolveHistory: async () => ({
        verified: true,
        keys: [{ kid: "otra-huella", keyId: "did:apw:otro.example#key-9", publicKeyJwk: otra.publicKeyJwk }]
      })
    });
    expect(result).toMatchObject({ valid: false, reason: "key_not_found", keySource: "history" });
  });
});

describe("verifySidecarRemote + hash de la imagen", () => {
  it("imagen correcta -> contentHash match", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const result = await verifySidecarRemote(sidecar, historyDeps(keyPair, { imageBase64: encodeBase64(IMAGE) }));
    expect(result).toMatchObject({ valid: true, contentHash: { status: "match" } });
  });

  it("imagen alterada -> mismatch + content_hash_mismatch", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const result = await verifySidecarRemote(
      sidecar,
      historyDeps(keyPair, { imageBase64: encodeBase64(new TextEncoder().encode("contenido-alterado")) })
    );
    expect(result).toMatchObject({ valid: false, reason: "content_hash_mismatch", contentHash: { status: "mismatch" }, signature: { valid: true } });
  });

  it("imageBase64 invalido -> mismatch (nunca lanza)", async () => {
    const { keyPair, sidecar } = await signedWorld();
    const result = await verifySidecarRemote(sidecar, historyDeps(keyPair, { imageBase64: "no es base64!!" }));
    expect(result.contentHash.status).toBe("mismatch");
    expect(result.valid).toBe(false);
  });

  it("PNG con el sidecar embebido tambien matchea (strip automatico del pAPW)", async () => {
    const png = minimalPng();
    const keyPair = await generateApwDid("ejemplo.com");
    const payload = buildCloudImagePayload({
      imageId: "img-png",
      contentHash: await sha256Hash(png),
      contentType: "image/png",
      byteLength: png.length,
      declaredOrigin: "human",
      siteId: "default",
      siteDid: SITE_DID,
      signedAt: new Date().toISOString(),
      trust: null
    });
    const jws = await signCloudImage(payload, { keyId: `${SITE_DID}#key-1`, privateKeyJwk: keyPair.privateKeyJwk });
    const sidecar = { payload, jws };
    const embedded = embedPng(png, JSON.stringify(sidecar));
    const deps = historyDeps(keyPair);

    expect(await verifySidecarRemote(sidecar, { ...deps, imageBase64: encodeBase64(embedded) })).toMatchObject({
      valid: true,
      contentHash: { status: "match" }
    });
    expect(await verifySidecarRemote(sidecar, { ...deps, imageBase64: encodeBase64(png) })).toMatchObject({
      valid: true,
      contentHash: { status: "match" }
    });
  });
});

describe("captureSiteTrust", () => {
  const snapshot: SiteTrustSnapshotLike = {
    siteId: IMAGE_SITE_ID,
    self: [{ category: "privacy_policy", declaredValue: true }],
    agent: [{ category: "https_and_headers", verified: true, agentKeyId: "k1", verifiedAt: "2026-10-01T00:00:00.000Z" }],
    // E-13: dos atestaciones firmadas y coincidentes (calibran a J = 7 -> 2.0,
    // el min_weight) para que W-02 puntue. Una opinion sin firma ya no puntua.
    community: [
      { category: "content_accuracy", score: 5, iss: "did:apw:v1.example", jti: "c1", iat: 1800000000, votedAt: "2026-10-01T00:00:00.000Z", emitterFirstSeenIat: 1700000000 },
      { category: "content_accuracy", score: 5, iss: "did:apw:v2.example", jti: "c2", iat: 1800000000, votedAt: "2026-10-01T00:00:00.000Z", emitterFirstSeenIat: 1700000000 },
    ],
    escrowReports: [{ transactionOutcome: "completed_as_promised", escrowProvider: "e1", reportedAt: "2026-10-01T00:00:00.000Z" }]
  };

  it("counts + proyeccion publica (governed withheld) con now inyectable", async () => {
    const trust = await captureSiteTrust({}, {
      createTrustStore: async () => ({ getSnapshot: async () => snapshot }),
      now: () => new Date("2026-10-12T12:00:00.000Z")
    });
    expect(trust).not.toBeNull();
    expect(trust!.siteId).toBe("default");
    expect(trust!.counts).toEqual({ self: 1, agent: 1, community: 2, escrowReports: 1 });
    expect(trust!.computedAt).toBe("2026-10-12T12:00:00.000Z");
    // publicas (W-01/04) en dimensions + agregados de TODAS (A.6); W-02 y
    // W-05 existen pero son gobernadas -> solo en aggregates con withheld
    expect(Object.keys(trust!.projection!.aggregates).sort()).toEqual(["W-01", "W-02", "W-04", "W-05"]);
    expect(Object.keys(trust!.projection!.dimensions).sort()).toEqual(["W-01", "W-04"]);
    expect(trust!.projection!.governed).toBe("withheld");
  });

  it("snapshot vacio -> counts en cero y proyeccion vacia", async () => {
    const trust = await captureSiteTrust({}, {
      createTrustStore: async () => ({ getSnapshot: async () => ({ siteId: IMAGE_SITE_ID }) })
    });
    expect(trust!.counts).toEqual({ self: 0, agent: 0, community: 0, escrowReports: 0 });
    expect(trust!.projection).toMatchObject({ aggregates: {}, dimensions: {}, governed: "withheld" });
  });

  it("store que lanza -> null (la firma de la imagen nunca depende de la reputacion)", async () => {
    expect(
      await captureSiteTrust({}, {
        createTrustStore: async () => {
          throw new Error("sin store");
        }
      })
    ).toBeNull();
    expect(
      await captureSiteTrust({}, {
        createTrustStore: async () => ({
          getSnapshot: async () => {
            throw new Error("snapshot roto");
          }
        })
      })
    ).toBeNull();
  });

  it("sin deps importa el store real del trust-layer (env vacio -> InMemory con warn, no rompe)", async () => {
    const trust = await captureSiteTrust({});
    expect(trust).not.toBeNull();
    expect(trust!.siteId).toBe("default");
    expect(trust!.counts).toEqual({ self: 0, agent: 0, community: 0, escrowReports: 0 });
  });
});
