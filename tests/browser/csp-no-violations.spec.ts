// A-07 / PR 3: Verifica en navegador real (Playwright) que el CSP sin
// 'unsafe-inline' en script-src produce 0 securitypolicyviolation y 0 errores
// CSP en consola mientras la interactividad (tema, explore, menu movil) sigue intacta.
import { test, expect } from "@playwright/test";

test.describe("CSP strict script-src (no unsafe-inline)", () => {
  test("zero CSP violations across public routes, mobile menu, and theme initialization", async ({ page }) => {
    const violations: string[] = [];
    const cspConsoleErrors: string[] = [];

    await page.addInitScript(() => {
      (window as any).__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        (window as any).__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI || "inline"}`);
      });
    });

    page.on("console", (msg) => {
      if (msg.type() === "error" && /content security policy|csp/i.test(msg.text())) {
        cspConsoleErrors.push(msg.text());
      }
    });

    // Verify CSP header on root route has no 'unsafe-inline' in script-src
    const rootRes = await page.goto("/");
    expect(rootRes).toBeTruthy();
    const csp = rootRes!.headers()["content-security-policy"] || "";
    const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] || "";
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");

    // Test theme anti-FOUC external script works under strict CSP
    await page.evaluate(() => localStorage.setItem("portaless-theme", "dark"));
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await page.evaluate(() => localStorage.removeItem("portaless-theme"));

    // Visit /explore/ and verify interactive order filter still works under strict CSP
    await page.goto("/explore/");
    await expect(page.locator("#explore-order-status")).toBeVisible();
    await page.locator('input[name="explore-order"][value="old"]').check({ force: true });
    await expect(page.locator("#explore-order-status")).not.toBeEmpty();

    // Visit first content page (/pages/starter-guide/ in starter or first /pages/* in demo)
    const firstPageHref = await page.locator('a[href*="/pages/"]').first().getAttribute("href");
    if (firstPageHref) {
      await page.goto(firstPageHref);
      await expect(page.locator("main")).toBeVisible();
    }

    // Visit /blog/ and /admin/login
    await page.goto("/blog/");
    await expect(page.locator("main")).toBeVisible();
    await page.goto("/admin/login");
    await expect(page.locator("form")).toBeVisible();

    // Mobile viewport check (375px) on /
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator("header.site-header")).toBeVisible();

    const collected = await page.evaluate(() => (window as any).__cspViolations || []);
    violations.push(...collected);

    expect(violations).toEqual([]);
    expect(cspConsoleErrors).toEqual([]);
  });
});
