// functions/.well-known/apw-witnesses.json.js (40 lineas a 0%): publica
// los statements typ "apw-witness+jws" del historial propio, con
// paginacion. Stores compartidos en memoria (identidad + historial) con
// la misma clave de cifrado; el seed usa los firmadores reales
// (signSelfAttestation / signWitnessStatement + appendAttestation) para
// que los payloads decodificados por el endpoint sean JWS de verdad.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../packages/apw-resolver/src/did-apw/store-factory", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../packages/apw-resolver/src/did-apw/store-factory")>();
  const { InMemorySiteIdentityStore } = await import("../../packages/apw-resolver/src/did-apw/site-identity-store");
  const { InMemoryAttestationLogStore } = await import("../../packages/apw-resolver/src/did-apw/attestation-log-store");
  const identity = new InMemorySiteIdentityStore({
    PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(11))),
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

import * as witnesses from "../../functions/.well-known/apw-witnesses.json";
import { generateApwDid } from "../../packages/apw-resolver/src/did-apw/generate";
import { signSelfAttestation } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { signWitnessStatement } from "../../packages/apw-resolver/src/did-apw/witness";
import { appendAttestation } from "../../packages/apw-resolver/src/did-apw/history-log";
import * as apwStoreFactory from "../../packages/apw-resolver/src/did-apw/store-factory";

const SITE_ID = "default";
const HEAD = "AaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA"; // 43 chars

function get(query = "") {
  const context = {
    request: new Request(`http://x.test/.well-known/apw-witnesses.json${query}`),
    env: {},
    params: {},
    data: {},
    next: async () => new Response("static"),
  } as any;
  return witnesses.onRequestGet(context);
}

describe("functions/.well-known/apw-witnesses.json.js", () => {
  it("404 sin identidad did:apw del propio sitio", async () => {
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "site_identity_not_found" });
  });

  it("200 sin entradas: entries vacio, length 0, cache publico y CORS", async () => {
    const keyPair = await generateApwDid("testigo.example");
    await (apwStoreFactory as any).__identity.create(SITE_ID, keyPair, "admin");

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = await res.json();
    expect(body.did).toBe("did:apw:testigo.example");
    expect(body.length).toBe(0);
    expect(body.entries).toEqual([]);
    expect(body.next).toBeNull();
  });

  it("publica SOLO los witness statements (un self attestation se filtra)", async () => {
    const identityStore = (apwStoreFactory as any).__identity;
    const log = (apwStoreFactory as any).__log;
    const identity = await identityStore.get(SITE_ID);
    const key = await identityStore.getActiveSigningKey(SITE_ID);

    // Entrada 1: atestacion self (typ distinto) -- NO debe aparecer.
    const selfAttestation = await signSelfAttestation(
      { did: identity.did, category: "privacy_policy", value: true },
      { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk }
    );
    await appendAttestation({ identity: identityStore, log, siteId: SITE_ID }, selfAttestation.jws);

    // Entradas 2 y 3: statements de testigo sobre dos sujetos.
    const w1 = await signWitnessStatement(
      { iss: identity.did, sub: "did:apw:uno.example", seq: 3, head: HEAD, ts: "2026-10-01T00:00:00.000Z" },
      { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk }
    );
    await appendAttestation({ identity: identityStore, log, siteId: SITE_ID }, w1.jws);
    const w2 = await signWitnessStatement(
      { iss: identity.did, sub: "did:apw:dos.example", seq: 7, head: HEAD, ts: "2026-10-02T00:00:00.000Z" },
      { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk }
    );
    await appendAttestation({ identity: identityStore, log, siteId: SITE_ID }, w2.jws);

    const res = await get();
    const body = await res.json();
    expect(body.length).toBe(3); // head del historial completo
    expect(body.entries).toHaveLength(2); // pero solo los witness
    expect(body.entries[0]).toMatchObject({
      seq: 2,
      jws: w1.jws,
      witness: { sub: "did:apw:uno.example", seq: 3, head: HEAD, ts: "2026-10-01T00:00:00.000Z" },
    });
    expect(body.entries[0].witness.jti).toMatch(/^wt-/);
    expect(body.entries[0].att).toMatch(/^[A-Za-z0-9_-]{43}$/); // sha256b64url del jws
    expect(body.entries[1].witness.sub).toBe("did:apw:dos.example");
    expect(body.next).toBeNull();
  });

  it("paginacion: ?limit=1 devuelve la primera y apunta a la siguiente con next", async () => {
    const res = await get("?limit=1&from=1");
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].witness.sub).toBe("did:apw:uno.example");
    expect(body.next).toBe(3); // seq de la segunda entrada witness

    const secondPage = await get(`?from=${body.next}&limit=1`);
    const second = await secondPage.json();
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].witness.sub).toBe("did:apw:dos.example");
  });
});
