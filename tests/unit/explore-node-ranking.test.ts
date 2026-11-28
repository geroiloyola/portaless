import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSqlite } from "@portaless/sqlite-driver";
import {
  computeExploreRanking,
  normalizeExploreKey,
  wilsonLowerBound,
} from "../../functions/_shared/explore-ranking.js";
import { onRequestGet } from "../../functions/explore.json.js";
import { SECURITY_HEADERS } from "../../functions/_shared/security-headers.js";

const root = join(__dirname, "..", "..");

describe("explore-ranking pure engine", () => {
  it("normalizes routes and URLs consistently", () => {
    expect(normalizeExploreKey("/pages/about")).toBe("/pages/about/");
    expect(normalizeExploreKey("/pages/about/")).toBe("/pages/about/");
    expect(normalizeExploreKey("pages/about")).toBe("/pages/about/");
    expect(normalizeExploreKey("https://example.test/blog/hello")).toBe("/blog/hello/");
    expect(normalizeExploreKey("/")).toBe("/");
    expect(normalizeExploreKey("did:apw:Example.COM")).toBe("did:apw:example.com");
    expect(normalizeExploreKey("")).toBeNull();
  });

  it("computes Wilson score lower bound so 1/1 ranks below 20/21", () => {
    const oneOfOne = wilsonLowerBound(1, 1);
    const twentyOfTwentyOne = wilsonLowerBound(20, 21);
    const fiftyOfFifty = wilsonLowerBound(50, 50);

    expect(oneOfOne).toBeGreaterThan(0.15);
    expect(oneOfOne).toBeLessThan(0.3);
    expect(twentyOfTwentyOne).toBeGreaterThan(0.7);
    expect(oneOfOne).toBeLessThan(twentyOfTwentyOne);
    expect(twentyOfTwentyOne).toBeLessThan(fiftyOfFifty);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it("computes deterministic top, confidence, and history scores", () => {
    const nowMs = Date.UTC(2026, 10, 28, 12, 0, 0);
    const nowSec = Math.floor(nowMs / 1000);

    // Item A: 1 positive attestation (1/1)
    const attestations = [
      {
        iss: "did:apw:alice",
        site_id: "default",
        sub: "/pages/one-hit/",
        category: "content_accuracy",
        val: 5,
        iat: nowSec - 3600,
      },
    ];

    // Item B: 20 positive + 1 negative attestation across 5 distinct days
    for (let i = 0; i < 20; i++) {
      attestations.push({
        iss: `did:apw:user-${i % 4}`,
        site_id: "default",
        sub: "/pages/consistent/",
        category: "perceived_trustworthiness",
        val: 5,
        iat: nowSec - (i % 5) * 86_400,
      });
    }
    attestations.push({
      iss: "did:apw:critic",
      site_id: "default",
      sub: "/pages/consistent/",
      category: "spam_or_deceptive",
      val: 5, // spam report -> negative signal
      iat: nowSec - 1000,
    });

    const observations = [
      {
        site_id: "default",
        subject_did: "/pages/consistent/",
        witness_did: "did:apw:w1",
        observed_seq: 1,
        anchored_ts: new Date(nowMs - 10 * 86_400_000).toISOString(),
      },
      {
        site_id: "default",
        subject_did: "/pages/consistent/",
        witness_did: "did:apw:w2",
        observed_seq: 2,
        anchored_ts: new Date(nowMs - 2 * 86_400_000).toISOString(),
      },
    ];

    const result = computeExploreRanking({ attestations, observations, nowMs, windowDays: 30 });
    expect(result.source).toBe("node");
    expect(result.hasSignals).toBe(true);
    expect(Object.keys(result.items)).toEqual(["/pages/consistent/", "/pages/one-hit/"]);

    const consistent = result.items["/pages/consistent/"];
    const oneHit = result.items["/pages/one-hit/"];

    expect(consistent.top).toBeGreaterThan(oneHit.top);
    expect(consistent.confidence).toBeGreaterThan(oneHit.confidence);
    expect(consistent.history).toBeGreaterThan(oneHit.history);
    expect(consistent.signals).toBe(23);
    expect(oneHit.signals).toBe(1);
  });

  it("returns hasSignals: false when no signals exist", () => {
    const result = computeExploreRanking({ attestations: [], observations: [] });
    expect(result.source).toBe("node");
    expect(result.hasSignals).toBe(false);
    expect(result.items).toEqual({});
  });
});

describe("GET /explore.json handler", () => {
  function createMockD1(tables: {
    attestations?: unknown[];
    observations?: unknown[];
    pages?: unknown[];
  }) {
    return {
      prepare(sql: string) {
        return {
          bind(..._params: unknown[]) {
            return {
              async all() {
                if (sql.includes("FROM community_attestations")) {
                  return { results: tables.attestations ?? [] };
                }
                if (sql.includes("FROM witness_observations")) {
                  return { results: tables.observations ?? [] };
                }
                if (sql.includes("FROM pages")) {
                  return { results: tables.pages ?? [] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    };
  }

  it("returns 200 OK with hasSignals: false when DB is empty or unconfigured", async () => {
    const resUnconfigured = await onRequestGet({ env: {} });
    expect(resUnconfigured.status).toBe(200);
    expect(resUnconfigured.headers.get("cache-control")).toBe("public, max-age=60");
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      expect(resUnconfigured.headers.get(k)).toBe(v);
    }
    const bodyUnconfigured = await resUnconfigured.json();
    expect(bodyUnconfigured.source).toBe("node");
    expect(bodyUnconfigured.hasSignals).toBe(false);
    expect(bodyUnconfigured.items).toEqual({});

    const resEmpty = await onRequestGet({ env: { DB: createMockD1({}) } });
    expect(resEmpty.status).toBe(200);
    const bodyEmpty = await resEmpty.json();
    expect(bodyEmpty.hasSignals).toBe(false);
    expect(bodyEmpty.items).toEqual({});
  });

  it("excludes draft and private pages and never leaks PII", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const db = createMockD1({
      attestations: [
        {
          iss: "did:apw:secret-issuer-should-not-leak",
          site_id: "default",
          sub: "/pages/public-guide/",
          category: "content_accuracy",
          val: 5,
          iat: nowSec - 60,
        },
        {
          iss: "did:apw:secret-issuer-should-not-leak",
          site_id: "default",
          sub: "/pages/secret-draft/",
          category: "content_accuracy",
          val: 5,
          iat: nowSec - 60,
        },
        {
          iss: "did:apw:secret-issuer-should-not-leak",
          site_id: "default",
          sub: "/pages/private-notes/",
          category: "content_accuracy",
          val: 5,
          iat: nowSec - 60,
        },
      ],
      observations: [],
      pages: [
        { slug: "public-guide", layout_json: JSON.stringify({ status: "published" }) },
        { slug: "secret-draft", layout_json: JSON.stringify({ status: "draft" }) },
        { slug: "private-notes", layout_json: JSON.stringify({ status: "private" }) },
      ],
    });

    const res = await onRequestGet({ env: { DB: db } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("secret-issuer-should-not-leak");
    expect(text).not.toContain("secret-draft");
    expect(text).not.toContain("private-notes");

    const data = JSON.parse(text);
    expect(data.hasSignals).toBe(true);
    expect(Object.keys(data.items)).toEqual(["/pages/public-guide/"]);
    expect(data.items["/pages/public-guide/"].signals).toBe(1);
  });

  it("supports SQLite self-host runtime with full parity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portaless-explore-"));
    const dbPath = join(dir, "test.sqlite");
    try {
      const db = await openSqlite(dbPath);
      db.exec(`
        CREATE TABLE community_attestations (
          iss TEXT NOT NULL, jti TEXT NOT NULL, site_id TEXT NOT NULL,
          sub TEXT NOT NULL, category TEXT NOT NULL, val INTEGER NOT NULL,
          iat INTEGER NOT NULL, jws TEXT NOT NULL, emitter_first_seen_iat INTEGER,
          received_at TEXT NOT NULL
        );
        CREATE TABLE witness_observations (
          site_id TEXT NOT NULL, subject_did TEXT NOT NULL, witness_did TEXT NOT NULL,
          observed_seq INTEGER NOT NULL, observed_head TEXT, anchored_ts TEXT NOT NULL,
          statement_jti TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE pages (
          slug TEXT PRIMARY KEY, layout_json TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      const nowSec = Math.floor(Date.now() / 1000);
      db.prepare(
        "INSERT INTO community_attestations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("did:apw:a1", "jti-1", "default", "/blog/hello/", "content_accuracy", 5, nowSec, "jws", null, new Date().toISOString());
      db.prepare(
        "INSERT INTO witness_observations VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run("default", "/blog/hello/", "did:apw:w1", 1, "head1", new Date().toISOString(), "wjti-1", new Date().toISOString());
      db.prepare(
        "INSERT INTO pages VALUES (?, ?, ?)"
      ).run("hidden-draft", JSON.stringify({ status: "draft" }), new Date().toISOString());
      db.close();

      const res = await onRequestGet({ env: { PORTALESS_SQLITE_PATH: dbPath } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source).toBe("node");
      expect(body.hasSignals).toBe(true);
      expect(body.items["/blog/hello/"].signals).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ExplorePage.astro progressive integration", () => {
  const exploreSrc = readFileSync(join(root, "src", "components", "ExplorePage.astro"), "utf8");

  it("exposes data-explore-endpoint respecting basePath and data-explore-key on cards", () => {
    expect(exploreSrc).toContain("data-explore-endpoint={exploreEndpoint}");
    expect(exploreSrc).toContain("`${base}explore.json`");
    expect(exploreSrc).toContain("data-explore-key=");
  });

  it("fetches /explore.json progressively and falls back cleanly without inline handlers", () => {
    expect(exploreSrc).toContain("fetch(endpoint");
    expect(exploreSrc).toContain("hydrateNodeScores");
    expect(exploreSrc).toContain('data-explore-source="local"');
    expect(exploreSrc).not.toMatch(/\son[a-z]+\s*=/i);
  });
});
