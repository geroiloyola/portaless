// Votos: trust/[siteId]/vote.js (publico, community, rate-limit por IP
// hasheada) y admin/plugins/[pluginId]/vote.js (rol admin sobre el
// registro de plugins). Ambos a 0% de cobertura. Los votes de site-trust
// corren contra SqliteSiteTrustScoreStore REAL en un archivo temporal
// (ademas de cubrir el endpoint, cubre isRateLimited/recordCommunityVote
// del backend SQLite). El registro de plugins usa el cache en memoria del
// factory (seedeado con hello-plugin/commerce-plugin). La IP del voto
// publico viene del header CF-Connecting-IP via getClientIp().

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

describe("trust/[siteId]/vote.js (community, publico)", () => {
  it("400: sin siteId, JSON roto, categoria invalida, score fuera de rango o sin voterId", async () => {
    expect((await siteVote.onRequestPost(ctx({ siteId: "" as any, body: {} }))).status).toBe(400);
    expect((await siteVote.onRequestPost(ctx({ rawBody: "{" }))).status).toBe(400);
    const badCategory = await siteVote.onRequestPost(
      ctx({ body: { category: "no-existe", score: 5, voterId: "v1" } })
    );
    expect(badCategory.status).toBe(400);
    for (const score of [0, 6, 3.5]) {
      const res = await siteVote.onRequestPost(
        ctx({ body: { category: "content_accuracy", score, voterId: "v1" } })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_score");
    }
    const noVoter = await siteVote.onRequestPost(ctx({ body: { category: "content_accuracy", score: 4 } }));
    expect(noVoter.status).toBe(400);
  });

  it("400 missing_client_ip si no hay CF-Connecting-IP", async () => {
    const res = await siteVote.onRequestPost(ctx({ body: { category: "content_accuracy", score: 5, voterId: "v1" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_client_ip");
  });

  it("voto valido: ok true y el voto persiste SIN exponer ipHash", async () => {
    const res = await siteVote.onRequestPost(
      ctx({
        ip: "203.0.113.10",
        env: { PORTALESS_SQLITE_PATH: dbPath, IP_HASH_SALT: "salt-test" },
        body: { category: "perceived_trustworthiness", score: 4, comment: "  buena web  ", voterId: "v-uno" },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.vote.siteId).toBe("site-1");
    expect(body.vote.category).toBe("perceived_trustworthiness");
    expect(body.vote.score).toBe(4);
    expect(body.vote.comment).toBe("buena web"); // trim del comentario
    expect(body.vote.ipHash).toBeUndefined(); // la IP cruda/nunca el hash no salen
    expect(JSON.stringify(body)).not.toContain("203.0.113.10");
  });

  it("429: misma IP y categoria en 24h; otra categoria u otra IP si pasan", async () => {
    const env = { PORTALESS_SQLITE_PATH: dbPath, IP_HASH_SALT: "salt-test" };
    const repeat = await siteVote.onRequestPost(
      ctx({ ip: "203.0.113.20", env, body: { category: "spam_or_deceptive", score: 1, voterId: "a" } })
    );
    expect(repeat.status).toBe(200);

    const limited = await siteVote.onRequestPost(
      ctx({ ip: "203.0.113.20", env, body: { category: "spam_or_deceptive", score: 5, voterId: "b" } })
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");

    const otherCategory = await siteVote.onRequestPost(
      ctx({ ip: "203.0.113.20", env, body: { category: "responsiveness", score: 3, voterId: "b" } })
    );
    expect(otherCategory.status).toBe(200);

    const otherIp = await siteVote.onRequestPost(
      ctx({ ip: "203.0.113.99", env, body: { category: "spam_or_deceptive", score: 2, voterId: "c" } })
    );
    expect(otherIp.status).toBe(200);
  });

  it("500 server_misconfigured si falta IP_HASH_SALT (falla cerrada, sin salt de desarrollo)", async () => {
    const res = await siteVote.onRequestPost(
      ctx({
        ip: "198.51.100.7",
        env: { PORTALESS_SQLITE_PATH: dbPath },
        body: { category: "content_accuracy", score: 5, voterId: "dev-salt" },
      })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("server_misconfigured");
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
