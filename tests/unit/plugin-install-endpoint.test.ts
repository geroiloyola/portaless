// Instalador HTTP de plugins (Fase 11.2): flag off por defecto, step-up,
// manifiesto firmado verificado contra la identidad resuelta, inmutabilidad por
// (publisher, name, version) y reconciliacion (podar removidas, no auto-conceder).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  identity: {} as Record<string, any>,
  password: "correct",
}));

vi.mock("../../packages/apw-resolver/src/index", () => ({
  resolveApwIdentity: async (domain: string) =>
    state.identity[domain] ?? { verified: false, reason: "manifest_without_key", domain, did: `did:apw:${domain}` },
}));

vi.mock("../../packages/auth/src/auth-service", () => ({
  AuthService: class {
    async verifyStepUp(_u: string, c: { password?: string }) {
      return c.password === state.password ? { ok: true } : { ok: false, reason: "invalid_password" };
    }
  },
}));

import { signPluginManifest } from "../../packages/apw-resolver/src/did-apw/plugin-manifest";
import { reconcileGrants } from "../../packages/plugin-sandbox/src/install/reconcile";
import { createPluginArtifactStore } from "../../packages/plugin-sandbox/src/registry/plugin-artifacts";
import { createPluginRegistryStore } from "../../packages/plugin-sandbox/src/registry/store-factory";
import { createPermissionStore } from "../../packages/permissions/src/store-factory";
import * as install from "../../functions/admin/api/plugins/install";
import * as uninstall from "../../functions/admin/api/plugins/uninstall";
import * as runEndpoint from "../../functions/admin/api/plugins/run";

const DOMAIN = "pub.example";
const PUBLISHER = `did:apw:${DOMAIN}`;
const KID = `${PUBLISHER}#key-1`;

const tmp = mkdtempSync(join(tmpdir(), "portaless-install-"));
let seq = 0;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let keys: { privateJwk: JsonWebKey; publicJwk: JsonWebKey };

function env(withFlag: boolean) {
  seq += 1;
  const e: Record<string, unknown> = { PORTALESS_SQLITE_PATH: join(tmp, `install-${seq}.db`) };
  if (withFlag) e.PORTALESS_PLUGIN_INSTALLER = "1";
  return e;
}

function ctx(envv: Record<string, unknown>, body: unknown, user: unknown = { username: "admin", role: "admin" }) {
  return {
    request: { json: async () => body },
    data: user ? { user } : {},
    env: envv,
  } as any;
}

async function signed(manifest: any) {
  return signPluginManifest({ publisher: PUBLISHER, manifest, iat: 1 }, { keyId: KID, privateKeyJwk: keys.privateJwk });
}

beforeEach(async () => {
  state.identity = {};
  state.password = "correct";
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  keys = {
    privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", kp.publicKey),
  };
  state.identity[DOMAIN] = {
    verified: true,
    reason: "ok",
    domain: DOMAIN,
    did: PUBLISHER,
    didDocument: { id: PUBLISHER, verificationMethod: [{ publicKeyJwk: keys.publicJwk }] },
  };
});

const pluginManifest = (version: string, caps: Array<{ id: string; reason: string; allowedHosts?: string[] }>) => ({
  name: "mi-plugin",
  version,
  entry: "index.js",
  runtime: "javascript" as const,
  requestedCapabilities: caps,
});

describe("POST /admin/api/plugins/install", () => {
  it("404 si el flag esta apagado (fail-closed, sin revelar que existe)", async () => {
    const jws = await signed(pluginManifest("1.0.0", [{ id: "content:read", reason: "lee contenido" }]));
    const res = await install.onRequestPost(ctx(env(false), { manifest: jws, code: "x", password: "correct" }));
    expect(res.status).toBe(404);
  });

  it("401 sin sesion, 403 viewer, 401 sin/incorrecto step-up", async () => {
    const jws = await signed(pluginManifest("1.0.0", [{ id: "content:read", reason: "lee contenido" }]));
    const e = env(true);
    expect((await install.onRequestPost(ctx(env(true), { manifest: jws, code: "x" }, null))).status).toBe(401);
    expect((await install.onRequestPost(ctx(env(true), { manifest: jws, code: "x" }, { username: "v", role: "viewer" }))).status).toBe(403);
    expect((await install.onRequestPost(ctx(e, { manifest: jws, code: "x" }))).status).toBe(401);
    expect((await install.onRequestPost(ctx(e, { manifest: jws, code: "x", password: "mala" }))).status).toBe(401);
  });

  it("instala un manifiesto firmado SIN conceder capacidades", async () => {
    const e = env(true);
    const jws = await signed(pluginManifest("1.0.0", [{ id: "content:read", reason: "lee contenido" }]));
    const res = await install.onRequestPost(ctx(e, { manifest: jws, code: "console.log(1)", password: "correct" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.plugin).toMatchObject({ publisher: PUBLISHER, name: "mi-plugin", version: "1.0.0" });
    // No se concede nada: queda a revision.
    expect(body.grants.needsReview).toEqual(["content:read"]);

    const permStore = await createPermissionStore(e);
    const grants = await permStore.getGrantsFor({ type: "plugin", id: "mi-plugin", displayName: "mi-plugin" });
    expect(grants.filter((g) => g.granted)).toHaveLength(0);

    // §14.1: el manifiesto viaja con el artefacto y el registro conserva la version activa.
    const artifacts = await createPluginArtifactStore(e);
    const stored = await artifacts.get(PUBLISHER, "mi-plugin", "1.0.0");
    expect(stored?.meta.manifest).toEqual(pluginManifest("1.0.0", [{ id: "content:read", reason: "lee contenido" }]));
    const reg = await createPluginRegistryStore(e);
    expect((await reg.get("mi-plugin"))?.version).toBe("1.0.0");
  });

  it("400 si la firma no verifica contra la identidad resuelta", async () => {
    const wrong = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const priv = await crypto.subtle.exportKey("jwk", (wrong as CryptoKeyPair).privateKey);
    const jws = await signPluginManifest({ publisher: PUBLISHER, manifest: pluginManifest("1.0.0", [{ id: "content:read", reason: "lee contenido" }]), iat: 1 }, { keyId: KID, privateKeyJwk: priv });
    const res = await install.onRequestPost(ctx(env(true), { manifest: jws, code: "x", password: "correct" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_manifest_signature");
  });

  it("inmutabilidad: misma version con otro hash de codigo o manifiesto -> 409", async () => {
    const e = env(true);
    const jws = await signed(pluginManifest("1.0.0", [{ id: "content:read", reason: "lee contenido" }]));
    expect((await install.onRequestPost(ctx(e, { manifest: jws, code: "v1", password: "correct" }))).status).toBe(200);
    const again = await install.onRequestPost(ctx(e, { manifest: jws, code: "v2-distinto", password: "correct" }));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("immutable_version_conflict");

    const jwsOtherManifest = await signed(pluginManifest("1.0.0", [{ id: "media:read", reason: "otra capacidad" }]));
    const diffManifest = await install.onRequestPost(ctx(e, { manifest: jwsOtherManifest, code: "v1", password: "correct" }));
    expect(diffManifest.status).toBe(409);
    expect((await diffManifest.json()).error).toBe("immutable_version_conflict");
  });

  it("§14.1: ciclo install -> run -> update -> run ejecuta desde el artefacto guardado (sin disco / noFs)", async () => {
    const e = env(true);
    const v1 = await signed(pluginManifest("1.0.0", []));
    expect(
      (await install.onRequestPost(ctx(e, { manifest: v1, code: "export default () => 101;", password: "correct" }))).status
    ).toBe(200);

    const runReq = (plugin: string) =>
      new Request("https://sitio.test/admin/api/plugins/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plugin, payload: { ping: true } }),
      });
    const fakeAdapterRegistry = {
      resolve: async () => ({
        provider: "cloudflare-workers-for-platforms",
        execute: async ({ code, manifest }: { code: string; manifest: { version: string } }) => ({
          success: true,
          output: { version: manifest.version, code },
          durationMs: 1,
          provider: "cloudflare-workers-for-platforms" as const,
        }),
      }),
    };

    const run1 = await runEndpoint.onRequestPost(
      { request: runReq("mi-plugin"), env: e, data: { user: { username: "admin", role: "admin" } } } as never,
      { noFs: true, adapterRegistry: fakeAdapterRegistry as never }
    );
    expect(run1.status).toBe(200);
    expect(await run1.json()).toMatchObject({
      success: true,
      output: { version: "1.0.0", code: "export default () => 101;" },
    });

    // Actualizar a 1.1.0 cambia la version activa en el registro y run ejecuta 1.1.0.
    const v11 = await signed(pluginManifest("1.1.0", []));
    expect(
      (await install.onRequestPost(ctx(e, { manifest: v11, code: "export default () => 202;", password: "correct" }))).status
    ).toBe(200);

    const run2 = await runEndpoint.onRequestPost(
      { request: runReq("mi-plugin"), env: e, data: { user: { username: "admin", role: "admin" } } } as never,
      { noFs: true, adapterRegistry: fakeAdapterRegistry as never }
    );
    expect(run2.status).toBe(200);
    expect(await run2.json()).toMatchObject({
      success: true,
      output: { version: "1.1.0", code: "export default () => 202;" },
    });
  });

  it("al actualizar, poda las capacidades removidas y no auto-concede las ampliadas", async () => {
    const e = env(true);
    const v1 = await signed(pluginManifest("1.0.0", [{ id: "content:read", reason: "lee contenido" }, { id: "network:fetch", allowedHosts: ["api.example.com"], reason: "consulta la API" }]));
    await install.onRequestPost(ctx(e, { manifest: v1, code: "v1", password: "correct" }));

    // El admin concede lo que el manifiesto pedia.
    const permStore = await createPermissionStore(e);
    const subject = { type: "plugin", id: "mi-plugin", displayName: "mi-plugin" };
    await permStore.setGrant({ subject, capabilityId: "content:read", granted: true, grantedBy: "admin" });
    await permStore.setGrant({ subject, capabilityId: "network:fetch", granted: true, grantedBy: "admin" });

    // v1.1 quita network:fetch y agrega media:read.
    const v11 = await signed(pluginManifest("1.1.0", [{ id: "content:read", reason: "lee contenido" }, { id: "media:read", reason: "lee la biblioteca de medios" }]));
    const res = await install.onRequestPost(ctx(e, { manifest: v11, code: "v11", password: "correct" }));
    const body = await res.json();
    expect(body.grants.pruned).toEqual(["network:fetch"]);
    expect(body.grants.keep).toEqual(["content:read"]);
    expect(body.grants.needsReview).toEqual(["media:read"]);

    const after = await permStore.getGrantsFor(subject);
    expect(after.find((g) => g.capabilityId === "network:fetch")?.granted).toBe(false);
  });
});

describe("POST /admin/api/plugins/uninstall", () => {
  it("borra el artefacto, desactiva el registro y revoca grants", async () => {
    const e = env(true);
    const jws = await signed(pluginManifest("1.0.0", [{ id: "content:read", reason: "lee contenido" }]));
    await install.onRequestPost(ctx(e, { manifest: jws, code: "v1", password: "correct" }));

    const permStore = await createPermissionStore(e);
    await permStore.setGrant({ subject: { type: "plugin", id: "mi-plugin", displayName: "mi-plugin" }, capabilityId: "content:read", granted: true, grantedBy: "admin" });

    const res = await uninstall.onRequestPost(ctx(e, { name: "mi-plugin", version: "1.0.0", password: "correct" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(true);
    expect(body.revokedGrants).toEqual(["content:read"]);
  });

  it("404 con el flag apagado", async () => {
    const res = await uninstall.onRequestPost(ctx(env(false), { name: "mi-plugin", version: "1.0.0", password: "correct" }));
    expect(res.status).toBe(404);
  });
});

// Contrato de reconciliacion a nivel unitario.
describe("reconcileGrants (unitario)", () => {
  const req = (id: string) => ({ id, reason: "razon de prueba" });
  it("poda lo concedido que ya no se pide y marca lo nuevo a revision", () => {
    const r = reconcileGrants([req("a")], [req("b")], ["a"] as never);
    expect(r).toEqual({ keep: [], prune: ["a"], needsReview: ["b"] });
  });
  it("conserva lo que sigue pedido", () => {
    const r = reconcileGrants([req("a")], [req("a")], ["a"] as never);
    expect(r).toEqual({ keep: ["a"], prune: [], needsReview: [] });
  });
});
