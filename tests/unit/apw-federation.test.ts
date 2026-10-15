// Fase 9b (federación): documento firmado de páginas, fetch endurecido,
// seguridad de renderizado y agregador de pares. Todo con fixtures e inyección
// de dependencias: no se abre ningún endpoint público ni se toca la red.
import { describe, it, expect } from "vitest";
import {
  buildPagesDocument,
  signPagesDocument,
  verifyPagesDocument,
  peekJwsKid,
  PAGES_TYP,
  MAX_PAGES_ENTRIES,
  parsePagesEntries,
} from "../../packages/apw-resolver/src/federation/pages-document";
import { signSiteJws } from "../../packages/apw-resolver/src/did-apw/site-jws";
import { isPrivateIp, assertSafeUrl, createSafeFetcher } from "../../packages/apw-resolver/src/federation/safe-fetch";
import { isSafeRemoteUrl, capItems, toPlainText } from "../../packages/apw-resolver/src/federation/render-safe";
import { createPeerAggregator, InMemoryPeerCache } from "../../packages/apw-resolver/src/federation/aggregate";
import type { PagesDocumentEntry } from "../../packages/apw-resolver/src/federation/pages-document";

const DID = "did:apw:example.com";
const KID = "did:apw:example.com#key-1";

async function ed25519() {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", kp.publicKey),
  };
}

const entry = (slug: string): PagesDocumentEntry => ({ kind: "page", slug, title: slug, url: `https://example.com/paginas/${slug}/`, publishedAt: "2026-10-01T00:00:00.000Z" });

describe("documento firmado de páginas", () => {
  it("idempotente y ordenado: mismo conjunto, mismos bytes", () => {
    const a = buildPagesDocument({ did: DID, iat: 1, entries: [entry("b"), entry("a")] });
    const b = buildPagesDocument({ did: DID, iat: 1, entries: [entry("a"), entry("b")] });
    expect(a).toEqual(b);
    expect(a.entries.map((e) => e.slug)).toEqual(["a", "b"]);
  });

  it("firma y verifica contra la identidad resuelta (typ propio)", async () => {
    const keys = await ed25519();
    const jws = await signPagesDocument({ did: DID, iat: 1800000000, entries: [entry("jerry")] }, { keyId: KID, privateKeyJwk: keys.privateJwk });
    expect(peekJwsKid(jws)).toBe(KID);
    const res = await verifyPagesDocument(jws, { publicKeyJwk: keys.publicJwk, kid: KID, did: DID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entries.map((e) => e.slug)).toEqual(["jerry"]);
  });

  it("rechaza un iss que no es el DID esperado", async () => {
    const keys = await ed25519();
    const jws = await signPagesDocument({ did: DID, iat: 1, entries: [entry("x")] }, { keyId: KID, privateKeyJwk: keys.privateJwk });
    const res = await verifyPagesDocument(jws, { publicKeyJwk: keys.publicJwk, kid: KID, did: "did:apw:otro.com" });
    expect(res).toEqual({ ok: false, reason: "iss_mismatch" });
  });

  it("rechaza otro typ (un manifiesto no es un documento de páginas)", async () => {
    const keys = await ed25519();
    const manifestJws = await signSiteJws({ iss: DID, iat: 1, entries: [entry("x")] } as never, { keyId: KID, privateKeyJwk: keys.privateJwk }, "apw-manifest+jws");
    const res = await verifyPagesDocument(manifestJws, { publicKeyJwk: keys.publicJwk, kid: KID, did: DID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid_typ");
  });

  it("rechaza entradas de más y entradas mal formadas", async () => {
    expect(parsePagesEntries([{ kind: "nope", slug: "a", title: "a", url: "https://x/", publishedAt: "2026-01-01T00:00:00Z" }])).toBe("invalid_entries");
    const many = Array.from({ length: MAX_PAGES_ENTRIES + 1 }, (_, i) => entry(`s${i}`));
    expect(parsePagesEntries(many)).toBe("too_many_entries");
    expect(parsePagesEntries([entry("a")], 0)).toBe("too_many_entries");

    const keys = await ed25519();
    const jws = await signPagesDocument({ did: DID, iat: 1, entries: [entry("a"), entry("b"), entry("c")] }, { keyId: KID, privateKeyJwk: keys.privateJwk });
    const res = await verifyPagesDocument(jws, { publicKeyJwk: keys.publicJwk, kid: KID, did: DID }, 2);
    expect(res).toEqual({ ok: false, reason: "too_many_entries" });
  });
});

describe("safe-fetch: guardas", () => {
  it("isPrivateIp cubre los rangos peligrosos", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.5", "192.168.1.1", "100.64.1.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("assertSafeUrl exige https, bloquea localhost/privados y consulta lookup", async () => {
    await expect(assertSafeUrl(new URL("http://example.com/"))).rejects.toThrow("invalid_url");
    await expect(assertSafeUrl(new URL("https://localhost/"))).rejects.toThrow("blocked_host");
    await expect(assertSafeUrl(new URL("https://127.0.0.1/"))).rejects.toThrow("blocked_host");
    await expect(assertSafeUrl(new URL("https://example.com/"), async () => ["10.0.0.5"])).rejects.toThrow("blocked_host");
    await expect(assertSafeUrl(new URL("https://example.com/"), async () => ["93.184.216.34"])).resolves.toBeUndefined();
  });

  it("bloquea un redirect a un host privado (validación por hop)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } });
    }) as unknown as typeof fetch;
    const safeFetch = createSafeFetcher({ fetch: fetchImpl });
    const res = await safeFetch("https://example.com/.well-known/apw-pages.jws");
    expect(res.ok).toBe(false);
    expect(["blocked_host", "invalid_url"]).toContain(res.error);
    expect(calls).toBe(1); // siguió validando el hop, no lo siguió
  });

  it("sigue un redirect válido dentro del límite", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      if (calls === 1) return new Response(null, { status: 308, headers: { location: "https://cdn.example.com/.well-known/apw-pages.jws" } });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    const safeFetch = createSafeFetcher({ fetch: fetchImpl });
    const res = await safeFetch("https://example.com/.well-known/apw-pages.jws");
    expect(res.ok).toBe(true);
    expect(res.finalUrl).toBe("https://cdn.example.com/.well-known/apw-pages.jws");
    expect(calls).toBe(2);
  });

  it("corta por streaming al pasar el cap de bytes, sin bufferear todo", async () => {
    const big = "x".repeat(100_000);
    const fetchImpl = (async () => new Response(big, { status: 200 })) as unknown as typeof fetch;
    const safeFetch = createSafeFetcher({ fetch: fetchImpl });
    const res = await safeFetch("https://example.com/.well-known/apw-pages.jws", { maxBytes: 1000 });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("too_large");
  });

  it("reporta timeout", async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    const safeFetch = createSafeFetcher({ fetch: fetchImpl });
    const res = await safeFetch("https://example.com/x", { timeoutMs: 5 });
    expect(res).toEqual({ ok: false, error: "timeout" });
  });
});

describe("render remoto: sin esquemas peligrosos, con cap", () => {
  it("isSafeRemoteUrl solo acepta http/https", () => {
    expect(isSafeRemoteUrl("https://example.com/x")).toBe(true);
    expect(isSafeRemoteUrl("http://example.com/x")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "blob:https://x/y", "vbscript:x", "/relative", ""]) {
      expect(isSafeRemoteUrl(bad), bad).toBe(false);
    }
  });

  it("capItems y toPlainText acotan", () => {
    expect(capItems([1, 2, 3], 2)).toEqual([1, 2]);
    expect(capItems([1, 2, 3], 0)).toEqual([]);
    expect(toPlainText("<b>x</b>")).toBe("<b>x</b>"); // texto plano: quien renderiza escapa, no acá
    expect(toPlainText("y".repeat(600)).length).toBe(500);
  });
});

describe("agregador de pares: caché, single-flight y stale-while-error", () => {
  it("cachea por TTL y sirve de caché en la segunda llamada", async () => {
    let loads = 0;
    let t = 1000;
    const agg = createPeerAggregator({
      loadPeer: async (d) => {
        loads++;
        return { ok: true, entries: [entry(`${d}-1`)] };
      },
      cache: new InMemoryPeerCache(),
      ttlMs: 1000,
      now: () => t,
    });
    await agg.aggregate(["a.example"]);
    await agg.aggregate(["a.example"]);
    expect(loads).toBe(1);
    t = 5000; // expira
    await agg.aggregate(["a.example"]);
    expect(loads).toBe(2);
  });

  it("single-flight: llamadas concurrentes comparten una sola carga", async () => {
    let loads = 0;
    let resolve!: (v: { ok: true; entries: PagesDocumentEntry[] }) => void;
    const gate = new Promise<{ ok: true; entries: PagesDocumentEntry[] }>((r) => (resolve = r));
    const agg = createPeerAggregator({
      loadPeer: async () => {
        loads++;
        return gate;
      },
      cache: new InMemoryPeerCache(),
    });
    const p1 = agg.aggregate(["a.example"]);
    const p2 = agg.aggregate(["a.example"]);
    resolve({ ok: true, entries: [entry("x")] });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(loads).toBe(1);
    expect(r1.pages.map((p) => p.slug)).toEqual(["x"]);
    expect(r2.pages.map((p) => p.slug)).toEqual(["x"]);
  });

  it("stale-while-error: si el par falla y hay caché, sirve lo viejo marcado", async () => {
    const cache = new InMemoryPeerCache();
    cache.set("a.example", { value: [{ ...entry("old"), source: "a.example" }], storedAt: 0 });
    const agg = createPeerAggregator({
      loadPeer: async () => ({ ok: false, reason: "fetch_failed" }),
      cache,
      ttlMs: 1,
      now: () => 999999, // caché vencida
    });
    const { pages, reports } = await agg.aggregate(["a.example"]);
    expect(pages.map((p) => p.slug)).toEqual(["old"]);
    expect(reports[0]).toMatchObject({ ok: false, stale: true, fromCache: true });
  });

  it("respeta el cap por par y el total, y deduplica pares", async () => {
    const agg = createPeerAggregator({
      loadPeer: async () => ({ ok: true, entries: Array.from({ length: 10 }, (_, i) => entry(`s${i}`)) }),
      perPeerItemCap: 3,
      totalItemCap: 5,
      cache: new InMemoryPeerCache(),
    });
    const { pages } = await agg.aggregate(["a.example", "a.example", "b.example"]);
    expect(pages.length).toBe(5); // 2 pares * 3 = 6, recortado a 5
  });
});
