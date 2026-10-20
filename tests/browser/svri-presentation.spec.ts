import { test, expect } from "@playwright/test";
import { login } from "./helpers";

const svri = {
  version: "1.0",
  profile: "ltp-svri-site-v1",
  score: 9.5,
  t1Count: 2,
  t2Count: 1,
  t3Count: 3,
  t4Count: 1,
  t5Count: 2,
  incompleteData: false,
  isInference: false,
  priorShare: 0.2,
  effectiveWeight: 12,
  dimensionCount: 3,
  rulesVersion: "ltp-svri-site-v1",
  publicLevel: "reliable",
};

test("admin sees numeric SVRI details in the native CSS disclosure", async ({ page }) => {
  await login(page);
  await page.route("**/admin/api/svri?siteId=default", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      siteId: "default",
      svri,
      dimensions: [{ dimension: "W-05", score: 6.7, count: 4, weightSum: 6.5 }],
      verifiedSourceRecords: [{ tier: "T1", issuer: "escrow.example", attestationId: "escrow-jti-1" }],
      excludedEvidence: [{
        attestationId: "community-new",
        issuer: "did:apw:new.example",
        source: "community",
        tier: "T3",
        category: "content_accuracy",
        reason: "emitter_too_new",
        detail: "issuer history is younger than the 7-day E-13 minimum",
      }],
      missingDimensions: ["W-03"],
      history: { status: "partial", chainValid: true, unanchoredEntries: 1, events: [] },
      anchorChecked: false,
    }),
  }));
  await page.goto("/admin/trust-svri");

  await expect(page.locator("[data-svri-score]")).toHaveText("SVRI: 9.5/10");
  const disclosure = page.getByText("Desglose técnico ⓘ");
  await disclosure.hover();
  const panel = page.getByRole("region", { name: "Desglose técnico SVRI" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("T1: 2 | T2: 1 | T3: 3 | T5: 2");
  await expect(panel).toContainText("T4 (Conducta Observada)");
  await expect(panel).toContainText("1 registros reales");
  await expect(panel).toContainText("Inferencia (Prior Matemático)");
  await expect(panel).toContainText("Valor base 4.0");
  await expect(panel).toContainText("Diagnóstico de Exclusión");
  await expect(panel).toContainText("Ausente: Transparencia");
  await expect(panel).toContainText("1 firma ignorada por E-13 (Antigüedad)");
  await expect(panel).toContainText("escrow-jti-1");
  await expect(panel.getByRole("link", { name: /Reconstrucción Histórica/ })).toHaveAttribute("href", "/admin/trust/hsvr?siteId=default");
});

test("HSVR shows the audit banner when historical keys or E-13 evidence is missing", async ({ page }) => {
  await login(page);
  await page.route("**/admin/api/svri?siteId=default", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      siteId: "default",
      svri,
      dimensions: [],
      verifiedSourceRecords: [],
      excludedEvidence: [{
        attestationId: "community-old",
        issuer: "did:apw:old.example",
        source: "community",
        tier: "T3",
        reason: "emitter_too_new",
      }],
      missingDimensions: [],
      history: {
        status: "partial",
        chainValid: true,
        unanchoredEntries: 0,
        events: [{
          sequence: 3,
          recordedAt: "2025-12-01T00:00:00.000Z",
          source: "community",
          tier: "T3",
          issuer: "did:apw:old.example",
          attestationId: "community-old",
          accepted: false,
          reason: "community_key_unavailable_or_outside_window",
          svri,
        }],
      },
      anchorChecked: true,
    }),
  }));
  await page.goto("/admin/trust/hsvr?siteId=default");

  const banner = page.locator("[data-hsvr-audit-warning]");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Nota de Auditoría: Reconstrucción parcial.");
  await expect(banner).toContainText("pre-E13");
  await expect(banner).toHaveAttribute("data-audit-reason", "historical_key_unavailable");
});

test("public Trust badge shows only the qualitative level, never the numeric SVRI", async ({ page }) => {
  await page.route("**/trust/default", async (route) => {
    if (route.request().headers().accept?.includes("text/html")) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        siteId: "default",
        self: [], agent: [], community: [], escrowReports: [],
        projection: { svri: { version: "1.0", publicLevel: "pending" } },
      }),
    });
  });
  await page.goto("/trust/");
  const badge = page.locator("[data-svri-badge]");
  await expect(badge).toContainText("SVRI: Pendiente");
  await expect(badge).not.toContainText(/\d+\.\d+\/10/);
  await expect(badge).toHaveAttribute("href", "/trust/explicacion-svri");
});
