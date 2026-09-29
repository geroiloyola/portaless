// functions/admin/api/site-identity.js
//
// Endpoint del Paso 3-4 del Wizard de onboarding: genera (o consulta) la
// identidad did:apw de ESTE sitio. Mismo patron de seguridad que
// functions/admin/api/authorized-escrow-providers.js: requiere sesion
// valida (context.data.user) para GET, y canWrite(role) del lado del
// SERVIDOR para POST.
//
// v0.0.9.30 -- rotacion. POST con { rotate: true, confirm: "ROTAR" }
// reemplaza la identidad existente por un par de claves nuevo. El campo
// confirm evita rotaciones accidentales (un doble click o un reintento del
// wizard no debe destruir la clave vigente). domain es opcional al rotar:
// si no viene, se reusa el de la identidad actual. Sin rotate, el
// comportamiento es el mismo de antes (409 si ya existe).

import { createSiteIdentityStore } from "../../../packages/apw-resolver/src/did-apw/store-factory.ts";
import { generateApwDid } from "../../../packages/apw-resolver/src/did-apw/generate.ts";

const SITE_ID = "default";
const ROTATE_CONFIRMATION = "ROTAR";

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

  const { domain, rotate, confirm } = body ?? {};
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
        message: `Este sitio ya tiene una identidad did:apw. Para reemplazarla, envia { rotate: true, confirm: "${ROTATE_CONFIRMATION}" }.`,
        identity: existing,
      },
      409
    );
  }

  const keyPair = await generateApwDid(domain);
  const record = await store.create(SITE_ID, keyPair, user.username);

  return json({ identity: record, didDocument: keyPair.didDocument, privateKeyJwk: keyPair.privateKeyJwk }, 201);
}
