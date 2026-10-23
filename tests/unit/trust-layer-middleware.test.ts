// functions/_middleware.js -- el middleware global del Trust Layer, que
// corre en CADA request con ENABLE_TRUST_LAYER=true. Estaba a 12% de
// cobertura: solo lo ejercitaban las rutas unsigned/publicas. Este archivo
// cubre las ramas reales de decision: desactivado, rutas publicas, UA
// automatizada sin firma (403), firma invalida (401 + ledger violation),
// y firma valida contra las tres politicas de ai_input (allow -> next,
// block -> 403, charge sin activacion -> 402). Firmas Ed25519 reales
// (mismo harness que webbotauth-shared-nonces.test.ts); solo se mockea el
// directorio de claves del operador. APW_AUTO_EMIT_CONDUCT=false para que
// la emision automatica de reader_conduct no robe el fetch del mock en
// background.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onRequest } from "../../functions/_middleware";
import {
  __resetDirectoryCacheForTests,
  __resetNonceStoreForTests,
  __fetchOperatorKeyDirectoryForTests,
  DIRECTORY_FETCH_COLD_MAX,
} from "../../packages/trust-layer/src/webbotauth/verify";
import { buildSignatureBase, parseSignatureInput } from "../../packages/trust-layer/src/webbotauth/rfc9421";
import { __resetNonceStoreFactoryForTests } from "../../packages/trust-layer/src/webbotauth/nonce-store";
import { createUsageLedgerStore } from "../../packages/trust-layer/src/ledger/store-factory";
import { readUnsignedBotRejections, __flushUnsignedBotMetricsForTests } from "../../packages/trust-layer/src/ledger/unsigned-bot-metrics";

const OPERATOR_ORIGIN = "https://agent-operator.example.com";
const KEY_ID = "mw-key-1";
const DEFAULT_COMPONENTS = '"@method" "@authority" "@path" "signature-agent"';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function generateKeyPair() {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  return { privateKey: keyPair.privateKey, publicKeyX: bytesToBase64Url(rawPublic) };
}

async function buildSignedRequest(
  privateKey: CryptoKey,
  opts: { nonce: string; url?: string; created?: number; expires?: number }
): Promise<Request> {
  const url = opts.url ?? "https://mysite.example/pages/foo";
  const created = opts.created ?? Math.floor(Date.now() / 1000);
  const expires = opts.expires ?? created + 300;
  const agentHeader = `"${OPERATOR_ORIGIN}"`;
  const paramsLine =
    `(${DEFAULT_COMPONENTS})` +
    `;created=${created};expires=${expires}` +
    `;keyid="${KEY_ID}";alg="ed25519"` +
    `;nonce="${opts.nonce}"` +
    `;tag="web-bot-auth"`;
  const unsigned = new Request(url, {
    method: "GET",
    headers: { "Signature-Agent": agentHeader, "Signature-Input": `sig1=${paramsLine}` },
  });
  const parsed = parseSignatureInput(`sig1=${paramsLine}`);
  if (!parsed) throw new Error("test helper: Signature-Input no parseo");
  const signatureBase = buildSignatureBase(unsigned, parsed);
  if (!signatureBase) throw new Error("test helper: falta header firmado");
  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(signatureBase))
  );
  return new Request(url, {
    method: "GET",
    headers: {
      "Signature-Agent": agentHeader,
      "Signature-Input": `sig1=${paramsLine}`,
      Signature: `sig1=:${bytesToBase64(signatureBytes)}:`,
    },
  });
}

function policyManifest(aiInput: { access: string; price_usd?: number; unit?: string }) {
  return {
    version: "0.1",
    site: "mysite.example",
    policies: {
      search: { access: "allow", price_usd: 0 },
      ai_input: aiInput,
      ai_train: { access: "block" },
    },
    free_for: [],
    contact: "",
  };
}

function assetsServing(manifest: unknown) {
  return {
    fetch: async () =>
      new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } }),
  };
}

function makeContext(request: Request, env: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  const next = vi.fn(async () => new Response("PASO-AL-SIGUIENTE", { status: 200 }));
  return { context: { request, env, data, next, params: {} } as any, next, data };
}

function mockDirectory(publicKeyX: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ keys: [{ kid: KEY_ID, kty: "OKP", crv: "Ed25519", x: publicKeyX, alg: "ed25519" }] }),
        { status: 200, headers: { "content-type": "application/http-message-signatures-directory+json" } }
      )
    )
  );
}

describe("functions/_middleware.js (Trust Layer)", () => {
  let dir: string;
  let env: Record<string, unknown>;

  beforeEach(() => {
    __resetDirectoryCacheForTests();
    __resetNonceStoreForTests();
    // El factory cachea UN sqlite store a nivel de modulo (cachedSqliteStore);
    // sin este reset todos los tests despues del primero reusarian la
    // conexion al archivo borrado por el afterEach.
    __resetNonceStoreFactoryForTests();
    dir = mkdtempSync(join(tmpdir(), "pless-mw-"));
    env = {
      PORTALESS_SQLITE_PATH: join(dir, "portaless-test.db"),
      ENABLE_TRUST_LAYER: "true",
      APW_AUTO_EMIT_CONDUCT: "false",
    };
  });

  afterEach(() => {
    __resetNonceStoreFactoryForTests();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a directory redirect 401 without Retry-After or a policy-violation entry", async () => {
    const { privateKey } = await generateKeyPair();
    const network = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }));
    vi.stubGlobal("fetch", network);
    const { context, next } = makeContext(await buildSignedRequest(privateKey, { nonce: "redirect-disabled" }), {
      ...env, __PORTALESS_RUNTIME: "node", PORTALESS_RESOLUTION_BUDGET_ENABLED: "true",
      PORTALESS_RESOLUTION_BUDGET_SECRET: "synthetic-only-test-secret-not-a-deployment",
    });
    const res = await onRequest(context);
    expect(res!.status).toBe(401);
    expect(await res!.json()).toEqual({ error: "directory_redirect_disabled", reason: "directory_redirect_disabled" });
    expect(res!.headers.has("retry-after")).toBe(false);
    expect(network).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    const ledger = await createUsageLedgerStore(env);
    expect((await ledger.get(new Date().toISOString().slice(0, 7)))?.agents ?? []).toEqual([]);
  });

  it("sin ENABLE_TRUST_LAYER=true pasa al siguiente sin verificar nada", async () => {
    const request = new Request("https://mysite.example/pages/foo", {
      headers: { "user-agent": "curl/8.0" },
    });
    const { context, next } = makeContext(request, { ...env, ENABLE_TRUST_LAYER: "false" });
    const res = await onRequest(context);
    expect(await res!.text()).toBe("PASO-AL-SIGUIENTE");
    expect(next).toHaveBeenCalled();
  });

  it("las rutas publicas de descubrimiento pasan sin firma", async () => {
    for (const path of ["/robots.txt", "/llms.txt", "/sitemap.xml"]) {
      const request = new Request(`https://mysite.example${path}`, {
        headers: { "user-agent": "Googlebot/2.1" },
      });
      const { context, next } = makeContext(request, env);
      const res = await onRequest(context);
      expect(await res!.text()).toBe("PASO-AL-SIGUIENTE");
      expect(next).toHaveBeenCalled();
    }
  });

  it("una UA de navegador sin firma pasa al siguiente", async () => {
    const request = new Request("https://mysite.example/pages/foo", {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" },
    });
    const { context, next } = makeContext(request, env);
    const res = await onRequest(context);
    expect(await res!.text()).toBe("PASO-AL-SIGUIENTE");
  });

  it("UA automatizada sin firma: 403 unsigned_automated_request con policy_url", async () => {
    const request = new Request("https://mysite.example/pages/foo", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.0)" },
    });
    const { context, next } = makeContext(request, env);
    const res = await onRequest(context);
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe("unsigned_automated_request");
    expect(body.policy_url).toContain("/.well-known/portaless-content-policy.json");
    expect(next).not.toHaveBeenCalled();
  });

  it("B3: un Googlebot sin firma recibe 403 aunque ai_input=allow", async () => {
    const request = new Request("https://mysite.example/pages/foo", {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
    });
    const envWithPolicy = { ...env, ASSETS: assetsServing(policyManifest({ access: "allow", price_usd: 0 })) };
    const { context, next } = makeContext(request, envWithPolicy);
    const res = await onRequest(context);

    expect(res!.status).toBe(403);
    expect((await res!.json()).error).toBe("unsigned_automated_request");
    expect(next).not.toHaveBeenCalled();
    await __flushUnsignedBotMetricsForTests(env);
    expect((await readUnsignedBotRejections(env)).periods[0]).toMatchObject({ googlebot: 1, bingbot: 0, other: 0, unknown: 0 });
  });

  it("R4: timeout and cached failure are 503 + Retry-After, with no violation or ledger write", async () => {
    const { privateKey } = await generateKeyPair();
    const directoryFetcher = vi.fn(async () => ({ ok: false, error: "timeout" }));
    for (const expectedReason of ["directory_unavailable", "directory_failure_cached"]) {
      const request = await buildSignedRequest(privateKey, { nonce: expectedReason });
      const { context, next } = makeContext(request, { ...env, __PORTALESS_DIRECTORY_FETCHER: directoryFetcher });
      const res = await onRequest(context);
      expect(res.status).toBe(503);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await res.json()).toEqual({ error: "verification_unavailable", reason: expectedReason });
      expect(next).not.toHaveBeenCalled();
    }
    expect(directoryFetcher).toHaveBeenCalledTimes(1);
    const ledger = await createUsageLedgerStore(env as any);
    expect(await ledger.get(new Date().toISOString().slice(0, 7))).toBeNull();
  });

  it("R4: cold-lane exhaustion is 503, not an invalid-signature violation", async () => {
    const releases: Array<(value: any) => void> = [];
    const pending = Array.from({ length: DIRECTORY_FETCH_COLD_MAX }, (_, i) =>
      __fetchOperatorKeyDirectoryForTests(`https://slow-${i}.example`, (() => new Promise((done) => releases.push(done))) as never));
    await Promise.resolve();
    try {
      const { privateKey } = await generateKeyPair();
      const request = await buildSignedRequest(privateKey, { nonce: "busy" });
      const res = await onRequest(makeContext(request, env).context);
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("1");
      expect(await res.json()).toEqual({ error: "verification_unavailable", reason: "directory_busy" });
      expect(await (await createUsageLedgerStore(env as any)).get(new Date().toISOString().slice(0, 7))).toBeNull();
    } finally {
      for (const done of releases) done({ ok: false, error: "timeout" });
      await Promise.all(pending);
    }
  });

  it("R4: expired signatures are distinct 401 credentials, with no misconduct ledger entry", async () => {
    const { privateKey } = await generateKeyPair();
    const now = Math.floor(Date.now() / 1000);
    const request = await buildSignedRequest(privateKey, { nonce: "expired", created: now - 60, expires: now - 1 });
    const res = await onRequest(makeContext(request, env).context);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signature_expired", reason: "signature_expired" });
    expect(await (await createUsageLedgerStore(env as any)).get(new Date().toISOString().slice(0, 7))).toBeNull();
  });

  it("R4: a cryptographically invalid signature remains 401 verification_failed", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    mockDirectory(publicKeyX);
    const request = await buildSignedRequest(privateKey, { nonce: "bad-crypto" });
    request.headers.set("Signature", `sig1=:${bytesToBase64(new Uint8Array(64))}:`);
    const res = await onRequest(makeContext(request, env).context);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "verification_failed", reason: "signature_verification_failed" });
    const period = await (await createUsageLedgerStore(env as any)).get(new Date().toISOString().slice(0, 7));
    expect(period?.agents.find((a) => a.operatorKeyId === "unverified")?.policyViolationsDetected).toBe(1);
  });

  it("firma invalida: 401 verification_failed y el ledger registra la violacion", async () => {
    const request = new Request("https://mysite.example/pages/foo", {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.0)",
        "Signature-Agent": `"${OPERATOR_ORIGIN}"`,
        "Signature-Input": 'sig1=("@method" "@authority" "@path");created=1;expires=9999999999;keyid="mw-key-1";nonce="basura"',
        Signature: "sig1=:bm90LXVuLXNpZ25hdHVyZQ==:",
      },
    });
    const { context, next } = makeContext(request, env);
    const res = await onRequest(context);
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body.error).toBe("verification_failed");
    expect(body.reason).toBeTruthy();
    expect(next).not.toHaveBeenCalled();
    // Quedo plasmado en el ledger con el operador "unverified".
    const ledger = await createUsageLedgerStore(env as any);
    const period = new Date().toISOString().slice(0, 7);
    const entry = await ledger.get(period);
    const unverified = entry?.agents.find((a) => a.operatorKeyId === "unverified");
    expect(unverified?.policyViolationsDetected).toBeGreaterThan(0);
  });

  it("firma valida con la politica por defecto (ai_input=charge): 402 settlement:not_available", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            keys: [{ kid: KEY_ID, kty: "OKP", crv: "Ed25519", x: publicKeyX, alg: "ed25519" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/http-message-signatures-directory+json" },
          }
        )
      )
    );
    const request = await buildSignedRequest(privateKey, { nonce: "charge-1" });
    const { context, next } = makeContext(request, env);
    const res = await onRequest(context);
    expect(res!.status).toBe(402);
    const body = await res!.json();
    expect(body.error).toBe("payment_required");
    expect(body.settlement).toBe("not_available");
    expect(body.price_usd).toBe(0.002);
    expect(next).not.toHaveBeenCalled();
  });

  it("firma valida con politica ai_input=block: 403 ai_input_blocked_by_policy", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            keys: [{ kid: KEY_ID, kty: "OKP", crv: "Ed25519", x: publicKeyX, alg: "ed25519" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/http-message-signatures-directory+json" },
          }
        )
      )
    );
    const envWithPolicy = { ...env, ASSETS: assetsServing(policyManifest({ access: "block" })) };
    const request = await buildSignedRequest(privateKey, { nonce: "block-1" });
    const { context, next } = makeContext(request, envWithPolicy);
    const res = await onRequest(context);
    expect(res!.status).toBe(403);
    expect((await res!.json()).error).toBe("ai_input_blocked_by_policy");
    expect(next).not.toHaveBeenCalled();
  });

  it("firma valida con politica ai_input=allow: pasa al siguiente con webBotAuth en data", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            keys: [{ kid: KEY_ID, kty: "OKP", crv: "Ed25519", x: publicKeyX, alg: "ed25519" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/http-message-signatures-directory+json" },
          }
        )
      )
    );
    const envWithPolicy = { ...env, ASSETS: assetsServing(policyManifest({ access: "allow", price_usd: 0 })) };
    const request = await buildSignedRequest(privateKey, { nonce: "allow-1" });
    const { context, next, data } = makeContext(request, envWithPolicy);
    const res = await onRequest(context);
    expect(await res!.text()).toBe("PASO-AL-SIGUIENTE");
    expect(next).toHaveBeenCalled();
    // B9: el resultado queda en data para que los handlers no re-verifiquen
    // (y no consuman el nonce otra vez).
    expect((data.webBotAuth as any).verified).toBe(true);
  });

  it("una politica incompleta en ASSETS cae a la politica por defecto (charge -> 402)", async () => {
    const { privateKey, publicKeyX } = await generateKeyPair();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            keys: [{ kid: KEY_ID, kty: "OKP", crv: "Ed25519", x: publicKeyX, alg: "ed25519" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/http-message-signatures-directory+json" },
          }
        )
      )
    );
    const envWithPolicy = { ...env, ASSETS: assetsServing({ version: "0.1", site: "x" }) };
    const request = await buildSignedRequest(privateKey, { nonce: "invalid-policy-1" });
    const { context } = makeContext(request, envWithPolicy);
    const res = await onRequest(context);
    expect(res!.status).toBe(402);
  });

  // B3: matriz del comportamiento ACTUAL. El rechazo de bot sin firma ocurre
  // ANTES de cargar la politica, por eso el access de ai_input no lo cambia.
  for (const access of ["allow", "block", "charge"] as const) {
    it(`B3 actual: sin firma + bot-like + ai_input=${access} => 403 antes de la politica`, async () => {
      const request = new Request("https://mysite.example/pages/foo", {
        headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      });
      const envWithPolicy = { ...env, ASSETS: assetsServing(policyManifest({ access, price_usd: 0.002 })) };
      const { context, next } = makeContext(request, envWithPolicy);
      const res = await onRequest(context);
      expect(res!.status).toBe(403);
      expect((await res!.json()).error).toBe("unsigned_automated_request");
      expect(next).not.toHaveBeenCalled();
      const ledger = await createUsageLedgerStore(env as any);
      const period = new Date().toISOString().slice(0, 7);
      expect(await ledger.get(period)).toBeFalsy();
    });
  }

  // Propuesta pendiente del dueno: mover la carga de politica ANTES del
  // rechazo de bots sin firma haria que ai_input=allow los dejara pasar.
  // No implementar hasta confirmacion.
  it.skip("B3 propuesta: sin firma + bot-like + ai_input=allow => next", async () => {
    const request = new Request("https://mysite.example/pages/foo", {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    });
    const envWithPolicy = { ...env, ASSETS: assetsServing(policyManifest({ access: "allow", price_usd: 0 })) };
    const { context, next } = makeContext(request, envWithPolicy);
    const res = await onRequest(context);
    expect(await res!.text()).toBe("PASO-AL-SIGUIENTE");
    expect(next).toHaveBeenCalled();
  });

  for (const access of ["allow", "block", "charge"] as const) {
    it(`B3 actual: firma valida + ai_input=${access} => ${access === "allow" ? "200" : access === "block" ? "403" : "402"}`, async () => {
      const { privateKey, publicKeyX } = await generateKeyPair();
      mockDirectory(publicKeyX);
      const request = await buildSignedRequest(privateKey, { nonce: `matrix-${access}` });
      const envWithPolicy = { ...env, ASSETS: assetsServing(policyManifest({ access, price_usd: 0.002 })) };
      const { context, next } = makeContext(request, envWithPolicy);
      const res = await onRequest(context);
      if (access === "allow") {
        expect(await res!.text()).toBe("PASO-AL-SIGUIENTE");
        expect(next).toHaveBeenCalled();
      } else if (access === "block") {
        expect(res!.status).toBe(403);
        expect((await res!.json()).error).toBe("ai_input_blocked_by_policy");
      } else {
        expect(res!.status).toBe(402);
        expect((await res!.json()).error).toBe("payment_required");
      }
      const ledger = await createUsageLedgerStore(env as any);
      const period = new Date().toISOString().slice(0, 7);
      const entry = await ledger.get(period);
      expect(entry?.agents.some((agent) => agent.operatorKeyId === KEY_ID)).toBe(true);
    });
  }

  it("B3 actual: firma invalida => 401 y ledger 'unverified'", async () => {
    const request = new Request("https://mysite.example/pages/foo", {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
        "Signature-Agent": `"${OPERATOR_ORIGIN}"`,
        "Signature-Input": 'sig1=("@method" "@authority" "@path");created=1;expires=9999999999;keyid="mw-key-1";nonce="basura"',
        Signature: "sig1=:bm90LXVuLXNpZ25hdHVyZQ==:",
      },
    });
    const { context, next } = makeContext(request, env);
    const res = await onRequest(context);
    expect(res!.status).toBe(401);
    expect((await res!.json()).error).toBe("verification_failed");
    expect(next).not.toHaveBeenCalled();
  });
});
