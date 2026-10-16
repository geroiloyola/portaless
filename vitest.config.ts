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
    // Varios tests aplican el schema.sql completo (27 fuentes) para tener una
    // base real: es I/O real, y bajo la carga de CI (186 workers) rozaba el
    // default de 5s y fallaba por timeout -- no por contrato (tres veces:
    // mcp-agent-token-store, admin-cloud-images-endpoint, atproto-reputation).
    // 15s es un presupuesto honesto para ese trabajo; no enmascara cuelgues
    // (la suite es determinista y corre en <1s por archivo localmente).
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
