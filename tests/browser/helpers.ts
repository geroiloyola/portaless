// Helpers compartidos por los specs de navegador. Ver playwright.config.ts.
import { expect, type Page } from "@playwright/test";
import {
  BROWSER_TEST_ADMIN_USER,
  BROWSER_TEST_ADMIN_PASSWORD,
} from "../../scripts/browser-test-server.mjs";

export { BROWSER_TEST_ADMIN_USER, BROWSER_TEST_ADMIN_PASSWORD };

/** Login via el formulario real de /admin/login (POST + cookie de sesion + 302 a /admin/). */
export async function login(
  page: Page,
  username: string = BROWSER_TEST_ADMIN_USER,
  password: string = BROWSER_TEST_ADMIN_PASSWORD
): Promise<void> {
  await page.goto("/admin/login");
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/admin\/$/);
}
