import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { applySchema } from "../../scripts/setup.mjs";
import { createPageStore } from "../../packages/visual-elements/src/persistence/store-factory";
import { onRequestGet, onRequestHead } from "../../functions/index.js";
import { createSelfHostServer } from "../../server/node-runtime.mjs";
import type { PageLayout } from "../../packages/visual-elements/src/types";

const STATIC_HTML = "<!doctype html><html><head><title>Static Starter Home</title></head><body><h1>STATIC-HOME-FALLBACK</h1></body></html>";

function makeCtx(env: Record<string, unknown>, method: "GET" | "HEAD" = "GET") {
  let nextCalls = 0;
  const context = {
    request: new Request("http://x.test/", { method }),
    env,
    params: {},
    data: {},
    next: async () => {
      nextCalls += 1;
      return new Response(method === "HEAD" ? null : STATIC_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  } as any;
  return { context, nextCalls: () => nextCalls };
}

describe("GET/HEAD / (functions/index.js + Node self-host)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "portaless-home-route-"));
  const dbPath = join(tmp, "portaless.db");
  const staticDir = join(tmp, "dist");
  const env = { PORTALESS_SQLITE_PATH: dbPath, PORTALESS_PUBLIC_URL: "http://x.test" };

  beforeAll(async () => {
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, "index.html"), STATIC_HTML, "utf8");
    await applySchema(dbPath, { quiet: true });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("without a DB configured, GET / delegates cleanly to static index.html via next()", async () => {
    const { context, nextCalls } = makeCtx({});
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("STATIC-HOME-FALLBACK");
  });

  it("without a home row in DB, GET / delegates to static index.html via next()", async () => {
    const { context, nextCalls } = makeCtx(env);
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(1);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("STATIC-HOME-FALLBACK");
  });

  it("with home in draft status, GET / falls back to static index.html and never leaks draft content", async () => {
    const store = await createPageStore(env);
    await store.save({
      version: "0.1",
      slug: "home",
      title: "DRAFT-HOME-TITLE",
      status: "draft",
      root: [{ id: "h1", type: "Paragraph", props: { text: "SECRET-DRAFT-HOME-BODY" } }],
    } as unknown as PageLayout);

    const { context, nextCalls } = makeCtx(env);
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(1);
    const html = await res.text();
    expect(html).toContain("STATIC-HOME-FALLBACK");
    expect(html).not.toContain("SECRET-DRAFT-HOME-BODY");
    expect(html).not.toContain("DRAFT-HOME-TITLE");
  });

  it("with home published, GET / and HEAD / serve rendered home with canonical /, strict shell scripts, and Node self-host CSP", async () => {
    const store = await createPageStore(env);
    const existing = await store.load("home");
    const publishedMeta = await store.save({
      version: "0.1",
      slug: "home",
      title: "Mi Portada Viva",
      description: "Portada editable desde el editor visual",
      status: "published",
      root: [
        { id: "hero", type: "Hero", props: { title: "Hola Portada Dinámica", subtitle: "Editable sin terminal", bgColor: "#111827" } },
        { id: "p1", type: "Paragraph", props: { text: "Texto publicado en vivo en la raíz." } },
      ],
    } as unknown as PageLayout, { expectedRevisionId: existing?.revisionId });

    const { context, nextCalls } = makeCtx(env);
    const res = await onRequestGet(context);
    expect(nextCalls()).toBe(0);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>Mi Portada Viva</title>");
    expect(html).toContain("Hola Portada Dinámica");
    expect(html).toContain("Texto publicado en vivo en la raíz.");
    expect(html).toContain('rel="canonical" href="http://x.test/"');
    expect(html).toContain("/portaless-theme-init.js");
    expect(html).toContain("/portaless-shell.js");

    const head = makeCtx(env, "HEAD");
    const headRes = await onRequestHead(head.context);
    expect(head.nextCalls()).toBe(0);
    expect(headRes.status).toBe(200);
    expect(await headRes.text()).toBe("");

    // Full Node self-host runtime check (middleware + strict CSP + functions/index.js)
    const server = await createSelfHostServer({
      rootDir: process.cwd(),
      staticDir,
      env: { ...env, PORTALESS_GATEKEEPER_MODE: "off" },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const { port } = server.address() as AddressInfo;
      const liveRes = await fetch(`http://127.0.0.1:${port}/`);
      expect(liveRes.status).toBe(200);
      const csp = liveRes.headers.get("content-security-policy") || "";
      const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src")) || "";
      expect(scriptSrc).toContain("script-src");
      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain("'unsafe-eval'");
      const liveHtml = await liveRes.text();
      expect(liveHtml).toContain("Hola Portada Dinámica");
      expect(liveHtml).not.toContain("STATIC-HOME-FALLBACK");

      // Reverting home to draft automatically restores static index.html fallback at /
      await store.save({
        version: "0.1",
        slug: "home",
        title: "Mi Portada Viva",
        status: "draft",
        root: [{ id: "p1", type: "Paragraph", props: { text: "NO-DEBE-APARECER" } }],
      } as unknown as PageLayout, { expectedRevisionId: publishedMeta.revisionId });

      const fallbackRes = await fetch(`http://127.0.0.1:${port}/`);
      expect(fallbackRes.status).toBe(200);
      const fallbackHtml = await fallbackRes.text();
      expect(fallbackHtml).toContain("STATIC-HOME-FALLBACK");
      expect(fallbackHtml).not.toContain("NO-DEBE-APARECER");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
