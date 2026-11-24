// Re-export desde L3 (packages/dashboard/src/docs-nav.mjs) para que L5 (Astro,
// scripts) y L4 (mcp-server) compartan una unica fuente de verdad sin violar la
// direccion de capas.
export { DOC_GROUPS, DOC_ENTRIES, DOC_FILES, docBySlug } from "@portaless/dashboard/docs-nav";
