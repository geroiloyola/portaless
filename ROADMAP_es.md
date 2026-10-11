# Roadmap de Portaless

> **ARCHIVO HISTÓRICO (español).** La versión canónica y vigente está en inglés en [`ROADMAP.md`](./ROADMAP.md) (más corta y precisa). Este archivo se conserva íntegro por su mayor contexto y detalle; ante discrepancias manda la versión en inglés.

> **Fuente de verdad del estado ACTUAL** (octubre 2026, post reconciliación con la spec APW v1.3). Solo lo que es cierto hoy: qué está en producción, qué falta y de quién depende. El historial —tabla de PRs #1 a #75, registros de refactor, entradas cerradas con narrativa de sesión— está en [`docs/roadmap/ROADMAP-ARCHIVE.md`](./docs/roadmap/ROADMAP-ARCHIVE.md). El historial por release está en [`CHANGELOG.md`](./CHANGELOG.md). Ante cualquier discrepancia, manda este archivo.

## Leyenda

- [x] En producción: mergeado a `main`, funcional y verificable por commit.
- [~] Implementado, con un paso externo pendiente de verificación real.
- [ ] Pendiente.

## Estructura

Categorías por **quién** debe resolver la pieza, no por prioridad:

- **Funcionalidades en Produccion** — hecho y mergeado.
- **Funcionalidades Internas en Desarrollo** — depende solo de Portaless.
- **Funciones Externas** — depende de un tercero (proveedor de nube, procesador de pagos, otro proyecto).
- **Vision y decisiones de alcance** — secciones cortas que fijan qué Portaless **no** hará.

---

## Funcionalidades en Produccion

### Base del proyecto, autenticacion y licencias

- [x] Proteccion de `main`, autenticacion basica, roles `admin`/`viewer` con `canWrite(role)` en guard DOM y validacion server-side en todo el dashboard.
- [x] Licencias: core AGPL-3.0, especificacion Protocol APW CC BY 4.0 (`APW-SPEC-v1.3.md`, seccion Licencia y gobernanza) + Plugin SDK MIT (`docs/architecture/licensing-boundaries.md`).
- [x] Recuperacion de contrasena, 2FA (TOTP) y OAuth/SSO; step-up reforzado (contrasena + TOTP) para acciones sensibles.
- [x] Rutas publicas de `/admin/*` previas al login (allowlist exacta: 2FA, reset, OAuth), con tests de bypass.
- [x] Seguridad de cuenta: limite de intentos MFA, rate limit de password reset (IP + usuario, buckets hasheados), historial en `password_change_events`, cierre de todas las sesiones al cambiar o resetear la contrasena.

### Persistencia, instalacion y datos

- [x] Persistencia real D1/SQLite en todos los stores (paginas, permisos, ledger, usuarios, sesiones, challenges MFA, rate limits, identidad APW), con factories que fallan explicito en vez de degradar a memoria.
- [x] `schema.sql` maestro + `npm run setup` (esquema + admin inicial en un comando); equivalente D1 via `npm run setup:d1`.

### Plugin sandbox, capacidades y Capability Bridge

- [x] Adaptador `isolated-vm` con pool de isolates reutilizables — *Pool de isolates reutilizables* para el commerce-plugin, con aislamiento real de Context por ejecucion.
- [x] 12/12 capacidades de plugins del catalogo con puente real al isolate (las capacidades no-plugin del catalogo, `billing:pay-per-crawl` y `trust:read-governance-bypass`, no son del sandbox y no tienen puente).
- [x] *Refactorizar capability-bridge.js para tokens efimeros*: el bridge valida `CapabilityTokenStore` (TTL 5 min, scope por `plugin_name`, snapshot inmutable de capacidades); `PORTALESS_INTERNAL_BRIDGE_TOKEN` quedo obsoleta.
- [x] `createSandboxRuntime()`: factory de produccion que inyecta el mismo token store que valida el bridge.
- [x] Commerce-plugin respeta el Centro de Permisos (interseccion concedido ∩ manifiesto, leida en cada llamada).
- [x] Registro dinamico de plugins con `trustScore` comunitario, persistido y con UI de insignia en el Centro de Permisos.

### Trust Layer, identidad y Protocol APW

- [x] Web Bot Auth (RFC 9421, Ed25519) con reglas draft-03 compartidas por middleware y SiteTrustScore, cache de directorio de claves y unicidad de nonce — *Cache del directorio de claves Web Bot Auth + verificacion de unicidad de nonce*. Limite vigente: nonces en memoria por proceso (proteccion anti-replay parcial entre multiples isolates/instancias).
- [x] ML-DSA (FIPS 204) experimental en la fuente `agent` de SiteTrustScore. El middleware sigue solo Ed25519.
- [x] SiteTrustScore con las 4 fuentes (`self`, `agent`, `community`, `escrow_report`) y ciclo completo de alta/revocacion de `authorized_agents` y escrow providers desde el panel. La clave publica Ed25519 (JWK) del proveedor se carga, cambia, copia o quita desde `/admin/authorized-escrow-providers` sin rotar su API key (`setPublicKey()` en el store, `PUT` en el endpoint, validacion doble navegador+servidor, rechazo de claves con `d`); sin ella el proveedor queda autorizado pero sus reportes firmados se rechazan (`escrow-report.js` exige la clave). Limite vigente: allowlists vacias por defecto, sin datos de produccion; `community` es senal local no verificable (B7).
- [x] Pay-per-crawl con proveedores intercambiables (`cloudflare-pay-per-crawl`): `crawler-price` in-band y activacion solo con token de Cloudflare verificado + step-up + identidad APW. Sin proveedor activo, `charge` responde 402 `settlement: "not_available"`. Pendiente externo: prueba contra zona real (ver Funciones Externas).
- [x] **Protocol APW v1.3 completo** (spec normativa: [`docs/protocol-apw/APW-SPEC-v1.3.md`](./docs/protocol-apw/APW-SPEC-v1.3.md); vectores: [`APW-VECTORS-v1.3.md`](./docs/protocol-apw/APW-VECTORS-v1.3.md)): resolucion DNS-over-HTTPS del TXT `_apw.`, manifiesto v1/v2 (`k`, `h`, `rg`), identidad `did:apw` con historial de claves y rotacion, `/.well-known/did.json`, JWS del sitio con JCS (`/.well-known/apw-manifest.jws`), atestaciones firmadas de `agent`, `escrow_report` y `self`, historial encadenado anclado en el DNS (`/.well-known/apw-log.json`), paquete de atestaciones (`/.well-known/apw-attestations.json`), puntuacion por dimensiones (Anexo A) con calibracion R-05, politica de lectura fail-closed (`site_trust_read_policies`) y reputacion del lector `reader_conduct` con completitud y emision desde el ledger. Cierra B1-B6 y B9 de la spec; B7 (`community` portable) queda abierta.
- [x] **Override de visibilidad por dimension (A.6)**: el dueno puede volver publica una dimension **gobernada** con un override explicito, guardado en la columna nueva `public_overrides` de `site_trust_read_policies` (JSON array, ordenado y sin duplicados, se agrega sola con `ALTER TABLE` a bases existentes). `GET /trust/:siteId` lo pasa a `projectTrustView()`: al rechazar, `public.projection.dimensions` trae el conjunto publico **mas** las dimensiones del override, y el resto del nivel gobernado sigue oculto. No cambia la politica ni el acceso, y no se puede ocultar el nivel publico. Solo dimensiones gobernadas: `W-01` o una desconocida rechazan el guardado.
- [x] **Testigos externos (ERRATA E-10, spec 5.7)**: cualquier sitio con identidad observa la cadena de otro y publica un statement firmado (`apw-witness+jws`, `jti` determinista) en `/.well-known/apw-witnesses.json`, anotado en su propio historial encadenado (fecha creible = su `ts` en la cadena del testigo, anclada por su `h`). Evaluacion fail-closed: `head_mismatch`, `equivocation`, `backdated_entry`. `POST /admin/api/witness/record` para registrar observaciones. No cubre omision inicial (queda para Portaless Index).
- [x] **Anclaje de `h` semi-automatico**: calculo del TXT v2 con `k`+`h` vivos en un comando (`dnslink/cli.mjs --anchor --domain`) y en el checklist del panel (`anchor: { status, publishedH, localH, localSeq }`); testigos anclan la cabeza sin tocar el DNS. El paso de pegar el TXT en el proveedor sigue manual (sin API de DNS estandarizada).
- [x] **Emision automatica de `reader_conduct`**: el middleware del Trust Layer la dispara al registrar un acceso verificado (jti determinista, indice `reader_conduct_jti` con siembra desde el historial, throttle por isolate, opt-out `APW_AUTO_EMIT_CONDUCT=false`). El endpoint admin con step-up queda para backfill. El ledger ahora tambien registra accesos `allow` (antes solo bloqueados/cobrados).
- [x] **`schema.sql` maestro regenerado (v0.0.9.31)** con `usage_ledger.reader_did` y la tabla `reader_conduct_jti`. El generador quedo reescrito con las 13 fuentes reales en orden (5 `schema.sql` de paquete + 8 secciones en `schema-additions/`, que es donde ahora viven las tablas sin paquete): antes solo conocia 4 fuentes y regenerar habria borrado 17 tablas. Regeneracion idempotente y verificada contra SQLite (25 tablas, doble aplicacion segura por `IF NOT EXISTS`); las bases existentes reciben ambos cambios al vuelo desde sus stores.
- [x] **Excepcion por lector (spec 6.5, cierre de E-8)**: el Centro de Permisos concede `trust:read-governance-bypass` sobre el DID de un lector (subject `reader`); `GET /trust/:siteId` lo deja pasar aunque no cumpla los umbrales de reputacion. No salta la identidad APW (6.3) ni una politica corrupta, y si el store de grants no se puede leer no hay bypass. Alta y revocacion en `/admin/permissions` (PUT rechaza DID mal formado o capacidades que no sean el bypass para un subject `reader`).
- [x] **Claves no activas del lector (spec 6.3)**: una firma cuya huella no es `k` se acepta si la clave esta en el historial verificado del lector, firmo al menos una entrada de la cadena y su ventana `[validFrom, validTo + 10 min de gracia]` cubre el momento de la request; si no, `apw_unresolvable: key_not_bound_to_apw` y el TTL del cache se acota al cierre de la ventana. La emision de `reader_conduct` sigue exigiendo `k`: en rollover se lee, no se puntua.
- [x] **Proyeccion de las dimensiones W publicas (spec 6.6, cierra E-8)**: `GET /trust/:siteId` calcula las W del sitio desde su snapshot (`scoring/site-dimensions.ts`, A.2/A.4) y las publica siempre en `projection { dimensions, aggregates, governed }`. Al rechazar, `public.projection` trae solo el conjunto publico (W-01, W-04, W-06, W-07, W-09) mas los agregados de todas las dimensiones; al permitir (o sin politica), todas las dimensiones con `governed: "granted"`. W-09 es derivado (A.5); una dimension sin atestaciones no aparece. Sin modelo no puntua (`perceived_trustworthiness`, filas legacy).

### Atomic Elements, Editor Visual y SEO

- [x] Editor Visual integrado en el panel (`/admin/editor`) con render real de bloques en el canvas, vista previa de ProductGrid via Medusa/Mercur y listado de paginas (`GET /admin/pages`).
- [x] 4 elementos link-en-bio (`ProfileHeader`, `LinkList`, `SocialIcons`, `StoreBlock`) aceptados por editor, palette y MCP server.
- [x] Reordenamiento por arrastre y anidamiento en columnas.
- [x] SEO/GEO nativo (JsonLd, SeoHead, canonical).
- [x] IA discovery: `/llms.txt` (llmstxt.org v2), markdown por post (`/blog/<id>.md`), `robots.txt` unico generado por el Trust Layer con Content Signals, sitemap completo; borradores no publicados dan 404.

### MCP server

- [x] 7 tools reales conectadas (`create_page`, `update_page`, `list_page_components`, `query_usage_log`, `list_installed_plugins`, `grant_capability`, `revoke_permission`) sobre stores reales (D1/SQLite). Limite vigente: la identidad del agente se resuelve una vez por proceso (`MCP_AGENT_KEY`), no por invocacion — ver Internas.

### Onboarding

- [x] Wizard de 5 pasos end-to-end: intencion del sitio (plantillas deterministas), OAuth de infraestructura (GitHub App, PKCE, refresh automatico), generacion y exportacion una sola vez de la identidad `did:apw`, credenciales de admin.
- [x] Checklist diferido en el dashboard: banner de verificacion APW con el TXT exacto para copiar, aviso de propagacion DNS, nunca bloqueante.
- [x] First-run `/setup` sin terminal (setup code de un solo uso) en el runtime Node.

### Calidad continua (CI/CD)

- [x] CI real en Node 24 (`npm test` bloquea), validacion de manifiestos con el mismo `validateManifest()` de produccion.
- [x] Full Tests con cobertura (linea de base 47.43% lineas; minimos 45/44/46/40) y smoke de `npm run setup`.
- [x] Job `docker-smoke` (arranque, setup, reinicio, bloqueo del segundo setup).

### Self-host (Ready)

- [x] Runtime Node para Pages Functions (routing, middleware por prefijo, `env.ASSETS`, `/healthz`, paridad de metodo y 404), sin fallback silencioso a memoria.
- [x] `better-sqlite3` en todos los stores; `engines.node >= 24`.
- [x] Contenedor Docker multi-stage + `docker-compose.yml`, `railway.json` y `render.yaml` con volumen `/data`.

---

## Funcionalidades Internas en Desarrollo

Responsabilidad exclusiva de Portaless: no depende de ningun tercero.

### Protocol APW (pendientes de la spec v1.3)

- [x] **Portaless Index: agregador de testigos (5.7, slice local)**: `witness-index.ts` + `witness-index-store.ts` (tablas `witness_observations`, `witness_weights`, `witness_index_subjects`; D1/SQLite/InMemory), `POST /admin/api/index/sync` y `GET /admin/api/index/subjects` (rol admin) y `GET /.well-known/apw-index.json` (documento plano re-verificable). Pull de los testigos configurados con verificacion fail-closed de punta a punta (cadena del testigo verificada, `att` anclado, firma, `jti` determinista), evaluacion `head_mismatch`/`equivocation`/`backdated_entry` y consenso ponderado por peso estatico (default 1.0). Fuera de alcance, documentado en la spec 5.7/7: calibracion de pesos estilo A.4.4, gossip entre nodos indice y agregacion de manifiestos/SiteTrustScore (descubrimiento).
- [ ] **Activar R-05 en politicas** (`reader-conduct-config.ts`): bloqueado por datos, no por config. R-05 del lector es la calibracion de las atestaciones que **el** emite (A.4.4) y `loadReaderConduct` solo trae las que **recibio**, asi que hoy todo lector tiene R-05 = 4.0 con peso 0: encender `policyDimensions["R-05"]` rechazaria a TODOS los lectores (403), no a los malos. Faltan (1) un flujo en que el lector emita atestaciones sobre sujetos (hoy solo hay voto community anonimo por IP, sin DID) y (2) un corpus de otros emisores sobre el mismo (sujeto, dimension) para el consenso leave-one-out de A.4.4 — indices o testigos (spec seccion 7). El bloqueo esta anclado en `tests/unit/apw-reader-conduct-config.test.ts` y documentado en la spec 6.5 y en ERRATA E-9.
- [ ] **Senales `rate_respected`, `paid_as_agreed`, `redistribution`** (`CONDUCT_RULES` en `reader-conduct-config.ts`, spec 6.4): bloqueadas por dato, no por codigo. El ledger solo registra `requests_total` y `policy_violations_detected` (`log-writer.ts`) y el middleware pasa `charged: false` en los cuatro caminos (`_middleware.js:131,140,146,164`). Cada una espera lo suyo: `rate_respected` una tasa en la politica de contenido (hoy `PolicyRule` solo tiene `access`/`price_usd`/`unit`) con su enforcement y contador de rechazos; `paid_as_agreed` un settlement que le informe al origen si el crawler pago (el unico actual, Cloudflare PPC in-band, liquida fuera: "el origen no sabe si el crawler pago", `cloudflare.ts`), y `redistribution` testigos o denuncia porque el origen no la observa. Anclado en `tests/unit/apw-reader-conduct-config.test.ts`.

### Seguridad, sandbox e identidad de agentes

- [ ] Caller de produccion de `createSandboxRuntime()` para adaptadores edge (el unico plugin en produccion corre en isolated-vm, que no usa tokens HTTP).
- [ ] ML-DSA en el middleware (`webbotauth/verify.ts`), no solo en la fuente `agent`.
- [ ] Nonces de Web Bot Auth compartidos entre instancias (D1/SQLite con TTL, patron `auth_mfa_challenges`).
- [ ] Incorporar `settlement_provider_activations` al `schema.sql` maestro y a `REQUIRED_TABLES`.
- [ ] Proxy confiable para `X-Forwarded-For` en self-host (rate limit de reset).
- [ ] Verificacion reforzada por email para acciones sensibles (bloqueado por falta de backend `email:send`).
- [ ] Tests de navegador (Playwright) para `/admin/security`, `/admin/wizard/rotate-identity` y el Paso 4 del wizard.
- [ ] Subir los minimos de cobertura de Full Tests de 45/44/46/40 hacia 60-70%, sin bajarlos nunca.
- [ ] MCP server: identidad de agente por invocacion (hoy es por proceso; riesgo de seguridad activo documentado en `AGENT.md`).
- [ ] Identidad AT Protocol (`packages/identity-atproto/` sigue siendo stub).

### Cloud Images

- [ ] Portaless Cloud Images — ver [Portaless Cloud Images y APW como SSOT criptografico](#portaless-cloud-images-y-apw-como-ssot-criptografico).

---

## Funciones Externas

Depende de un tercero para completarse. Portaless expone el protocolo o el contrato tecnico; la pieza se construye y mantiene fuera.

- [~] Pay-per-crawl real: probar contra una zona de Cloudflare con Pay Per Crawl habilitado y dynamic pricing; confirmar el precio minimo (asumido USD 0.01). Hoy solo tests con mocks.
- [~] Deno Deploy y Cloudflare Workers for Platforms: llamadas reales a las APIs implementadas y testeadas con `fetch` mockeado; faltan credenciales de cuenta real. En Cloudflare se requiere ademas el Worker "dispatcher" fijo por namespace (infraestructura fuera del repo). Fastly sigue en estado de contrato + TODOs.
- [ ] Segundo proveedor real de `escrow_report` (la UI de alta ya incluye el campo de clave publica Ed25519; falta el alta real de un segundo proveedor y su onboarding).
- [ ] Integracion de almacenamiento externo (Cloudflare R2 es el candidato) para Portaless Cloud Images.
- [ ] Agente raiz de lenguaje natural y lenguaje de intencion humana (Nuvid): via SDK externo, ver seccion de alcance.
- [ ] AppPlace y AppLibre: proyectos aparte, ver seccion de alcance.

---

## Vision y decisiones de alcance

### Ecosistema de plugins: abierto por defecto, regulado por la comunidad

Catalogo abierto (`sourceType: "open" | "closed"`): Portaless no certifica ni audita plugins. Aporta un `trustScore` comunitario publico y auditable (votos 1-5 en `plugin_trust_votes`, insignia en el Centro de Permisos) y `auditedBy` como dato informativo. El sandbox limita lo que un plugin **puede** hacer; no certifica que haga lo que dice.

### Trust Layer y Pay per Crawl: protocolo abierto, no asegurador

Portaless define y expone el protocolo (identificacion criptografica de agentes, politicas `allow`/`charge`/`block`, ledger publico). **No asegura cobros ni procesa dinero**: eso requiere licencias y cumplimiento regulatorio de una entidad financiera. Terceros construyen su capa de cobro sobre el protocolo; son candidatos a AppPlace como proyectos independientes, nunca parte del core.

### Agente generador de sitios: via SDK externo, no interno

El agente raiz de lenguaje natural y el lenguaje de intencion humana (Nuvid) se conectan via SDK con un proyecto aparte, al igual que el Plugin SDK (MIT). Portaless (AGPL-3.0) no depende en su nucleo de un proyecto mas experimental, y no mezcla licencias ni ciclos de release.

### AppPlace y AppLibre: proyectos aparte, asociados oficiales

Marketplace cerrado (AppPlace) y registro comunitario (AppLibre) seran proyectos aparte con estatus de asociado oficial. Ninguno de los dos — ni Portaless — garantiza la calidad de plugins de terceros: el sandbox es contencion tecnica, no certificacion.

### Portaless Index: descubrimiento entre sitios

Capa futura que agrega manifiestos y SiteTrustScore de multiples instancias sin custodiar contenido. El **agregador de testigos** de APW ya existe (ver el pendiente de APW resuelto mas arriba: `witness-index.ts` + `/.well-known/apw-index.json`); del descubrimiento entre sitios siguen faltando: formato de indexabilidad (reutilizando el TXT APW), permiso de consulta de terceros (publico / con atribucion / via settlement), mecanismo de agregacion de manifiestos y capa de procedencia antes de tratar el voto comunitario como suficiente.

### Onboarding de un click: Wizard + Checklist diferido

Principio rector vigente: lo que depende de un tercero (propagacion DNS, infraestructura ajena) vive en el checklist diferido del dashboard, nunca en un wizard bloqueante. La estructura (wizard de 5 pasos + checklist) esta implementada; ver Onboarding en Produccion. Pendientes internos: verificacion visual del borrador del Paso 1, textos genericos fuera del campo de intencion, y OAuth de Cloudflare Pages (hoy solo GitHub).

### Portaless Cloud Images y APW como SSOT criptografico

Extension futura: hosting de imagenes donde cada imagen publica firma Ed25519 del sitio, timestamp criptografico de existencia, referencia al SiteTrustScore del momento y flag de origen declarado (`human` | `ai` | `mixed`) — C2PA sin autoridad central, verificable contra el registro APW. La columna `key_algorithm` ya prepara la migracion a ML-DSA sin perder la cadena de custodia. No existe ni como stub; las piezas del core que lo habilitan (Web Bot Auth, SiteTrustScore, settlement, crypto-agilidad) ya estan.

**Tareas para iniciarla:**

- [ ] Especificar el formato de metadatos de imagen APW (`docs/protocol-apw/image-metadata-spec.md`).
- [ ] Definir el embebido en formatos comunes (EXIF, chunk PNG, sidecar).
- [ ] Evaluar Cloudflare R2 como backend inicial.
- [ ] Endpoint de subida con firma automatica (`functions/api/images/upload.js`).
- [ ] Endpoint publico de verificacion (`functions/api/images/verify/[imageId].js`).
- [ ] Modelo de moderacion de imagenes mal declaradas, sin centralizar la decision.

---

## Tareas manuales pendientes

Solo las que siguen abiertas (el historial de tareas cerradas/obsoletas esta en el archivo).

1. Verificar en GitHub Settings que `main` tenga *Require status checks to pass before merging* con los checks `build` y "Todos los tests + cobertura (Node 24)" requeridos.
1. Conceder `network:fetch` a `commerce-plugin` en `/admin/permissions` tras actualizar: sin eso la tienda muestra el catalogo vacio (comportamiento correcto desde el PR #55).
1. Volver a conectar la GitHub App del Paso 2 del wizard: credenciales guardadas antes del PR #61 tienen dueno `"undefined"` y quedan huerfanas.
1. Probar el flujo de onboarding completo contra una cuenta real de GitHub y un dominio real con TXT `_apw.` publicado (TXT v2 con `k` y `h`, `did.json`, `apw-log.json`, `resolveApwHistory`).
1. Dar de alta un proveedor de escrow con clave publica y enviar un reporte firmado.
1. Probar Pay Per Crawl contra una zona real de Cloudflare (activar en `/admin/settlement`, manifiesto con `settlement_provider` y `price_usd >= 0.01`, comprobar el cobro con `crawler-price`).
1. Desplegar en Railway y Render reales siguiendo `docs/self-hosting-verification.md`.
1. Probar a mano `/admin/security`, `/admin/wizard/rotate-identity` y el link de rotacion del Paso 4.
1. Revisar el log del job `build` del PR #56 (tardo 19s vs 1.5-3 min) y confirmar que corrio todo.
1. Al regenerar `package-lock.json` en Windows, usar npm reciente (`npx npm@11 install --package-lock-only`): npm 11.6 omitio dependencias opcionales y `npm ci` fallo en Linux.
