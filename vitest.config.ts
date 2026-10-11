// Vitest solo corre tests/**/*.test.ts. Los specs de Playwright
// (tests/browser/*.spec.ts) usan otra extension a proposito: sin este
// include, el default de vitest (*.spec.ts) los levantaria y fallarian
// (no hay @playwright/test ni webServer ahi). Ver playwright.config.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // **/*.test.ts en todo el repo: la mayoria vive en tests/, pero tres
    // archivos estan junto a su codigo (packages/**/__tests__/ y
    // packages/apw-resolver/src/scoring/).
    include: ["**/*.test.ts"],
  },
});
