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
