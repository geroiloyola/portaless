// Public read-only node ranking endpoint: GET /explore.json
// Aggregates verified signals from community_attestations and witness_observations
// in D1 (Cloudflare) or SQLite (self-hosted Node), excluding draft/private pages.
// Always returns 200 OK with hasSignals: false when empty or unconfigured.

import { openSqlite } from "@portaless/sqlite-driver";
import { isPubliclyPublishable } from "@portaless/deploy-engine/draft-filter";
import { ROUTES } from "../src/lib/routes.ts";
import { computeExploreRanking } from "./_shared/explore-ranking.js";
import { withSecurityHeaders } from "./_shared/security-headers.js";

const MAX_SIGNAL_ROWS = 2000;
const MAX_PAGE_ROWS = 500;

async function queryD1(db, sql, params = []) {
  try {
    const res = await db.prepare(sql).bind(...params).all();
    return Array.isArray(res?.results) ? res.results : [];
  } catch {
    return [];
  }
}

function querySqlite(db, sql, params = []) {
  try {
    const rows = db.prepare(sql).all(...params);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function collectExcludedKeys(pageRows) {
  const excluded = new Set();
  for (const row of pageRows) {
    if (!row || typeof row.slug !== "string" || !row.slug.trim()) continue;
    let layout = null;
    try {
      layout = typeof row.layout_json === "string" ? JSON.parse(row.layout_json) : row.layout_json;
    } catch {
      layout = null;
    }
    const slug = row.slug.trim();
    if (!layout || !isPubliclyPublishable({ ...layout, slug: layout.slug || slug })) {
      excluded.add(`/${ROUTES.PAGES}/${slug}/`);
      excluded.add(`/${ROUTES.PAGES_LEGACY}/${slug}/`);
      excluded.add(`/${slug}/`);
    }
  }
  return excluded;
}

export async function buildExploreRankingPayload(env = {}, nowMs = Date.now()) {
  let attestations = [];
  let observations = [];
  let pageRows = [];

  if (env?.DB) {
    [attestations, observations, pageRows] = await Promise.all([
      queryD1(
        env.DB,
        "SELECT iss, site_id, sub, category, val, iat, received_at FROM community_attestations ORDER BY iat DESC LIMIT ?",
        [MAX_SIGNAL_ROWS]
      ),
      queryD1(
        env.DB,
        "SELECT site_id, subject_did, witness_did, observed_seq, anchored_ts, updated_at FROM witness_observations ORDER BY anchored_ts DESC LIMIT ?",
        [MAX_SIGNAL_ROWS]
      ),
      queryD1(env.DB, "SELECT slug, layout_json FROM pages LIMIT ?", [MAX_PAGE_ROWS]),
    ]);
  } else if (env?.PORTALESS_SQLITE_PATH) {
    let db = null;
    try {
      db = await openSqlite(env.PORTALESS_SQLITE_PATH);
      attestations = querySqlite(
        db,
        "SELECT iss, site_id, sub, category, val, iat, received_at FROM community_attestations ORDER BY iat DESC LIMIT ?",
        [MAX_SIGNAL_ROWS]
      );
      observations = querySqlite(
        db,
        "SELECT site_id, subject_did, witness_did, observed_seq, anchored_ts, updated_at FROM witness_observations ORDER BY anchored_ts DESC LIMIT ?",
        [MAX_SIGNAL_ROWS]
      );
      pageRows = querySqlite(db, "SELECT slug, layout_json FROM pages LIMIT ?", [MAX_PAGE_ROWS]);
    } catch {
      attestations = [];
      observations = [];
      pageRows = [];
    } finally {
      try {
        db?.close?.();
      } catch {
        // ignore close errors on read-only path
      }
    }
  }

  const excludedKeys = collectExcludedKeys(pageRows);
  return computeExploreRanking({
    attestations,
    observations,
    excludedKeys,
    nowMs,
  });
}

export async function onRequestGet(context) {
  const payload = await buildExploreRankingPayload(context?.env || {});
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
  return withSecurityHeaders(response);
}
