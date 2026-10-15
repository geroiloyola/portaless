// Votos: trust/[siteId]/vote.js (RETIRADO en E-13: responde 410) y
// admin/plugins/[pluginId]/vote.js (rol admin sobre el registro de plugins,
// sigue vigente). El endpoint de atestacion comunitaria firmada que reemplaza
// al voto anonimo se prueba en tests/unit/apw-community-attestations.test.ts:
// este archivo solo cubre que la ruta vieja ya no acepta nada.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as siteVote from "../../functions/trust/[siteId]/vote";
import * as pluginVote from "../../functions/admin/plugins/[pluginId]/vote";

const admin = { username: "admin", role: "admin" };
const tmp = mkdtempSync(join(tmpdir(), "portaless-vote-"));
const dbPath = join(tmp, "trust.db");

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function ctx(opts: {
  user?: { username: string; role: string } | null;
  body?: unknown;
  rawBody?: string;
  siteId?: string;
  pluginId?: string;
  ip?: string;
  env?: Record<string, unknown>;
} = {}) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    headers["content-type"] = "application/json";
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.ip) headers["CF-Connecting-IP"] = opts.ip;
  return {
    request: new Request("http://x.test/trust/site/vote", { method: "POST", headers, body }),
    env: opts.env ?? { PORTALESS_SQLITE_PATH: dbPath },
    params: { siteId: opts.siteId ?? "site-1", pluginId: opts.pluginId ?? "hello-plugin" },
    data: opts.user ? { user: opts.user } : {},
    next: async () => new Response("static"),
  } as any;
}

describe("trust/[siteId]/vote.js (retirado por E-13)", () => {
  it("POST responde 410 con el reemplazo indicado", async () => {
    const res = await siteVote.onRequestPost(
      ctx({ body: { category: "content_accuracy", score: 5, voterId: "v1" } })
    );
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("endpoint_retired");
    expect(body.replacement).toBe("/trust/:siteId/community-attestation");
  });

  it("GET responde 410 (el voto anonimo ya no existe)", async () => {
    const res = await siteVote.onRequestGet();
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("endpoint_retired");
  });
});

describe("admin/plugins/[pluginId]/vote.js (rol admin)", () => {
  it("401 sin sesion y 403 como viewer", async () => {
    expect((await pluginVote.onRequestPost(ctx({ user: null, body: { score: 5 } }))).status).toBe(401);
    const res = await pluginVote.onRequestPost(ctx({ user: { username: "v", role: "viewer" }, body: { score: 5 } }));
    expect(res.status).toBe(403);
    expect((await res.json()).message).toContain("viewer");
  });

  it("400 sin pluginId, JSON roto o score invalido; 404 si el plugin no existe", async () => {
    expect((await pluginVote.onRequestPost(ctx({ user: admin, pluginId: "" as any, body: { score: 5 } }))).status).toBe(400);
    expect((await pluginVote.onRequestPost(ctx({ user: admin, rawBody: "{" }))).status).toBe(400);
    const badScore = await pluginVote.onRequestPost(ctx({ user: admin, body: { score: 9 } }));
    expect(badScore.status).toBe(400);
    const missing = await pluginVote.onRequestPost(ctx({ user: admin, pluginId: "no-existe", body: { score: 5 } }));
    expect(missing.status).toBe(404);
  });

  it("voto admin sobre hello-plugin: promedio y votos; repetir voto sobreescribe", async () => {
    const first = await pluginVote.onRequestPost(
      ctx({ user: admin, body: { score: 5, comment: " util " } })
    );
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.ok).toBe(true);
    expect(body.trustScoreVotes).toBe(1);
    expect(body.trustScore).toBe(5);

    const again = await pluginVote.onRequestPost(ctx({ user: admin, body: { score: 3 } }));
    expect(again.status).toBe(200);
    const updated = await again.json();
    expect(updated.trustScoreVotes).toBe(1); // mismo voter: sobreescribe, no suma
    expect(updated.trustScore).toBe(3);
  });
});
