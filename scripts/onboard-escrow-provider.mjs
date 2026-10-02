#!/usr/bin/env node
// Contraparte de onboard-agent.mjs para la fuente "escrow_report".
// No hay autoservicio: la API key la genera y entrega Portaless manualmente.
// Este script genera la key, la imprime UNA sola vez en stdout para que se
// copie y entregue fuera de banda al proveedor real, y persiste solo su
// hash SHA-256 (misma primitiva que hashApiKey() en
// authorized-escrow-providers.ts) -- nunca la key en texto plano.
//
// v0.0.9.27: node:sqlite -> better-sqlite3, importado directo porque este
// script corre standalone sin build previo de los paquetes TS.
//
// APW v1.2 (5.3, ERRATA E-4): --public-key-jwk registra la clave publica
// Ed25519 del proveedor. Sin ella el proveedor queda autorizado pero no
// puede reportar (el endpoint exige una atestacion firmada). Si el
// provider-id ya existe y no se pasa --public-key-jwk, se conserva la clave
// que tenia.
//
// Uso:
//   node scripts/onboard-escrow-provider.mjs \
//     --provider-id=escrow-example \
//     --display-name="Nombre del proveedor" \
//     --authorized-by=gerardo \
//     --public-key-jwk='{"kty":"OKP","crv":"Ed25519","x":"..."}'
//
// Idempotente: si provider-id ya existe, se genera una API key NUEVA y se
// rota el hash -- la key anterior queda invalidada de inmediato.

import Database from "better-sqlite3";
import { randomBytes, webcrypto } from "node:crypto";

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

// Mismo formato que generateApiKey() en authorized-escrow-providers.ts.
function generateApiKey() {
  return `pless_escrow_${randomBytes(32).toString("base64url")}`;
}

// Misma funcion que hashApiKey() en authorized-escrow-providers.ts.
async function hashApiKey(apiKey) {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Misma regla que normalizeProviderPublicKey() en authorized-escrow-providers.ts.
function normalizePublicKey(raw) {
  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!jwk || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x) || jwk.d !== undefined) {
    return null;
  }
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

export async function runOnboardEscrowProvider(argv) {
  const args = parseArgs(argv);
  const required = ["providerId", "displayName", "authorizedBy"];
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    console.error(`[Portaless Onboarding] Faltan argumentos: ${missing.join(", ")}`);
    console.error(
      "Uso: node scripts/onboard-escrow-provider.mjs --provider-id=... " +
        '--display-name="..." --authorized-by=... [--public-key-jwk=\'{"kty":"OKP","crv":"Ed25519","x":"..."}\']'
    );
    process.exit(1);
  }

  let publicKeyJwk = null;
  if (args.publicKeyJwk) {
    publicKeyJwk = normalizePublicKey(args.publicKeyJwk);
    if (!publicKeyJwk) {
      console.error('[Portaless Onboarding] --public-key-jwk debe ser una clave publica Ed25519: {"kty":"OKP","crv":"Ed25519","x":"..."}');
      process.exit(1);
    }
  }

  const dbPath = requireSqlitePath();
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);
  const authorizedAt = new Date().toISOString();

  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS authorized_escrow_providers (
        provider_id TEXT PRIMARY KEY,
        api_key_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        authorized_at TEXT NOT NULL,
        authorized_by TEXT NOT NULL
      );
    `);
    try {
      db.exec("ALTER TABLE authorized_escrow_providers ADD COLUMN public_key_jwk TEXT");
    } catch (err) {
      if (!/duplicate column/i.test(String(err?.message))) throw err;
    }

    db.prepare(
      `INSERT INTO authorized_escrow_providers
         (provider_id, api_key_hash, display_name, active, authorized_at, authorized_by, public_key_jwk)
       VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(provider_id)
       DO UPDATE SET
         api_key_hash = excluded.api_key_hash,
         display_name = excluded.display_name,
         active = 1,
         authorized_at = excluded.authorized_at,
         authorized_by = excluded.authorized_by,
         public_key_jwk = COALESCE(excluded.public_key_jwk, authorized_escrow_providers.public_key_jwk)`
    ).run(
      args.providerId,
      apiKeyHash,
      args.displayName,
      authorizedAt,
      args.authorizedBy,
      publicKeyJwk ? JSON.stringify(publicKeyJwk) : null
    );
  } finally {
    db.close();
  }

  console.log(`[Portaless Onboarding] Proveedor de escrow autorizado: ${args.displayName} (${args.providerId})`);
  console.log(`  authorized_at: ${authorizedAt}`);
  console.log(`  authorized_by: ${args.authorizedBy}`);
  console.log(`  clave publica: ${publicKeyJwk ? "registrada" : "sin cambios (sin --public-key-jwk)"}`);
  console.log("");
  console.log("  API KEY (copiar y entregar AHORA fuera de banda -- no se vuelve a mostrar):");
  console.log(`  ${apiKey}`);
  console.log("");
  console.log(`  Authorization header que debe enviar el proveedor: Bearer ${apiKey}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOnboardEscrowProvider(process.argv);
}
