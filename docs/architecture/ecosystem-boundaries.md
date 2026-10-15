# Fronteras del ecosistema — que vive en Portaless y que no

> Estado: decision registrada el **2026-10-15**. Este documento responde una
> sola pregunta — *de que repo es cada modulo* — y no la sustituye a ninguna
> otra. Si el lector busca el argumento legal de por que un modulo cerrado
> puede convivir con el core, ese esta en
> [`licensing-boundaries.md`](./licensing-boundaries.md), y manda el.

## 0. Regla de desempate

Este documento describe **reparto de trabajo entre repositorios**. No describe
licencias, ni Obligations legales, ni garantias.

- Si este documento y [`licensing-boundaries.md`](./licensing-boundaries.md)
  discrepan, **manda `licensing-boundaries.md`**: es el que tiene consecuencia
  legal, y este se corrige.
- Si este documento y el codigo discrepan, **manda el codigo** y este es el
  bug. Las referencias a archivos y numeros de linea de aqui son a proposito
  verificables con `grep`.

## 1. El reparto

### 1.1 Portaless OS — nucleo abierto (AGPL-3.0, este repositorio)

| Capa | Modulo | Que es exactamente | Donde vive hoy |
| --- | --- | --- | --- |
| **Protocolos** | APW | La especificacion (texto, CC BY 4.0), la identidad `did:apw`, el historial encadenado, las firmas, Cloud Images | `docs/protocol-apw/`, `packages/apw-resolver/`, `packages/cloud-images/` |
| | LTP | La capa de reputacion: SiteTrustScore de 4 fuentes, testigos, calibracion de pesos, ledger publico | `packages/trust-layer/`, `packages/apw-resolver/src/did-apw/witness.ts` |
| | Portaless Index | Agregador de testigos, consenso ponderado, sync entre pares, exposicion `.well-known/` | `packages/apw-resolver/src/did-apw/witness-index.ts`, `functions/.well-known/` |
| **Kernel** | Catalogo y render | Atomic Elements (17 tipos), element packs, theme packs, renderer con soporte de subpath | `packages/atomic-elements/` |
| | Permisos | Centro de Permisos, capabilities,jezz de permisos | `packages/permissions/` |
| | Sandbox | Aislamiento real (`isolated-vm` + adaptadores edge), manifiesto, registro, capability bridge | `packages/plugin-sandbox/` |
| | Autenticacion | Login, MFA/TOTP, recuperacion, OAuth, roles | `packages/auth/`, `functions/admin/login*.js` |
| | Publicacion | Engine de despliegue (GitHub Pages), OAuth del sitio, cifrado de credenciales | `packages/deploy-engine/`, `functions/admin/api/oauth/github/` |
| | **MCP server** | La superficie que los agentes consume para operar un sitio: 12 tools, stdio y HTTP, tokens por agente | `packages/mcp-server/` |
| **Modulos** | Posts | Coleccion `.md` canonica, RSS, orden por fecha | `src/content/posts/`, `src/lib/rss.ts` |
| | Recents | Dashboard unificado de actividad reciente | `packages/dashboard/` |
| | Videos | Hub audiovisual: el elemento `Video` ya existe (embed); el canal, el collector y el ranking, no | `packages/atomic-elements/src/elements/registry.ts:244` |
| | Music | Consolidador de streaming; **hoy no existe codigo** — solo enlaces estaticos en los JSON de ejemplo | — |
| | Shop | Comercio **de solo lectura**: catalogo Medusa/Mercur y tarjetas de afiliado. **Checkout y pagos no viven aqui** | `src/commerce/`, `packages/commerce-plugin/`, `src/pages/tienda/` |
| | Explore | Descubrimiento. **Hoy es local**: globa `src/content/pages/*.json` del propio repo. La capa federada es trabajo futuro | `src/pages/explore.astro:21` |
| **Confianza** | Veraciers | Identidad, voto y calibracion. **La tabla de votos ya existe** con escala 1–5, comentario libre y fecha; lo que falta es la atribucion criptografica y la pagina publica de cada uno — mientras tanto `"92 Veraciers activos"` sigue siendo un string literal (ver 2.3) | `schema.sql:319`, `src/pages/trust/index.astro:119,128` |

### 1.2 Fuera de este repositorio — capa comercial (Linstark)

| Producto | Que es | Por que no vive en Portaless |
| --- | --- | --- |
| **Linstark Cloudum** | Hosting administrado, single-tenant y soberano: aprovisiona, despliega y mantiene nodos en linea | Es operacion de infraestructura con SLA. El core no tiene —y por decision no quiere tener— un plano de control |
| **Linstark LinsWork** | Modulo premium que convierte un perfil en una plataforma transaccional | Es codigo cerrado. Corre como **plugin dentro del sandbox**, que es justamente el mecanismo que lo hace legal sin abrir el core |
| **Tenantless (Portaless Corp OS)** | Orquestacion de flotas corporativas via MCP | Es un **cliente** del MCP de Portaless y una consola de flota. El servidor MCP es del core; la flota no |
| **Ecomless (Portaless Partner OS)** | Inventario avanzado y facturacion local para Pymes y agencias | Extiende Shop hacia atras. El core mantiene la lectura de catalogo; el resto es del producto |

La division no es "lo importante" vs "lo rentable". Es: **lo que los operadores
comparten y deben poder auditar** (protocolos, kernel, permisos) contra **lo que
se puede comprar y separar por proyecto** (operacion, transacciones,
inventario).

## 2. Las dos decisiones que hacen posible el reparto

### 2.1 La flota de Tenantless no vuelve multi-tenant al core

Portaless **no tiene multi-tenancy**: las tablas `pages`, `permission_grants` y
`plugin_registry` no tienen columna `site_id`. Esto no es un hueco que Cloudum
venga a llenar: es la forma que hace que la frontera sea limpia.

**Decision**: Tenantless opera **N instancias single-tenant independientes**, una
base de datos por nodo, y la orquestacion vive enteramente fuera. "Cientos de
nodos" es un problema de orquestacion, no de schema.

Consecuencia aceptada: no hay un panel unico con todos los sitios de una corporacion
dentro del core. Quien lo quiera, lo construye arriba via MCP.

### 2.2 El foso del agente local no contradice la regla del ROADMAP

`ROADMAP.md:95` dice:

> **Site-generation agent**: via an external SDK project, never in the AGPL core
> (no license mixing, no coupled release cycles).

El foso de la soberania **es** un agente que corre en la maquina del creador con
sus credenciales. Las dos cosas son compatibles si se reparte por capa:

| Se queda en el core (AGPL) | Va a repos aparte |
| --- | --- |
| El **modelo de datos** de lo recolectado (donde aterriza, con que forma) | Los **collectors concretos**: YouTube, Spotify, Apple Music |
| El **protocolo**: manifiesto, `CapabilityId`, MCP, APW | La logica de negocio de cada plataforma |
| El **formato de intercambio** con el sitio | Los clientes y sus credenciales, que nunca tocan un servidor |

Los collectors son adaptadores delgados y reemplazables — que es exactamente lo
que los hace proveedores, no nucleo. El nucleo gana la seguridad de que sus datos
tienen forma verificada; el collector cambia cuando la plataforma cambia.

### 2.3 El orden "Top" lo define LTP, no un contador de vistas

No hace falta un view counter para ordenar: **la metrica ya existe y es la misma
que evalua a los Veraciers**. Los filtros que un sitio pueda exponer —`Top`,
`Recents`, `Confidence`, `Old`, `New`, `History`, y los tematicos— son lecturas
distintas sobre el mismo grafo de confianza, no consultas a una base de datos
distinta.

Lo que el core **ya tiene**, verificado:

| Pieza | Donde | Que aporta |
| --- | --- | --- |
| Voto con escala 1–5, comentario libre y fecha | `schema.sql:319` (`site_trust_community_votes`) | `score CHECK (score BETWEEN 1 AND 5)`, `comment TEXT`, `voted_at`, y un voto por categoria y por votante |
| 4 categorias de juicio comunitario | `packages/trust-layer/src/site-trust/site-trust-score.ts` | `perceived_trustworthiness`, `content_accuracy`, `spam_or_deceptive`, `responsiveness` |
| Agregacion por periodo | `packages/apw-resolver/src/scoring/reader-conduct-config.ts:24,108` | `periodKey()` ya produce dia, semana ISO y mes UTC |
| Puntaje bayesiano con prior | `packages/apw-resolver/src/scoring/scoring.ts:6-7,79` | `NEUTRAL = 4.0`, `PRIOR_WEIGHT = 3`, score = (prior·neutral + Σ wᵢvᵢ)/(prior + Σ wᵢ) |
| Calibracion y consenso de testigos | `packages/apw-resolver/src/did-apw/witness-index.ts` | `witnessCalibrationFactor`, `consensusOf` ponderado por `seq` |

Lo que **falta** para que esos filtros existan:

1. **La identidad del votante ya es verificable (Fase 8, 2026-10-15).** Este
   documento lo marcaba como el bloqueo del grafo de confianza: `voter_id` se
   generaba en el cliente como `anon-${crypto.randomUUID()}` en `localStorage` y
   lo unico que lo acotaba era `ip_hash`. Ya no: una evaluacion comunitaria es
   una atestacion firmada por un `did:apw` (ERRATA E-13), con `jti` unico por
   emisor, almacenada de forma append-only. La ruta anonima responde 410. Lo que
   sigue pendiente no es codigo: **que existan emisores reales**. Un fixture con
   tres claves prueba la mecanica, no que haya tres operadores — y hoy hay uno
   solo (`SECURITY.md`).
2. **No hay periodo "anio"**: `EmissionPeriod` cubre `"month" | "week" | "day"`.
3. **No hay clasificacion tematica**, asi que los cortes por categoria editorial
   (polemico, preguntas y respuestas, viral) no tienen dato de origen.

El punto 1 es el que decide el resto: sin identidad criptografica del Veracier,
un historial publico de revisiones no es una garantia anti-bot, es un formulario
que cualquiera puede llenar otra vez. Con `did:apw` firmado, el mismo historial
pasa a ser **reproducible por un tercero** —cada filtro se recalcula desde las
atestaciones firmadas y encadenadas— que es la propiedad que hoy ni X ni Google
entregan.

## 3. Piezas habilitantes que solo Portaless puede hacer

La frontera de arriba no es una declaracion de intenciones: para que un modulo
cerrado se pueda instalar y operar hicieron falta tres cosas, y las tres son
del core. La primera ya existe; las otras dos siguen pendientes.

### 3.1 `packages/plugin-sdk` — publicado (MIT, v0.1.0)

`packages/plugin-sdk` existe desde la Fase 11 (2026-10-15), como paquete MIT
publicable: re-declara sus propios tipos, el catalogo de capacidades y
`validateManifest`, y **no** importa `packages/plugin-sandbox` ni ningun otro
paquete del core (AGPL). La equivalencia con el core la fija un test del lado
AGPL (`tests/unit/plugin-sdk-parity.test.ts`: deep-equal del catalogo, misma
agrupacion, y `validateManifest` con el mismo veredicto y los mismos errores).

Lo que **sigue faltando** (Fase 11.2): el instalador HTTP de plugins y los
backends reales de las capacidades que hoy responden 501. La superficie de
capacidades del SDK es **provisional** hasta que esa fase cierre (cuotas de
`storage:*`, codigos de error de los backends reales): por eso esta version es
0.1.0 y su README lo dice.

### 3.2 El tarball de `apw-resolver` instala, pero nadie lo prueba

**Correccion (2026-10-15).** Una version anterior de esta seccion afirmaba que
`@portaless/apw-resolver` no era instalable por separado porque seis archivos
importan por ruta relativa fuera del paquete. **Era falso, y la comprobacion lo
demuestra**: el `build` empaqueta con `esbuild --bundle`, que inlinea esas
importaciones en el momento de compilar. La prueba real:

```
$ npm pack && npm i ./portaless-apw-resolver-0.1.0.tgz   # en un proyecto vacio
INSTALL: OK
IMPORT  : OK    -> APW_TXT_PREFIX, ATTESTATION_TYP, buildDidDocument,
                   generateApwDid, jcs, jwkThumbprint, parseApwDidDocument, ...
IMPORT /full : OK, 13 exports
```

El tarball publicado no contiene ninguna import relativa sin resolver, y sus unicas
dependencias externas son `canonicalize`. Los seis imports entre paquetes que quedan
en el codigo fuente son un detalle interno de build, no una limitacion del
consumidor.

Lo que si falta es **la garantia de que siga siendo cierto**. No hay ningun job de
CI que empaquete el tarball y lo importe desde un proyecto limpio, asi que una
entrada nueva, un cambio de bundler o un `files:` incompleto podrian romper la
instalacion sin que nada lo note. Para un protocolo que quiere ser implementado
por terceros, que la referencia sea instalable no es un accidente aceptable: es la
condicion de entrada, y por lo tanto merece una prueba automatica, no una
comprobacion manual.

### 3.3 No hay instalador de plugins, y nueve capacidades no tienen backend

- **Instalador**: `PluginRegistryStore.register()` solo se invoca desde el seed
  (`packages/plugin-sandbox/src/registry/store-factory.ts:35`), y el codigo del
  plugin se lee de disco local (`functions/admin/api/plugins/run.js:65`), con
  `503 plugin_source_backend_unavailable` en workerd. Un producto comercial no se
  puede instalar en la instancia de un cliente.
- **Capacidades**: 9 de las 12 con bridge devuelven `501 NOT_CONFIGURED`
  (`media:read/write`, `email:send`, `commerce:read/checkout`,
  `storage:read/write`, `site:admin`, `agent:identify`). El patron correcto ya
  existe y respeta `ROADMAP.md:227`: **el core expone la interfaz y el plugin
  pone la implementacion** — igual que hoy `SettlementProvider.charge()` es un
  placeholder que devuelve `success: false` y la liquidacion real la construye un
  tercero.

## 4. Nombres

**Linstark es la entidad corporativa** detras de la capa comercial. Conviven con
los nombres que el repo ya usa para el rol externo:

| Nombre previo | Rol | Sigue vigente |
| --- | --- | --- |
| **AppPlace** | Marketplace curado | Si, como denominacion del rol. LoCloudum lo ocupa en la practica |
| **AppLibre** | Registro comunitario de plugins | Si, como denominacion del rol |

Tres comentarios de codigo y dos documentos de arquitectura ya apuntan a
"AppPlace/AppLibre, otro repo" como la costura del marketplace
(`src/pages/explore.astro:11`, `packages/atomic-elements/src/themes/theme-pack.ts:38`,
`docs/design/design-guide.md:218`, `licensing-boundaries.md` secciones 3 y 4).
Ese mapeo **detallado** AppPlace/AppLibre hacia productos Linstark concretos
queda fuera del alcance de este documento; lo que se decide aca es que los dos
vocabularios nombran la misma frontera y ninguno queda derogado.

## 5. Lo que este documento NO decide

Cuatro cosas quedan abiertas y se anotan aca para que no se pierdan. Ninguna
resuelta por el reparto de arriba:

1. **Cloudum vs la decision invite-only.** `SECURITY.md` dice, en la decision de
   bus factor del 2026-10-15: *"No production data from a stranger is accepted
   under this phase"*. Cloudum es, por definicion, hosting de operadores que no
   son el autor. **Quien puede ser hospedado bajo Cloudum y bajo que contrato no
   esta resuelto**, y este documento no lo resuelve.
2. **El conjunto de filtros y su semantica.** Que el "Top" lo defina LTP en vez
   de un contador de vistas ya esta decidido (seccion 2.3) y no necesita
   discusion. Lo que no esta decidido es **que cortes se exponen** —si `Top` es
   por dia, semana, mes o categoria; si `Confidence` usa el score bayesiano sin
   filtrar o el consenso de testigos; si `Viral` existe sin ningun contador que
   lo respalde. Cada filtro nuevo necesita una definicion verificable antes de
   existir como opcion.
3. **Music.** No hay via publica para obtener *streams plays* ni de Spotify ni de
   Apple Music. Definir "impacto global consolidado" con lo que si es accesible
   (followers, posiciones en charts, top tracks, releases) es una decision de
   producto pendiente — y comunicarla mal es una promesa que el publico puede
   desmentir.
4. **La pagina publica de cada Veracier.** Que cada uno tenga su propia pagina con
   todo lo que evaluo, ordenable con los mismos filtros, es coherente con el modelo
   y no contradice nada: hoy la tabla de votos ya guarda emisor, categoria,
   puntuacion, comentario y fecha. Lo que falta no es el registro —es su
   **atribucion criptografica** (seccion 2.3, punto 1) y una superficie que lo
   exponga.

Ademas, y por el mismo motivo de no mezclar licencias y ciclos de release: **esta
decision de 2026-10 de mantener APW, LTP y Portaless Index en este mismo repositorio,
y no en repositorios separados, es consciente**. Lo que habilita a un segundo
implementador del protocolo no es la ubicacion del codigo: es que exista un
paquete publicable e instalable sin el resto de Portaless —que ya se cumple (seccion
3.2)— y que ese hecho siga siendo cierto en cada release, con una prueba de CI que lo
verifique en lugar de una comprobacion manual.