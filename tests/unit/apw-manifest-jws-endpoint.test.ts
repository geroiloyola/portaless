// functions/.well-known/apw-manifest.jws.js (23 lineas a 0%): manifiesto
// extendido firmado (JWS EdDSA, payload JCS) que publica el sitio en cada
// request. Stores compartidos en memoria con la misma clave de cifrado;
// el JWS se verifica con verifySiteJws REAL contra la clave publica de la
// identidad, y `h` se contrasta contra la cabeza real del historial.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../packages/apw-resolver/src/did-apw/store-factory", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/apw-resolver/src/did-apw/store-factory")>();
  const { InMemorySiteIdentityStore } = await import("../../packages/apw-resolver/src/did-apw/site-identity-store");
  const { InMemoryAttestationLogStore } = await import("../../packages/apw-resolver/src/did-apw/attestation-log-store");
  const identity = new InMemorySiteIdentityStore({
    PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(13))),
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

import * as manifestJws from "../../functions/.well-known/apw-manifest.jws";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import { signSelfAttestation } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { appendAttestation } from "../../packages/apw-resolver/src/did-apw/history-log";
import { verifySiteJws, MANIFEST_TYP } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { jwkThumbprint } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import * as apwStoreFactory from "../../packages/apw-resolver/src/did-apw/store-factory";

function get() {
  return manifestJws.onRequestGet({
    request: new Request("http://misitio.example/.well-known/apw-manifest.jws"),
    env: {},
    params: {},
    data: {},
    next: async () => new Response("static"),
  } as any);
}

describe("functions/.well-known/apw-manifest.jws.js", () => {
  it("404 sin identidad did:apw", async () => {
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "site_identity_not_found" });
  });

  it("con identidad pero historial vacio: h null en el payload", async () => {
    const identityStore = (apwStoreFactory as any).__identity;
    const keyPair = await generateApwDid("misitio.example");
    await identityStore.create("default", keyPair, "admin");

    const res = await get();
    expect(res.status).toBe(200);
    const jws = await res.text();
    const activeKey = await identityStore.getActiveSigningKey("default");
    const verified = await verifySiteJws(jws, activeKey.publicKeyJwk, { kid: activeKey.keyId, typ: MANIFEST_TYP });
    expect(verified.ok).toBe(true);
    const payload = (verified as { ok: true; payload: any }).payload;
    expect(payload.h).toBeUndefined(); // sin historial el campo se omite
    expect(payload.k).toBe(await jwkThumbprint(keyPair.publicKeyJwk));
  });

  it("con historial: h es la cabeza real del log", async () => {
    const identityStore = (apwStoreFactory as any).__identity;
    const log = (apwStoreFactory as any).__log;

    // Una entrada en el historial para que `h` tenga valor.
    const key = await identityStore.getActiveSigningKey("default");
    const identity = await identityStore.get("default");
    const att = await signSelfAttestation(
      { did: identity.did, category: "gdpr_compliance", value: true },
      { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk }
    );
    const entry = await appendAttestation({ identity: identityStore, log, siteId: "default" }, att.jws);

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/jose");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const jws = await res.text();
    const activeKey = await identityStore.getActiveSigningKey("default");
    const verified = await verifySiteJws(jws, activeKey.publicKeyJwk, { kid: activeKey.keyId, typ: MANIFEST_TYP });
    expect(verified.ok).toBe(true);
    const payload = (verified as { ok: true; payload: any }).payload;
    expect(payload.did).toBe("did:apw:misitio.example");
    expect(payload.siteId).toBe("misitio.example"); // siteId = dominio
    expect(payload.h).toBe(entry.entryHash); // cabeza REAL del historial
    expect(typeof payload.iat).toBe("number");
    expect(payload.trustUrl).toContain("/trust/");
  });
});
