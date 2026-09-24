#!/usr/bin/env node
// CLI de publicacion del lado "dnslink" de Protocol APW.
//
// Genera el valor exacto que un operador de sitio debe pegar como registro
// TXT en su proveedor de DNS bajo el nombre `_apw.<dominio>` -- no edita
// DNS de forma automatica (ningun proveedor de DNS tiene una API
// estandarizada comun), solo imprime el valor listo para copiar/pegar, y
// valida que el resultado no exceda el limite practico de un TXT record.
//
// Uso:
//   node packages/apw-resolver/src/dnslink/cli.mjs --site-id mi-sitio --content-kinds text,image
//
// Salida: nombre exacto del record (`_apw.<dominio ya resuelto por el DNS
// del propio proveedor, no se pide aqui>`) y el valor TXT a publicar.

import { buildApwManifest, serializeApwManifest } from "../manifest.js";

const PRACTICAL_TXT_BYTE_LIMIT = 512;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key) args[key] = value;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args["site-id"]) {
    console.error("Error: --site-id es obligatorio.");
    console.error("Uso: dnslink-cli --site-id <id> --content-kinds text,image,product,link,mixed");
    process.exitCode = 1;
    return;
  }

  const contentKinds = (args["content-kinds"] ?? "text")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const manifest = buildApwManifest({ siteId: args["site-id"], contentKinds });
  const serialized = serializeApwManifest(manifest);
  const byteLength = new TextEncoder().encode(serialized).length;

  console.log("Nombre del registro TXT a crear: _apw.<tu-dominio>");
  console.log("Valor exacto a publicar:");
  console.log(serialized);
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

main();
