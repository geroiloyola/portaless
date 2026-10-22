import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("agent policy panel displays aggregate unsigned-bot counts and its detection limit", async ({ page }) => {
  await login(page);
  await page.goto("/admin/agents");
  await expect(page.locator("#ag-root")).toBeVisible();
  await expect(page.locator("#ag-metrics-title")).toHaveText("Rechazos sin firma (User-Agent declarado)");
  await expect(page.getByText("Este filtro solo detecta al bot que se declara;", { exact: false })).toBeVisible();
  await expect(page.locator("#ag-metrics-status")).not.toBeEmpty();
  const metrics = await page.evaluate(async () => (await (await fetch("/admin/api/agents")).json()).unsignedBotRejections);
  expect(metrics.available).toBe(true);
  expect(Array.isArray(metrics.periods)).toBe(true);
  const rows = metrics.periods;
  await expect(page.locator("#ag-metrics tr")).toHaveCount(rows.length);
});

test("each displayed bot-family count is explicitly labeled declarada", async ({ page }) => {
  await login(page);
  await page.route("**/admin/api/agents", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.unsignedBotRejections = { available: true, approximate: true, persistence: "database", periods: [
      { period: "2026-10", googlebot: 3, bingbot: 2, other: 1, unknown: 0 },
    ] };
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin/agents");
  await expect(page.locator("#ag-metrics td")).toHaveText(["2026-10", "3 (declarada)", "2 (declarada)", "1 (declarada)", "0 (declarada)"]);
  await expect(page.getByText("Cada cifra es declarada y aproximada:", { exact: false })).toBeVisible();
});
