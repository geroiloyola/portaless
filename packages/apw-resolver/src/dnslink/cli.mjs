#!/usr/bin/env node
// CLI de publicacion del lado "dnslink" de Protocol APW.
//
// Dos modos:
//
//   1. Manifiesto v1 (legacy): --site-id <id> [--content-kinds text,...]
//      Genera un manifiesto v1 sin identidad criptografica. Solo para
//      sitios sin did:apw.
//
//   2. Anclaje (v2): --anchor --domain <dominio>
//      AUTOMATIZA el calculo del TXT con `k` y `h` actuales: baja
//      https://<dominio>/.well-known/did.json (clave vigente) y
//      https://<dominio>/.well-known/apw-log.json (cabeza del historial
//      encadenado), arma el manifiesto v2 con buildSiteManifest() -- la
//      misma funcion que usa el checklist del panel y
//      /.well-known/apw-manifest.jws, para que TXT y manifiesto firmado
//      no puedan divergir -- e imprime el valor exacto a pegar en el
//      proveedor de DNS. Ningun proveedor de DNS tiene API estandarizada:
//      el paso de pegar el valor es manual; el calculo, no.
//
//   En ambos modos valida el limite practico de ~512 bytes de un TXT
//   record y no edita DNS de forma automatica.
//
// Uso (tsx, igual que el resto de los scripts del repo):
//   npx tsx packages/apw-resolver/src/dnslink/cli.mjs --site-id mi-sitio --content-kinds text,image
//   npx tsx packages/apw-resolver/src/dnslink/cli.mjs --anchor --domain ejemplo.com

import { buildApwManifest, serializeApwManifest } from "../manifest.ts";
import { buildSiteManifest } from "../did-apw/site-manifest.ts";
import { jwkThumbprint, publicJwkMembers } from "../did-apw/fingerprint.ts";

const PRACTICAL_TXT_BYTE_LIMIT = 512;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]?.replace(/^--/, "");
    if (!key) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function printTxt(name, value) {
  const byteLength = new TextEncoder().encode(value).length;
  console.log(`Nombre del registro TXT a crear: ${name}`);
  console.log("Valor exacto a publicar:");
  console.log(value);
  console.log("");
  console.log(`Tamano: ${byteLength} bytes (limite practico sin forzar TCP: ${PRACTICAL_TXT_BYTE_LIMIT} bytes).`);
  if (byteLength > PRACTICAL_TXT_BYTE_LIMIT) {
    console.error(
      `Advertencia: el payload excede el limite practico de ${PRACTICAL_TXT_BYTE_LIMIT} bytes. ` +
        "Reduce la cantidad de contentKinds declarados o el largo de siteId."
    );
    process.exitCode = 1;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

async function anchorMode(domain) {
  const host = String(domain).trim().toLowerCase().replace(/[.]$/, "");
  if (!host.includes(".")) {
    console.error("Error: --domain debe ser un hostname valido (ej: ejemplo.com).");
    process.exitCode = 1;
    return;
  }

  const didDoc = await fetchJson(`https://${host}/.well-known/did.json`);
  const method = didDoc?.verificationMethod?.[0];
  if (!didDoc?.id?.startsWith("did:apw:") || !method?.publicKeyJwk) {
    console.error(`Error: https://${host}/.well-known/did.json no publica una clave Ed25519 valida.`);
    process.exitCode = 1;
    return;
  }
  const k = await jwkThumbprint(publicJwkMembers(method.publicKeyJwk));

  const log = await fetchJson(`https://${host}/.well-known/apw-log.json?from=1&limit=1`);
  const h = log?.head?.hash ?? null;
  if (!h && (log?.length ?? 0) > 0) {
    console.error(`Error: https://${host}/.well-known/apw-log.json no informa la cabeza del historial.`);
    process.exitCode = 1;
    return;
  }

  const value = serializeApwManifest(buildSiteManifest(host, k, h));
  console.log(`Dominio: ${host}`);
  console.log(`k (clave de ${didDoc.id}): ${k}`);
  console.log(`h (cabeza del historial): ${h ?? "(sin historial: TXT sin h)"}`);
  console.log("");
  printTxt(`_apw.${host}`, value);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.anchor) {
    if (!args.domain) {
      console.error("Error: --anchor requiere --domain <dominio>.");
      process.exitCode = 1;
      return;
    }
    anchorMode(args.domain).catch((err) => {
      console.error(`Error: ${err?.message ?? err}`);
      process.exitCode = 1;
    });
    return;
  }

  if (!args["site-id"]) {
    console.error("Error: --site-id es obligatorio (o usa --anchor --domain <dominio>).");
    console.error("Uso: dnslink-cli --site-id <id> --content-kinds text,image,product,link,mixed");
    console.error("     dnslink-cli --anchor --domain <dominio>");
    process.exitCode = 1;
    return;
  }

  const contentKinds = String(args["content-kinds"] ?? "text")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const manifest = buildApwManifest({ siteId: args["site-id"], contentKinds });
  printTxt("_apw.<tu-dominio>", serializeApwManifest(manifest));
}

main();
