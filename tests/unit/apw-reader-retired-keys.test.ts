// Claves no activas del lector (APW 6.3): despues de rotar, la clave
// retirada sigue siendo aceptada para firmar requests mientras su ventana
// [validFrom, validTo + gracia de rollover] cubra el momento de la request,
// y solo si firmo al menos una entrada de la cadena verificada del lector.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRetiredReaderKeyUsable,
  resolveReaderState,
  ReaderStateCache,
  defaultReaderResolvers,
  RETIRED_READER_KEY_GRACE_MS,
  type ReaderResolvers,
  type WebBotAuthLike,
} from "../../packages/apw-resolver/src/scoring/reader-identity";
import { InMemorySiteIdentityStore } from "../../packages/apw-resolver/src/did-apw/site-identity-store";
import { InMemoryAttestationLogStore } from "../../packages/apw-resolver/src/did-apw/attestation-log-store";
import { appendAttestation, type ChainKey } from "../../packages/apw-resolver/src/did-apw/history-log";
import { jwkThumbprint, publicJwkMembers } from "../../packages/apw-resolver/src/did-apw/fingerprint";
import { buildDidDocument } from "../../packages/apw-resolver/src/did-apw/document";
import { buildApwManifest, serializeApwManifest } from "../../packages/apw-resolver/src/manifest";
import type { ApwKeyPair } from "../../packages/apw-resolver/src/did-apw/types";

const state = vi.hoisted(() => ({ identity: null as any, log: null as any }));
vi.mock("../../packages/apw-resolver/src/did-apw/store-factory.ts", () => ({
  createSiteIdentityStore: async () => state.identity,
  createAttestationLogStore: async () => state.log,
}));

const SITE = "default";
const DOMAIN = "indice.example";
const ENV = { PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))) };
const KEY1_FROM = "2026-01-01T00:00:00.000Z";
const KEY1_TO = "2026-10-01T00:00:00.000Z";
const KEY1_ID = `did:apw:${DOMAIN}#key-1`;
const INSIDE = Date.parse("2026-10-01T00:05:00.000Z"); // valido: dentro de la gracia
const K_ACTIVE = "B".repeat(43);
const ENTRY_KID = "C".repeat(43);

const b64 = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");

async function makeKeyPair(domain = DOMAIN): Promise<ApwKeyPair> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const did = `did:apw:${domain}`;
  return { did, domain, publicKeyJwk, privateKeyJwk, didDocument: buildDidDocument(did, publicKeyJwk) };
}

const RETIRED_KEY: ChainKey = {
  kid: ENTRY_KID,
  keyId: KEY1_ID,
  publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "x" },
  validFrom: KEY1_FROM,
  validTo: KEY1_TO,
};

const keys: ChainKey[] = [
  RETIRED_KEY,
  { kid: K_ACTIVE, keyId: `did:apw:${DOMAIN}#key-2`, publicKeyJwk: RETIRED_KEY.publicKeyJwk, validFrom: KEY1_TO, validTo: null },
];

function check(over: Partial<Parameters<typeof isRetiredReaderKeyUsable>[0]> = {}) {
  return isRetiredReaderKeyUsable({
    keys,
    entryKids: [ENTRY_KID],
    thumbprint: ENTRY_KID,
    activeFingerprint: K_ACTIVE,
    nowMs: INSIDE,
    ...over,
  });
}

describe("isRetiredReaderKeyUsable (6.3)", () => {
  it("acepta la clave retirada dentro de su ventana + gracia y devuelve el cierre", () => {
    expect(check()).toEqual({
      usable: true,
      windowEndsAt: Date.parse(KEY1_TO) + RETIRED_READER_KEY_GRACE_MS,
    });
  });

  it("rechaza al cerrarse la gracia, antes del inicio y en la clave activa", () => {
    expect(check({ nowMs: Date.parse(KEY1_TO) + RETIRED_READER_KEY_GRACE_MS + 1 }).usable).toBe(false);
    expect(check({ nowMs: Date.parse("2025-12-31T23:59:59.000Z") }).usable).toBe(false);
    expect(check({ thumbprint: K_ACTIVE }).usable).toBe(false);
  });

  it("una clave que no esta en la lista publicada no sirve", () => {
    expect(check({ thumbprint: "D".repeat(43) }).usable).toBe(false);
  });

  it("una clave no-k con ventana abierta (incoherente) no sirve", () => {
    expect(check({ keys: [{ ...RETIRED_KEY, validTo: null }] }).usable).toBe(false);
  });

  it("exige que la clave haya firmado una entrada de la cadena verificada", () => {
    expect(check({ entryKids: [] }).usable).toBe(false);
    expect(check({ entryKids: [K_ACTIVE] }).usable).toBe(false);
    // El kid de la entrada puede ser el keyId DID en vez de la huella (E-3).
    expect(check({ entryKids: [KEY1_ID] }).usable).toBe(true);
    expect(check({ entryKids: [null, undefined] }).usable).toBe(false);
  });

  it("acepta una ventana personalizada de gracia", () => {
    const later = Date.parse("2026-10-01T00:30:00.000Z");
    expect(check({ nowMs: later }).usable).toBe(false);
    expect(check({ nowMs: later, graceMs: 60 * 60 * 1000 }).usable).toBe(true);
  });
});

describe("resolveReaderState con claves no activas (6.3)", () => {
  const X = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo";
  const wbaOld: WebBotAuthLike = {
    verified: true,
    keyRecord: { operator: `https://${DOMAIN}`, publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: X } },
  };
  const k = "F".repeat(43);

  function resolvers(over: Partial<ReaderResolvers> = {}): ReaderResolvers {
    return {
      resolveTxtKey: async () => k,
      verifyHistory: async () => true,
      loadScores: async () => new Map(),
      ...over,
    };
  }

  it("sin acceptRetiredKey (resolutor viejo) una clave que no es k queda apw_unresolvable", async () => {
    const s = await resolveReaderState(wbaOld, resolvers(), new ReaderStateCache(), INSIDE);
    expect(s).toMatchObject({ kind: "apw_unresolvable", reason: "key_not_bound_to_apw" });
  });

  it("con el veredicto usable y cadena verificada queda apw_verified", async () => {
    const s = await resolveReaderState(
      wbaOld,
      resolvers({ acceptRetiredKey: async () => ({ usable: true, windowEndsAt: INSIDE + 60_000 }) }),
      new ReaderStateCache(),
      INSIDE
    );
    expect(s).toMatchObject({ kind: "apw_verified", did: `did:apw:${DOMAIN}` });
  });

  it("si el veredicto es negativo, o la ventana ya cerro, sigue afuera", async () => {
    for (const verdict of [{ usable: false }, { usable: true, windowEndsAt: INSIDE - 1 }]) {
      const s = await resolveReaderState(
        wbaOld,
        resolvers({ acceptRetiredKey: async () => verdict as any }),
        new ReaderStateCache(),
        INSIDE
      );
      expect(s).toMatchObject({ kind: "apw_unresolvable", reason: "key_not_bound_to_apw" });
    }
  });

  it("el cache de una clave retirada no vive mas alla del cierre de su ventana", async () => {
    const windowEndsAt = INSIDE + 60_000; // menos que READER_CACHE_OK_MS
    const spy = vi.fn(async (_host: string, _thumb: string, nowMs: number) =>
      nowMs < windowEndsAt ? { usable: true, windowEndsAt } : { usable: false }
    );
    const r = resolvers({ acceptRetiredKey: spy });
    const cache = new ReaderStateCache();

    expect(await resolveReaderState(wbaOld, r, cache, INSIDE)).toMatchObject({ kind: "apw_verified" });
    // Dentro del cierre: cacheado, sin nueva resolucion.
    expect(await resolveReaderState(wbaOld, r, cache, INSIDE + 1_000)).toMatchObject({ kind: "apw_verified" });
    expect(spy).toHaveBeenCalledTimes(1);

    // Pasado el cierre el cache no estira la aceptacion.
    expect(await resolveReaderState(wbaOld, r, cache, windowEndsAt + 1)).toMatchObject({
      kind: "apw_unresolvable",
      reason: "key_not_bound_to_apw",
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("rotacion real del lector -> request firmada con la clave vieja", () => {
  afterEach(() => {
    state.identity = null;
    state.log = null;
  });

  const fakeAttestation = (n: number) => `eyJ0IjoxfQ.${b64(`att-${n}`)}.c2ln`;

  function fetchFor(manifest: ReturnType<typeof buildApwManifest>) {
    const txt = serializeApwManifest(manifest);
    return vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/.well-known/apw-log.json")) {
        const { onRequestGet } = await import("../../functions/.well-known/apw-log.json.js");
        const path = url.slice(url.indexOf("/.well-known"));
        const res = await onRequestGet({ env: {}, request: new Request(`https://${DOMAIN}${path}`) });
        return { ok: res.ok, status: res.status, json: async () => res.json() };
      }
      return {
        ok: true,
        json: async () => ({
          Status: 0,
          Answer: [{ name: `_apw.${DOMAIN}.`, type: 16, TTL: 300, data: `"${txt.replace(/"/g, '\\"')}"` }],
        }),
      };
    });
  }

  async function seedRotated() {
    const identity = new InMemorySiteIdentityStore(ENV);
    const log = new InMemoryAttestationLogStore();
    state.identity = identity;
    state.log = log;

    const old = await makeKeyPair();
    await identity.create(SITE, old, "admin");
    const deps = { identity, log, siteId: SITE };
    await appendAttestation(deps, fakeAttestation(1));
    await identity.rotate(SITE, await makeKeyPair(), "admin");

    const stored = await identity.listKeys(SITE);
    const retired = stored.find((key) => key.validTo !== null)!;
    const active = stored.find((key) => key.validTo === null)!;
    const head = await log.head(SITE);
    return { old, retired, active, head };
  }

  it("acepta la clave retirada dentro de la gracia y la rechaza despues", async () => {
    const { old, retired, active, head } = await seedRotated();
    const manifest = buildApwManifest({ siteId: DOMAIN, contentKinds: ["mixed"], k: active.kid, h: head!.entryHash });
    const fetchImpl = fetchFor(manifest) as unknown as typeof fetch;

    const wba: WebBotAuthLike = {
      verified: true,
      keyRecord: { operator: `https://${DOMAIN}`, publicKeyJwk: publicJwkMembers(old.publicKeyJwk) },
    };
    const readerResolvers: ReaderResolvers = {
      ...defaultReaderResolvers(fetchImpl),
      loadScores: async () => new Map(),
    };

    const validTo = Date.parse(retired.validTo!);
    const inside = await resolveReaderState(wba, readerResolvers, new ReaderStateCache(), validTo + 60_000);
    expect(inside).toMatchObject({ kind: "apw_verified", did: `did:apw:${DOMAIN}` });

    const outside = await resolveReaderState(
      wba,
      readerResolvers,
      new ReaderStateCache(),
      validTo + RETIRED_READER_KEY_GRACE_MS + 1
    );
    expect(outside).toMatchObject({ kind: "apw_unresolvable", reason: "key_not_bound_to_apw" });

    // La clave activa (`k` del TXT) sigue verificando sin depender de la gracia.
    const activeWba: WebBotAuthLike = {
      verified: true,
      keyRecord: { operator: `https://${DOMAIN}`, publicKeyJwk: publicJwkMembers(active.publicKeyJwk) },
    };
    expect(await jwkThumbprint(publicJwkMembers(active.publicKeyJwk))).toBe(active.kid);
    expect(await resolveReaderState(activeWba, readerResolvers, new ReaderStateCache(), validTo + 3_600_000)).toMatchObject({
      kind: "apw_verified",
    });
  });
});
