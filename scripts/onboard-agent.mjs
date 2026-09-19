#!/usr/bin/env node
// Script de onboarding manual -- Fase 1 de authorized-agents.ts (que
// documenta explicitamente que esta fase es "lista estricta, gestionada
// manualmente", sin flujo de autoservicio). Self-hosted only: escribe
// directo contra el archivo SQLite en PORTALESS_SQLITE_PATH via
// node:sqlite (Node 22.5+), mismo patron que SqliteAuthorizedAgentsStore
// -- reutiliza el mismo CREATE TABLE IF NOT EXISTS para no depender de
// que schema.sql ya se haya aplicado.
//
// Uso:
//   node scripts/onboard-agent.mjs \
//     --agent-key-id=ed25519:AAAA... \
//     --signature-agent-url=https://agent.example.com \
//     --display-name="Nombre del agente" \
//     --authorized-by=gerardo
//
// Idempotente: si agent-key-id ya existe, actualiza la fila
// (ON CONFLICT ... DO UPDATE) en vez de duplicar o fallar.

import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, key, value] = match;
    out[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

function requireSqlitePath() {
  const path = process.env.PORTALESS_SQLITE_PATH;
  if (!path) {
    console.error(
      "[Portaless Onboarding] PORTALESS_SQLITE_PATH no esta definida. " +
      "Este script es self-hosted only -- exporta la variable antes de correrlo, " +
      "ej: export PORTALESS_SQLITE_PATH=./data/portaless.sqlite"
    );
    process.exit(1);
  }
  return path;
}

export function runOnboardAgent(argv) {
  const args = parseArgs(argv);
  const required = ["agentKeyId", "signatureAgentUrl", "displayName", "authorizedBy"];
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    console.error(`[Portaless Onboarding] Faltan argumentos: ${missing.join(", ")}`);
    console.error(
      "Uso: node scripts/onboard-agent.mjs --agent-key-id=... --signature-agent-url=... " +
      "--display-name=\"...\" --authorized-by=..."
    );
    process.exit(1);
  }

  const dbPath = requireSqlitePath();
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS authorized_agents (
      agent_key_id TEXT PRIMARY KEY,
      signature_agent_url TEXT NOT NULL,
      display_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      authorized_at TEXT NOT NULL,
      authorized_by TEXT NOT NULL
    );
  `);

  const authorizedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO authorized_agents
       (agent_key_id, signature_agent_url, display_name, active, authorized_at, authorized_by)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(agent_key_id)
     DO UPDATE SET
       signature_agent_url = excluded.signature_agent_url,
       display_name = excluded.display_name,
       active = 1,
       authorized_at = excluded.authorized_at,
       authorized_by = excluded.authorized_by`
  ).run(args.agentKeyId, args.signatureAgentUrl, args.displayName, authorizedAt, args.authorizedBy);

  console.log(`[Portaless Onboarding] Agente autorizado: ${args.displayName} (${args.agentKeyId})`);
  console.log(`  signature_agent_url: ${args.signatureAgentUrl}`);
  console.log(`  authorized_at: ${authorizedAt}`);
  console.log(`  authorized_by: ${args.authorizedBy}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOnboardAgent(process.argv);
}
