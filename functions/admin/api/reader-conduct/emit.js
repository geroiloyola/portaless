// functions/admin/api/reader-conduct/emit.js
//
// POST /admin/api/reader-conduct/emit (LTP v1.2, 6.4; ERRATA E-9).
// Emite las reader_conduct de un periodo del ledger, firmadas por ESTE sitio,
// y las anota en su historial encadenado (asi el emisor publica lo que emitio).
//
// Body: { period?: "YYYY-MM" (default: mes UTC actual), password, totpCode? }
//
// Seguridad: sesion + rol admin + verificacion reforzada (step-up), mismo
// patron que la rotacion de identidad (functions/admin/api/site-identity.js).
// Firmar en nombre del sitio afecta la reputacion de terceros: una sesion
// robada sola no alcanza.
//
// Firma con la clave ACTIVA (getActiveSigningKey): kid = keyId #key-<n>
// vigente (E-3), asi una rotacion no deja firmas con una clave retirada.
//
// Idempotencia: el jti es determinista (conductJti). Antes de emitir se leen
// los jti de las reader_conduct ya anotadas en el historial (att_jws, E-9);
// esos se informan como already_emitted. Las entradas sin att_jws (anteriores
// a E-9) no se pueden inspeccionar.

import { AuthService } from "../../../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../../../packages/auth/src/store-factory.ts";
import { createSiteIdentityStore, createAttestationLogStore } from "../../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { appendAttestation } from "../../../../packages/apw-resolver/src/did-apw/history-log.ts";
import { signSiteJws, ATTESTATION_TYP } from "../../../../packages/apw-resolver/src/did-apw/site-jws.ts";
import { resolveApwManifest } from "../../../../packages/apw-resolver/src/index.ts";
import { emitReaderConduct } from "../../../../packages/apw-resolver/src/scoring/reader-conduct-emitter.ts";
import { createUsageLedgerStore } from "../../../../packages/trust-layer/src/ledger/store-factory.ts";

const SITE_ID = "default";
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LOG_PAGE = 500;

const STEP_UP_MESSAGES = {
  password_required: "Ingresa tu contrasena actual para emitir atestaciones.",
  invalid_password: "La contrasena no es correcta.",
  totp_required: "Ingresa el codigo de tu app de 2FA.",
  invalid_totp: "El codigo de 2FA no es correcto o expiro.",
  no_step_up_factor: "Tu cuenta no tiene contrasena ni 2FA. Activa 2FA antes de emitir atestaciones.",
  user_not_found: "No se encontro tu usuario.",
};

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function decodePayload(jws) {
  try {
    const part = jws.split(".")[1];
    const base64 = part.split("-").join("+").split("_").join("/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

async function emittedJtis(log, siteDid) {
  const jtis = new Set();
  let from = 1;
  for (;;) {
    const page = await log.list(SITE_ID, from, LOG_PAGE);
    for (const entry of page) {
      const jws = entry.attJws ?? null;
      if (!jws) continue;
      const p = decodePayload(jws);
      if (p?.src === "reader_conduct" && p?.iss === siteDid && typeof p.jti === "string") jtis.add(p.jti);
    }
    if (page.length < LOG_PAGE) return jtis;
    from = page[page.length - 1].seq + 1;
  }
}

export async function defaultEmitDeps(env) {
  return {
    verifyStepUp: async (username, factors) => {
      const auth = new AuthService(await createUsersStore(env), await createSessionStore(env));
      return auth.verifyStepUp(username, factors);
    },
    identity: await createSiteIdentityStore(env),
    log: await createAttestationLogStore(env),
    ledger: await createUsageLedgerStore(env),
    resolveTxtKey: async (host) => {
      const r = await resolveApwManifest(host);
      return r.resolved && r.manifest?.k ? r.manifest.k : null;
    },
  };
}

export async function handleEmit(context, makeDeps = defaultEmitDeps) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return json({ error: "unauthenticated" }, 401);
  if (user.role !== "admin") {
    return json({ error: "forbidden", message: `El rol '${user.role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }
  const { period: rawPeriod, password, totpCode } = body ?? {};
  const period = rawPeriod === undefined ? currentPeriod() : rawPeriod;
  if (typeof period !== "string" || !PERIOD_RE.test(period)) {
    return json({ error: "invalid_period", message: "period debe tener el formato YYYY-MM." }, 400);
  }

  const deps = await makeDeps(env);
  const check = await deps.verifyStepUp(user.username, {
    password: typeof password === "string" ? password : undefined,
    totpCode: typeof totpCode === "string" ? totpCode : undefined,
  });
  if (!check.ok) {
    return json({ error: "step_up_failed", reason: check.reason, message: STEP_UP_MESSAGES[check.reason] ?? "Verificacion fallida." }, 401);
  }

  const record = await deps.identity.get(SITE_ID);
  const key = record ? await deps.identity.getActiveSigningKey(SITE_ID) : null;
  if (!record || !key) {
    return json({ error: "site_identity_not_found", message: "El sitio necesita una identidad did:apw para firmar atestaciones." }, 404);
  }

  const periodData = await deps.ledger.get(period);
  if (!periodData) return json({ period, emitted: [], skipped: [] }, 200);

  const already = await emittedJtis(deps.log, record.did);
  const result = await emitReaderConduct(periodData, {
    signer: {
      did: record.did,
      sign: (payload) => signSiteJws(payload, { keyId: key.keyId, privateKeyJwk: key.privateKeyJwk }, ATTESTATION_TYP),
    },
    resolveTxtKey: deps.resolveTxtKey,
    alreadyEmitted: async (jti) => already.has(jti),
    record: async (jws, jti) => {
      await appendAttestation({ identity: deps.identity, log: deps.log, siteId: SITE_ID }, jws);
      already.add(jti);
    },
  });

  return json(result, 200);
}

export async function onRequestPost(context) {
  return handleEmit(context);
}
