#!/usr/bin/env node
// Genera schema.sql (raiz) concatenando sus 33 fuentes reales en orden:
//   5 schema.sql de paquete (auth, permissions, trust-layer ledger,
//   atomic-elements, apw-resolver) + 28 addendums de schema-additions/*.sql.
//
//   node scripts/generate-schema.mjs   (o: npm run generate-schema)
//
// Correrlo debe ser idempotente: regenerar contra el maestro committeado no
// deberia producir ningun diff de SQL. Si `git diff schema.sql` muestra mas
// que comentarios, una fuente y el maestro se desincronizaron -- arreglar la
// FUENTE (o este script), nunca el maestro a mano.
//
// Historial: hasta v0.0.9.31 el script conocia solo 4 fuentes y el resto del
// maestro era edicion manual (regenerar borraba 17 de las 24 tablas). Este
// rewrite cubre las 13 secciones reales; el header del maestro (bloque de
// NOTAs) vive a partir de ahora aqui, dentro del generador.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Paquetes: el generador agrega el banner de seccion (@portaless/...).
// Addendums: cada archivo trae su propio banner v0.0.9.x identico al del
// maestro historico, asi que se concatena tal cual (selfBanner).
const SOURCES = [
  { label: "@portaless/auth -- usuarios y sesiones", path: "packages/auth/src/stores/schema.sql" },
  { label: "@portaless/permissions -- Centro de Permisos", path: "packages/permissions/src/stores/schema.sql" },
  { label: "@portaless/trust-layer -- ledger de uso por agentes", path: "packages/trust-layer/src/ledger/schema.sql" },
  { label: "@portaless/atomic-elements -- paginas persistidas", path: "packages/atomic-elements/src/persistence/stores/schema.sql" },
  { path: "schema-additions/password-reset.sql", selfBanner: true },
  { path: "schema-additions/password-change-events.sql", selfBanner: true },
  { path: "schema-additions/plugin-registry.sql", selfBanner: true },
  { path: "schema-additions/site-trust-score.sql", selfBanner: true },
  { path: "schema-additions/site-trust-read-policies.sql", selfBanner: true },
  { path: "schema-additions/authorized-agents.sql", selfBanner: true },
  { path: "schema-additions/authorized-escrow-providers.sql", selfBanner: true },
  { label: "@portaless/apw-resolver -- identidad did:apw e historial encadenado", path: "packages/apw-resolver/schema.sql" },
  { path: "schema-additions/capability-tokens.sql", selfBanner: true },
  { path: "schema-additions/webbotauth-nonces.sql", selfBanner: true },
  { path: "schema-additions/mcp-agent-tokens.sql", selfBanner: true },
  { path: "schema-additions/mcp-audit-events.sql", selfBanner: true },
  { path: "schema-additions/deployment-oauth.sql", selfBanner: true },
  { path: "schema-additions/deployment-providers-config.sql", selfBanner: true },
  { path: "schema-additions/settlement-activations.sql", selfBanner: true },
  { path: "schema-additions/atproto-links.sql", selfBanner: true },
  { path: "schema-additions/cloud-images.sql", selfBanner: true },
  { path: "schema-additions/site-skin.sql", selfBanner: true },
  { path: "schema-additions/site-settings.sql", selfBanner: true },
  { path: "schema-additions/element-packs.sql", selfBanner: true },
  { path: "schema-additions/theme-packs.sql", selfBanner: true },
  { path: "schema-additions/community-attestations.sql", selfBanner: true },
  { path: "schema-additions/activity-events.sql", selfBanner: true },
  { path: "schema-additions/plugin-artifacts.sql", selfBanner: true },
  { path: "schema-additions/agent-access-policy.sql", selfBanner: true },
  { path: "schema-additions/plugin-storage.sql", selfBanner: true },
  { path: "schema-additions/plugin-email-quota.sql", selfBanner: true },
  { path: "schema-additions/publication-runs.sql", selfBanner: true },
  { path: "schema-additions/resolution-budget-config.sql", selfBanner: true },
];

const BANNER_LINE = "-- -----------------------------------------------------------------------------";

const HEADER = `-- =============================================================================
-- Portaless -- Esquema de base de datos maestro (v0.0.9.32)
-- =============================================================================
-- GENERADO AUTOMATICAMENTE por scripts/generate-schema.mjs -- NO EDITAR A MANO.
-- Para cambiar una tabla, edita su fuente (packages/*/schema.sql o
-- schema-additions/*.sql -- ver la lista al inicio de generate-schema.mjs)
-- y corre: node scripts/generate-schema.mjs
--
-- NOTA v0.0.9.24: la columna key_algorithm de authorized_agents (mas abajo)
-- se agrego directamente a este archivo maestro. CONFIRMADO: packages/
-- trust-layer/src/site-trust/ no tiene un schema.sql de paquete individual.
--
-- NOTA v0.0.9.25: se agrega site_identity (packages/apw-resolver/schema.sql,
-- fuente propia nueva) -- identidad did:apw del sitio mismo, generada por el
-- Wizard de onboarding (Paso 3-4). Ver packages/apw-resolver/src/did-apw/.
--
-- NOTA v0.0.9.26: se agrega capability_bridge_tokens -- tokens efimeros del
-- Capability Bridge HTTP (functions/api/internal/capability-bridge.js),
-- reemplazando el secreto estatico PORTALESS_INTERNAL_BRIDGE_TOKEN. Ver
-- packages/plugin-sandbox/src/registry/stores/capability-token-store.ts.
--
-- NOTA v0.0.9.27: se agregan deployment_oauth_states y deployment_credentials
-- (Motor de Despliegue, OAuth de infraestructura con GitHub App) directamente
-- a este archivo maestro, mismo precedente que v0.0.9.24. Fuente:
-- schema-additions/deployment-oauth.sql (hoy fuente directa del generador).
-- Ver packages/deploy-engine/src/oauth-store.ts.
-- Tambien deployment_providers_config (GitHub App registrada via manifiesto,
-- secretos cifrados). Fuente: schema-additions/deployment-providers-config.sql.
-- Ver packages/deploy-engine/src/providers-config-store.ts.
--
-- NOTA PR #62: se agregan auth_mfa_challenges y auth_rate_limits a la seccion
-- @portaless/auth. Fuente: packages/auth/src/stores/schema.sql (editado ahi y
-- copiado aca en la misma posicion que produce generate-schema.mjs).
--
-- NOTA APW v1.2 (PRs #71, #73, #74):
--   - La seccion de apw-resolver (site_identity, site_identity_keys,
--     site_attestation_log) es copia de packages/apw-resolver/schema.sql.
--   - site_trust_agent_verifications y site_trust_escrow_reports agregan
--     attestation_jws / attestation_jti y un indice unico por emisor (ERRATA
--     E-4). authorized_escrow_providers agrega public_key_jwk. Estas tablas no
--     tienen schema.sql de paquete: se editan en schema-additions/*.sql
--     (desde v0.0.9.31; antes directamente aca).
--   - Las bases anteriores NO necesitan reaplicar este archivo: los stores
--     agregan estas columnas e indices solos (ALTER TABLE al primer uso).
--
-- NOTA v0.0.9.31 (fuentes):
--   - usage_ledger gana reader_did (ERRATA E-9). Ya estaba en
--     packages/trust-layer/src/ledger/schema.sql; el maestro estaba atrasado
--     respecto de su propia fuente.
--   - Tabla nueva reader_conduct_jti (spec APW 6.4): indice de los jti de
--     reader_conduct que el sitio ya emitio (jti determinista por emisor,
--     lector, periodo y categoria). DDL en packages/apw-resolver/schema.sql;
--     los stores D1/SQLite la crean al vuelo en bases existentes.
--   Ambas piezas solo completan instalaciones limpias: las bases anteriores
--   las reciben de sus stores al vuelo, sin reaplicar este archivo.
--
-- NOTA v0.0.9.31 (estructura): las secciones sin schema.sql de paquete
-- (password reset, plugins, site_trust_*, authorized_*, capability bridge,
-- settlement activations, deployment) viven ahora en schema-additions/*.sql
-- como fuentes directas del generador. settlement_provider_activations se
-- incorporo al maestro y a REQUIRED_TABLES en v0.0.9.10 (antes solo la
-- creaba su store al vuelo; ver ROADMAP.md).
--
-- NOTA Portaless Index (APW 5.7, seccion 7): witness_observations,
-- witness_weights y witness_index_subjects -- agregador de testigos
-- (observaciones verificadas por sujeto, ponderacion estatica por testigo y
-- entrada de directorio cacheada que publica /.well-known/apw-index.json).
-- DDL en packages/apw-resolver/schema.sql; los stores D1/SQLite las crean
-- al vuelo en bases existentes.
--
-- NOTA v0.0.9.32: tabla nueva site_atproto_links -- vinculos opcionales
-- APW <-> AT Protocol (handles que el sitio reclama en su did:apw via
-- alsoKnownAs). Fuente schema-additions/atproto-links.sql; el store la
-- crea al vuelo en bases existentes. Sin filas el did.json no cambia.
--
-- NOTA v0.0.9.33: tabla nueva site_settings -- ajustes generales del sitio
-- en clave/valor (primer uso: configuracion de analytics que /admin/analytics
-- escribe y /api/analytics emite al publico). Fuente
-- schema-additions/site-settings.sql; el store la crea al vuelo en bases
-- existentes. Ver packages/dashboard/src/site-settings/site-settings-store.ts.
--
-- NOTA v0.0.9.34: tabla nueva activity_events -- feed de actividad del
-- dashboard (Fase 10). Append-only, admin-only, sin IPs; reemplaza los
-- paneles mock que mostraban datos falsos. Fuente
-- schema-additions/activity-events.sql; el store la crea al vuelo en bases
-- existentes. Ver packages/dashboard/src/activity/activity-store.ts.
--
-- NOTA v0.0.9.35: tablas nuevas plugin_artifacts y plugin_artifact_chunks --
-- codigo de plugins instalados por HTTP, troceado en BLOB de 512 KB (limites
-- de D1). Fuente schema-additions/plugin-artifacts.sql; el store las crea al
-- vuelo. Ver packages/plugin-sandbox/src/registry/plugin-artifacts.ts.
--
-- NOTA PR2: resolution_budget_config guarda configuración tipada versionada,
-- nunca secretos ni contadores. Sin fila, instalaciones previas no cambian.
-- Fuente schema-additions/resolution-budget-config.sql; migración versionada v10.
--
-- Aplicar este archivo:
--   Cloudflare D1:      wrangler d1 execute <NOMBRE_DB> --file=schema.sql
--   SQLite self-hosted: sqlite3 portaless.db < schema.sql
--   O usa el instalador completo: npm run setup
--
-- Todas las sentencias son CREATE TABLE/INDEX IF NOT EXISTS -- correr este
-- archivo repetidas veces sobre una base de datos que ya tiene las tablas
-- es seguro y no destruye datos existentes.
`;

function main() {
  const parts = [`${HEADER}\n`];

  for (const source of SOURCES) {
    const fullPath = join(rootDir, source.path);
    const content = readFileSync(fullPath, "utf-8").trim();
    if (source.selfBanner) {
      parts.push(`\n${content}\n`);
    } else {
      parts.push(`\n${BANNER_LINE}\n-- ${source.label}\n${BANNER_LINE}\n\n${content}\n`);
    }
  }

  const outputPath = join(rootDir, "schema.sql");
  writeFileSync(outputPath, parts.join(""), "utf-8");
  console.log(`schema.sql regenerado en ${outputPath} a partir de ${SOURCES.length} fuentes.`);
}

main();
