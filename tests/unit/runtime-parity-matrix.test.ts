// E-05: Valida que la matriz de paridad Static / Cloudflare Pages / Node self-host
// (docs/architecture/runtime-parity-matrix.md) coincide con los archivos, rutas y
// guardas reales del repositorio.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "../..");
const matrixPath = join(root, "docs/architecture/runtime-parity-matrix.md");
const docsReadmePath = join(root, "docs/README.md");

describe("E-05: runtime parity matrix", () => {
  it("exists, is linked from docs/README.md, and covers all 3 runtimes", () => {
    expect(existsSync(matrixPath)).toBe(true);
    const matrix = readFileSync(matrixPath, "utf8");
    const docsReadme = readFileSync(docsReadmePath, "utf8");

    expect(docsReadme).toContain("architecture/runtime-parity-matrix.md");
    expect(matrix).toContain("Static");
    expect(matrix).toContain("Cloudflare Pages");
    expect(matrix).toContain("Node Self-Host");
  });

  it("every code anchor cited in the matrix exists in the repository", () => {
    const anchors = [
      "astro.config.mjs",
      "src/lib/site-profile.mjs",
      "functions/index.js",
      "functions/pages/[slug].js",
      "functions/healthz.js",
      "functions/_middleware.js",
      "server/node-runtime.mjs",
      "public/_headers",
      "functions/_shared/security-headers.js",
      "functions/admin/login.js",
      "functions/admin/login-mfa.js",
      "functions/admin/logout.js",
      "functions/admin/oauth/[provider]/callback.js",
      "functions/admin/api/stepup/email/request.js",
      "packages/auth/src/auth-service.ts",
      "packages/auth/src/email-sender.ts",
      "packages/auth/src/store-factory.ts",
      "schema.sql",
      "server/first-run.mjs",
      "functions/api/setup/complete.js",
      "functions/admin/api/publication.js",
      "functions/admin/api/backup.js",
      "packages/mcp-server/src/index.ts",
      "functions/api/internal/capability-bridge.js",
      "functions/.well-known/apw-index.json.js",
      "functions/admin/api/witness/record.js",
      "functions/admin/api/index/sync.js",
      "functions/_shared/preauth-egress-guard.js",
      "functions/_shared/gatekeeper-runtime.js",
      "wrangler.toml",
    ];
    for (const rel of anchors) {
      expect(existsSync(join(root, rel)), `Missing code anchor: ${rel}`).toBe(true);
    }
  });

  it("documented runtime constraints match real implementation guards", () => {
    const emailSenderSrc = readFileSync(join(root, "packages/auth/src/email-sender.ts"), "utf8");
    // Direct SMTP is explicitly gated to Node runtime
    expect(emailSenderSrc).toContain('env?.__PORTALESS_RUNTIME !== "node"');

    const setupCompleteSrc = readFileSync(join(root, "functions/api/setup/complete.js"), "utf8");
    // /api/setup/complete returns 404 when __PORTALESS_FIRST_RUN is absent (Cloudflare)
    expect(setupCompleteSrc).toContain("__PORTALESS_FIRST_RUN");
    expect(setupCompleteSrc).toContain("404");

    const wranglerToml = readFileSync(join(root, "wrangler.toml"), "utf8");
    expect(wranglerToml).toContain("nodejs_compat");

    const nodeRuntimeSrc = readFileSync(join(root, "server/node-runtime.mjs"), "utf8");
    expect(nodeRuntimeSrc).toContain("/healthz");
    expect(nodeRuntimeSrc).toContain("withSecurityHeaders");

    const gatekeeperSrc = readFileSync(join(root, "functions/_shared/gatekeeper-runtime.js"), "utf8");
    expect(gatekeeperSrc).toContain("PORTALESS_GATEKEEPER_MODE");
    expect(gatekeeperSrc).toContain("createVeraTrustHostAdapter");
  });
});
