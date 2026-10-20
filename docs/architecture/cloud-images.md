# Cloud Images + APW como SSOT criptografico — Estado Real

**Implementado como base usable (v0.0.9.10).**
`packages/cloud-images/` implementa el lado criptografico de "C2PA sin
autoridad central": cada imagen publicada por el sitio lleva su propia
metadata firmada (sidecar JWS Ed25519), un timestamp de existencia
dentro de lo firmado, la SiteTrustScore publica contemporanea y una
declaracion de origen (`human` | `ai` | `mixed`). Cualquiera con el
sidecar la verifica contra el registro APW sin pedirle permiso a nadie.

Lo que NO esta aqui (por decision, no por deuda): almacenamiento R2
(item externo del ROADMAP), moderacion de declaraciones falsas, EXIF,
UI de administracion, multi-tenant. Cada limite esta listado abajo.

## Que esta implementado hoy

En `packages/cloud-images/src/`:

- `payload.ts` — el formato **Cloud Image v1**: `CloudImagePayload`
  (`v: 1`, `imageId`, `contentHash` = `sha256:<hex>` de los bytes **sin**
  el sidecar, `contentType`, `byteLength`, `declaredOrigin`, `siteId`,
  `siteDid`, `signedAt`, `keyAlgorithm: "ed25519"`, `trust`) y el sidecar
  `{ payload, jws }`. Parseo defensivo (`validatePayload`/`parseSidecar`
  devuelven `null` ante cualquier shape hostil) y construccion con
  validacion estricta (`buildCloudImagePayload` lanza ante inputs
  invalidos). Teto `MAX_IMAGE_BYTES` = 4 MiB.
- `sign.ts` — firma y verificacion del sidecar: `signCloudImage()`
  reusa `signSiteJws` de `apw-resolver` (JCS RFC 8785, Ed25519) con
  `typ: "apw-image+jws"`; `verifyCloudImageSidecar()` selecciona la
  clave por `kid`, verifica la firma y exige que el payload del sidecar
  sea **byte-identico** (JCS) al payload dentro del JWS (un payload
  alterado post-firma no pasa). El `kid` del header debe pertenecer al
  `siteDid` del payload: un sidecar firmado por otro sitio no se
  re-etiqueta. Acepta `kid` legacy por huella RFC 7638 (mismo matching
  que el historial, post-PR#71).
- `png.ts` — embedding del sidecar en un chunk privado **`pAPW`** del
  propio PNG (nombre valido segun la spec PNG 5.4: privado/estandar,
  `safe-to-copy`): `embedPng` (inserta antes de IEND o reemplaza uno
  existente), `extractPng` (CRC verificado; corrupto = ausente),
  `stripPng` (devuelve los bytes originales byte a byte — sobre esos
  bytes se calcula el `contentHash`). Formato portable: la imagen viaja
  sola y se lleva su metadata firmada adentro.
- `store.ts` — registro `cloud_images` (metadata + bytes en una fila,
  `content_hash` UNICO) con los tres backends del repo (D1 / SQLite /
  InMemory) y factory `createCloudImageStore(env)` (DB -> D1,
  `PORTALESS_SQLITE_PATH` -> SQLite, si no InMemory con warning). El
  desacople a R2 queda documentado: mover los bytes a un bucket = misma
  interface de bytes + migrar la columna, sin tocar formato ni endpoints.
- `trust.ts` — `captureSiteTrust()`: captura de la SiteTrustScore
  **publica contemporanea** que va dentro del payload firmado
  (`scoreSiteDimensions` + `projectTrustView` en modo solo-publico, el
  mismo join que `/trust/:siteId`). Nunca lanza: si el store no se lee,
  el payload se firma con `trust: null` (la firma no depende de la
  reputacion).
- `verify-remote.ts` — `verifySidecarRemote()`: verificacion
  **standalone** de un sidecar desconocido. Resuelve las claves del sitio
  en el historial encadenado (`resolveApwHistory` con `includeKeys` —
  incluye claves retiradas, asi una imagen firmada hace meses sigue
  verificable tras rotaciones), con fallback a `did.json` si el sitio no
  tiene historial aun; verifica firma + payload canonico y, opcionalmente,
  `sha256(imagen) == contentHash` (acepta la imagen original o la ya
  embebida: hace `stripPng` antes de hashear). Nunca lanza: todo fallo
  vuelve como `reason` estructurado.

Endpoints:

- `POST/GET/DELETE /admin/api/cloud-images`
  (`functions/admin/api/cloud-images.js`) — sesion + rol `admin`
  server-side. `POST { imageBase64, declaredOrigin }` **firma en el
  servidor** con la clave activa (`getActiveSigningKey("default")`),
  captura el trust, embebe el sidecar (`pAPW`) y registra. Sin identidad
  `did:apw` activa -> 404 `site_identity_not_found` (mismo codigo que
  `witness/record.js`). Solo `image/png` (v1), teto 4 MiB, y **dedupe
  por `content_hash`**: repetir la MISMA imagen devuelve la registrada
  (`deduplicated: true`) en vez de chocar con el indice unico.
- `GET /images/:imageId` (`functions/images/[imageId].js`) — serve
  publico de los bytes (con el sidecar ya embebido). `ETag` =
  `contentHash`, cache `immutable` a un anio (una imagen registrada
  nunca cambia), 304 con `If-None-Match`, CORS `*`.
- `GET /trust/images/:imageId` (`functions/trust/images/[imageId].js`)
  — verificacion publica **local**: firma contra `listKeys` de
  `site_identity` (incluye claves retiradas -> sobrevive rotaciones),
  chunk embebido vs sidecar del registro, y
  `sha256(stripPng(bytes))` vs `contentHash`. Devuelve la metadata +
  `sidecar` completo. Cache corta, CORS `*`.
- `POST /trust/images/verify` (`functions/trust/images/verify.js`) —
  verificacion **standalone** publica: `{ sidecar, imageBase64? }` ->
  `verifySidecarRemote()` contra el registro APW (resolucion remota del
  historial/did.json del sitio). 200 siempre con el resultado
  estructurado (nunca lanza), CORS `*`, `no-store`.

## SVRI y artefactos firmados (contrato requerido)

Una imagen firmada es una **proyeccion congelada** de la evidencia del sitio en
el instante de la firma. Por eso el sidecar JWS de Cloud Image v1 debe incluir,
dentro del payload firmado, el nivel SVRI publico contemporaneo:

```json
{
  "trust": {
    "siteId": "default",
    "counts": { "self": 0, "agent": 0, "community": 0, "escrowReports": 0 },
    "projection": { "dimensions": {}, "aggregates": {}, "governed": "withheld" },
    "svri": { "version": "1.0", "publicLevel": "pending" },
    "computedAt": "2026-10-20T00:00:00.000Z"
  }
}
```

Reglas normativas del artefacto:

- `trust.svri` se captura **al firmar** y queda cubierto por la firma Ed25519
  como cualquier otro campo del payload. Un cambio posterior del SVRI del sitio
  no reescribe el sidecar: la imagen acredita el nivel que existia cuando se
  firmo, no el nivel actual.
- Solo viaja el nivel cualitativo (`version` + `publicLevel`). El score
  numerico, los conteos T1–T5, `priorShare` y HSVR siguen siendo
  administrativos y **nunca** se embeben en un artefacto publico.
- Si el SVRI no puede calcularse, el campo se omite o vale `null`; la
  verificacion debe informar "SVRI no disponible" y **no** inventar
  `pending` como si fuera una medicion. La firma de la imagen no depende del
  SVRI: la procedencia criptografica de los bytes sigue siendo valida.
- Un verificador externo puede comprobar la firma y el `contentHash` sin
  confiar en el sitio; el nivel SVRI embebido es una declaracion firmada del
  emisor en ese instante, no una garantia de verdad ni una evaluacion actual.

**Estado actual:** `captureSiteTrust()` ya firma `trust.projection` (agregados
APW §6.6 en modo solo-publico) y los conteos, pero todavia no agrega
`trust.svri`; ese campo es el delta requerido para que el contrato anterior se
cumpla. Anadirlo no cambia el formato `v: 1`, no invalida sidecars existentes y
debe hacerse antes de declarar Cloud Images alineado con SVRI.

## Como se verifica una imagen (tres caminos)

1. **El sitio la sirve**: `GET /trust/images/:imageId` — verificacion
   contra el registro local del propio sitio.
2. **La imagen viaja sola**: el chunk `pAPW` trae el sidecar adentro;
   se extrae (`extractPng`) y se verifica con `POST /trust/images/verify`
   (o `verifySidecarRemote` en cualquier cliente: solo necesita el
   sidecar y resolver el registro APW del `siteDid`).
3. **Sidecar en un `.json` aparte** (futuro R2/CDN): mismo camino 2,
   el sidecar es la fuente.

## Limites honestos

- **Solo `image/png` en v1**: el embedding `pAPW` existe para PNG;
  jpeg/webp/gif estan en el formato (`ALLOWED_CONTENT_TYPES`) pero no
  tienen transporte de sidecar aun. Subir otro tipo -> 400
  `unsupported_content_type`.
- **4 MiB en base de datos**: suficiente para paginas; imagenes grandes
  requieren R2 (item externo del ROADMAP, `ImageStorage` ya es la
  separacion conceptual).
- **`declaredOrigin` es declaracion, no deteccion**: el sitio declara
  `human|ai|mixed` y esa declaracion va firmada; la moderacion de
  declaraciones falsas es trabajo futuro (misma filosofia que el
  resto del trust layer: exponer datos audibles, no certificarlos).
- **Sin UI**: la subida es via API (`POST /admin/api/cloud-images`).
- **Sin confidencialidad**: los bytes son publicos por diseno (serve
  abierto); la firma autentica origen, no encripta.
- **EXIF**: no se lee ni se elimina. Un subidor puede incluir metadatos
  EXIF arbitrarios dentro de los bytes firmados (quedarian cubiertos por
  el `contentHash`, pero la verificacion no los interpreta).

## Tests

`tests/unit/cloud-images-payload.test.ts` (14) — formato, firma y todos
los motivos de fallo; `cloud-images-png.test.ts` (5) — embed/extract/strip
con CRC y casos rotos; `cloud-images-store.test.ts` (8) — 3 backends con
contrato identico + factory; `cloud-images-verify-remote.test.ts` (14) —
registro como SSOT (historial, fallback did.json, kid cross-site, hash)
y captura de trust; `admin-cloud-images-endpoint.test.ts` (7) — upload
end-to-end con identidad real (sqlite temporal), validaciones, dedupe;
`cloud-images-public-endpoints.test.ts` (6) — serve + verificacion local
incluida rotacion de clave; `trust-images-verify-endpoint.test.ts` (3) —
contrato del endpoint standalone.
