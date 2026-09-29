// functions/admin/api/site-identity.js
//
// Endpoint del Paso 3-4 del Wizard de onboarding: genera (o consulta) la
// identidad did:apw de ESTE sitio. Mismo patron de seguridad que
// functions/admin/api/authorized-escrow-providers.js: requiere sesion
// valida (context.data.user) para GET, y canWrite(role) del lado del
// SERVIDOR para POST.
//
// v0.0.9.30 -- rotacion. POST con
//   { rotate: true, confirm: "ROTAR", password, totpCode? }
// reemplaza la identidad existente por un par de claves nuevo.
//   - confirm evita rotaciones accidentales (doble click, reintento).
//   - password (+ totpCode si el admin tiene 2FA) es verificacion
//     reforzada via AuthService.verifyStepUp(): una sesion robada sola no
//     alcanza para destruir la identidad del sitio.
//   - domain es opcional al rotar: si no viene, se reusa el actual.
// Sin rotate, el comportamiento es el mismo de antes (409 si ya existe).

import { createSiteIdentityStore } from "../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { generateApwDid } from "../../../packages/apw-resolver/src/did-apw/generate.ts";
import { AuthService } from "../../../packages/auth/src/auth-service.ts";
import { createUsersStore, createSessionStore } from "../../../packages/auth/src/store-factory.ts";

const SITE_ID = "default";
const ROTATE_CONFIRMATION = "ROTAR";

const STEP_UP_MESSAGES = {
  password_required: "Ingresa tu contrasena actual para rotar la identidad.",
  invalid_password: "La contrasena no es correcta.",
  totp_required: "Ingresa el codigo de tu app de 2FA.",
  invalid_totp: "El codigo de 2FA no es correcto o expiro.",
  no_step_up_factor: "Tu cuenta no tiene contrasena ni 2FA. Activa 2FA antes de rotar la identidad.",
  user_not_found: "No se encontro tu usuario.",
};

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function canWrite(role) {
  return role === "admin";
}

function unauthenticated() {
  return json({ error: "unauthenticated" }, 401);
}

function forbidden(role) {
  return json({ error: "forbidden", message: `El rol '${role}' no tiene permiso de escritura. Se requiere rol 'admin'.` }, 403);
}

export async function onRequestGet(context) {
  const { data, env } = context;
  if (!data?.user) return unauthenticated();

  const store = await createSiteIdentityStore(env);
  const identity = await store.get(SITE_ID);

  return json({ identity }, 200);
}

export async function onRequestPost(context) {
  const { request, data, env } = context;
  const user = data?.user;
  if (!user) return unauthenticated();
  if (!canWrite(user.role)) return forbidden(user.role);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const { domain, rotate, confirm, password, totpCode } = body ?? {};
  if (domain !== undefined && (typeof domain !== "string" || !domain.trim())) {
    return json({ error: "invalid_body", message: "domain debe ser un string no vacio." }, 400);
  }

  const store = await createSiteIdentityStore(env);
  const existing = await store.get(SITE_ID);

  if (rotate === true) {
    if (!existing) {
      return json({ error: "identity_not_found", message: "No hay identidad did:apw para rotar. Genera una primero." }, 404);
    }
    if (confirm !== ROTATE_CONFIRMATION) {
      return json(
        {
          error: "rotation_not_confirmed",
          message: `Rotar invalida la clave actual: las firmas hechas con ella dejan de verificar. Reenvia con { rotate: true, confirm: "${ROTATE_CONFIRMATION}" }.`,
        },
        400
      );
    }

    const auth = new AuthService(await createUsersStore(env), await createSessionStore(env));
    const check = await auth.verifyStepUp(user.username, {
      password: typeof password === "string" ? password : undefined,
      totpCode: typeof totpCode === "string" ? totpCode : undefined,
    });
    if (!check.ok) {
      return json({ error: "step_up_failed", reason: check.reason, message: STEP_UP_MESSAGES[check.reason] ?? "Verificacion fallida." }, 401);
    }

    const keyPair = await generateApwDid(domain ?? existing.domain);
    const record = await store.rotate(SITE_ID, keyPair, user.username);
    return json(
      { identity: record, previousDid: existing.did, didDocument: keyPair.didDocument, privateKeyJwk: keyPair.privateKeyJwk },
      200
    );
  }

  if (typeof domain !== "string") {
    return json({ error: "invalid_body", message: "Se requiere { domain }." }, 400);
  }

  if (existing) {
    return json(
      {
        error: "identity_already_exists",
        message: "Este sitio ya tiene una identidad did:apw. Para reemplazarla, usa la pantalla de rotacion (/admin/wizard/rotate-identity).",
        identity: existing,
      },
      409
    );
  }

  const keyPair = await generateApwDid(domain);
  const record = await store.create(SITE_ID, keyPair, user.username);

  return json({ identity: record, didDocument: keyPair.didDocument, privateKeyJwk: keyPair.privateKeyJwk }, 201);
}
