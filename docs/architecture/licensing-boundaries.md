# Fronteras de licencia: core, SDK, AppPlace, AppLibre y plugins de terceros

Este documento define, sin ambiguedad, que licencia aplica a cada parte del
ecosistema de Portaless, y por que. Cualquier duda de un desarrollador de
plugins externo (de AppPlace, de AppLibre, o independiente) sobre si puede
cerrar el codigo de su plugin debe resolverse leyendo este documento primero.

## Resumen ejecutivo

| Componente | Licencia | Repositorio (actual → objetivo) |
|---|---|---|
| Portaless core / nodo canonico (CMS, dashboard, auth, Centro de Permisos, motor del sandbox, MCP, persistencia SQLite/D1 y adaptadores del nodo) | **AGPL-3.0-or-later** | `geroiloyola/portaless` |
| Especificacion del **Vera Trust Stack** (APW, Local Trust Protocol, SVRI, HSVR: `docs/protocol-apw/`: spec, errata, esquemas y vectores) | **CC BY 4.0** | Hoy en `geroiloyola/portaless` → destino `verared/vera-trust-spec` (`@verared/spec`) |
| Implementacion de referencia neutral **Vera Trust Stack** (L0-net, L1 y nucleo L2 sin CMS ni SQLite: `@verared/net`, `apw`, `local-trust`, `reputation`, `trust-layer`, `cloud-images`, `identity-atproto`, `cli`) | **Apache-2.0** *(decision de cambio desde `AGPL-3.0-or-later`; ver seccion 7.1)* | Hoy en `geroiloyola/portaless` (aun declarados `AGPL-3.0-or-later` hasta la transicion de Tanda 1/2) → destino `verared/vera-trust-stack` |
| Plugin SDK (tipos, interfaces, contratos del capability bridge) | **MIT** | `geroiloyola/portaless` (`packages/plugin-sdk`, v0.1.0; extraccion opcional a `geroiloyola/portaless-plugin-sdk`) |
| Plantillas y demo ficticia (`portaless-templates`, D11) | Por activo verificado (gate PR-B1) | Hoy en `geroiloyola/portaless` → destino `geroiloyola/portaless-templates` |
| AppPlace (tienda oficial curada) | Proyecto aparte, no cubierto por este LICENSE | Repositorio independiente |
| AppLibre (registro comunitario) | Proyecto aparte, no cubierto por este LICENSE | Repositorio independiente |
| Plugins de terceros individuales | Libre eleccion del autor (abierta o cerrada) | Repos independientes de cada autor |

## 1. Por que el core de Portaless es AGPL-3.0 y no una licencia permisiva

Portaless es una plataforma completa (CMS + comercio + dashboard + sandbox de
plugins + capa de confianza criptografica), no una libreria utilitaria. El
modelo de negocio real depende de que el core siga siendo la base que un
ecosistema de plugins (AppPlace, AppLibre, terceros) construye encima. Bajo
una licencia permisiva, cualquiera podria tomar el core, modificarlo, y
ofrecerlo como servicio de red competidor sin publicar ni una linea de sus
cambios.

AGPL-3.0 cierra especificamente ese vacio: cualquiera puede autohospedar
Portaless sin ninguna obligacion adicional, pero si alguien modifica el core
y lo ofrece como servicio de red a terceros, debe publicar el codigo de esa
version modificada bajo la misma licencia (Section 13, AGPL-3.0).

## 2. Donde esta la frontera legal (el "punto de separacion")

La pieza que hace posible que un plugin cerrado sea legal es el **aislamiento
tecnico real**, no solo una declaracion de intenciones:

- Los plugins corren dentro de `packages/plugin-sandbox`, en un proceso
  aislado (`isolated-vm` u otro adaptador edge), sin acceso directo a memoria
  ni a modulos internos del core.
- La superficie publica que un plugin puede consumir para comunicarse con el
  core es el capability bridge (`ivm.Reference` + `hostBridge`) descrito en
  `packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md`. `packages/plugin-sdk`
  (MIT, v0.1.0) es la forma recomendada de consumir esa superficie desde
  TypeScript; el aislamiento del sandbox ya es efectivo y suficiente para que
  un plugin de terceros elija su propia licencia, con o sin el SDK.
- Toda comunicacion entre el plugin y el core pasa por ese capability bridge,
  nunca por import directo de codigo del core.

Mientras un plugin respete esa frontera, **no se considera obra derivada**
del core bajo AGPL-3.0, y su autor puede licenciarlo como quiera: abierto,
cerrado, dual-license, o comercial.

Lo que SI rompe la frontera y obliga a AGPL-3.0:

- Parchear o importar directamente archivos de `functions/`, `src/`, o de
  cualquier `packages/` que no sea `plugin-sdk`.
- Distribuir una version modificada del core mismo (no un plugin) como
  servicio de red.
- Incorporar codigo del core copiado o adaptado dentro del propio plugin,
  fuera de lo publicado en el SDK.

## 3. AppPlace -- proyecto aparte, no forma parte de este repositorio

AppPlace es la tienda oficial curada, un **proyecto independiente** con su
propio repositorio, no cubierto por el `LICENSE` de Portaless. Puede alojar
plugins de cualquier licencia, incluidos cerrados o comerciales, siempre que
esos plugins respeten la frontera de aislamiento descrita en la seccion 2.
AppPlace en si misma (el codigo de la tienda, su backend de listado/cobro) es
un producto separado y su licencia se define en su propio repositorio, sin
relacion de licencia obligatoria con Portaless core.

## 4. AppLibre -- proyecto aparte, respaldado por la comunidad

AppLibre es un registro/repositorio comunitario de plugins, tambien un
**proyecto independiente**, no cubierto por este `LICENSE`. La convencion
sugerida para plugins publicados ahi es usar licencias permisivas para
maximizar la reutilizacion entre desarrolladores de la comunidad, pero esto
es una convencion de la comunidad de AppLibre, no una obligacion impuesta por
el core de Portaless -- el aislamiento tecnico (seccion 2) es lo que
legalmente habilita cualquier licencia, no la plataforma de distribucion.

## 5. Plugins de terceros individuales

Cualquier desarrollador puede escribir y distribuir un plugin de Portaless
(via AppPlace, AppLibre, o de forma privada/directa a un cliente) bajo la
licencia que elija, abierta o cerrada, siempre que:

1. El plugin se ejecute dentro del sandbox aislado (`plugin-sandbox`).
2. Solo consuma la superficie publica del capability bridge para
   comunicarse con el core (directamente, o a traves de `packages/plugin-sdk`).
3. No incorpore ni parchee directamente codigo del core AGPL-3.0.

## 6. Riesgos a vigilar (para que este modelo no falle en el futuro)

- Si algun plugin llega a necesitar modificar el core mismo (no solo
  consumir la superficie publica del sandbox), ese plugin especifico pasa a
  estar bajo AGPL-3.0.
- Si Portaless ofrece soporte/hosting administrado a un cliente y ese
  cliente pide cambios al core (no a un plugin), esos cambios deben
  publicarse bajo AGPL-3.0 si el cliente los corre como servicio de red --
  esto debe quedar claro en cualquier contrato de soporte.
- Cualquier codigo de terceros vendorizado directamente en el arbol de este
  repo (no como dependencia de npm) debe revisarse por compatibilidad de
  licencia antes de que el cambio a AGPL-3.0 se considere definitivo (ver
  tarea manual 9 en ROADMAP.md).
- `packages/plugin-sdk` ya existe como codigo (MIT, v0.1.0): re-declara sus
  propios tipos y catalogo y no importa el core, de modo que consumirlo no
  incorpora AGPL. La paridad con el core la fija un test del lado AGPL
  (`tests/unit/plugin-sdk-parity.test.ts`); ver `AGENT.md` para el estado real
  vigente y `CONTRIBUTING.md` para la nota de titularidad y el DCO.

## 7. La especificacion del Vera Trust Stack no esta bajo AGPL

La especificacion (`docs/protocol-apw/`, destino `github.com/verared/vera-trust-spec`)
es un documento normativo publicado bajo **CC BY 4.0**, distinto del core.
Reimplementar el protocolo en cualquier lenguaje, traducirlo o citarlo
comercialmente no crea ninguna obligacion AGPL: el texto del estandar no es
obra derivada del codigo, ni el codigo es obra derivada del texto. El vinculo
entre ambos es solo de atribucion y de verificacion (los vectores de
`APW-VECTORS-v1.3.md` y los corpora de conformidad), nunca de licencia.
Ver "Licencia y gobernanza" en `docs/protocol-apw/APW-SPEC-v1.3.md`.

### 7.1 Cambio de licencia de `verared/vera-trust-stack` (L0-net, L1 y nucleo L2): de `AGPL-3.0-or-later` a `Apache-2.0`

**Decision de gobernanza (2026-11-24):** los paquetes de implementacion de
referencia neutral destinados a la fundacion `github.com/verared/vera-trust-stack`
(`@verared/net`, `@verared/apw`, `@verared/local-trust`, `@verared/reputation`,
`@verared/trust-layer`, `@verared/cloud-images`, `@verared/identity-atproto` y
`@verared/cli`) cambian su licencia objetivo desde **`AGPL-3.0-or-later`** hacia
**`Apache-2.0`**.

- **Justificacion normativa:** maximizar la adopcion mundial en CDNs,
  navegadores, proxies, gateways de agentes y CMS (incluidos sistemas
  propietarios), aportando ademas una clausula explicita de patentes.
- **Compatibilidad con `geroiloyola/portaless`:** `Apache-2.0` es 100%
  compatible con `AGPL-3.0-or-later`. El nodo Portaless consume `@verared/*`
  como dependencias externas fijadas y conserva su propia licencia
  `AGPL-3.0-or-later` para el CMS, la persistencia SQLite/D1, los adaptadores
  del nodo, el sandbox y el servidor MCP.
- **Transparencia verificable:** la confianza en la capa no depende de copyleft
  viral en la libreria, sino de la especificacion abierta (`CC BY 4.0`), las
  firmas criptograficas auditables y los vectores deterministas de conformidad;
  cualquier implementacion modificada que altere las reglas falla la
  verificacion publica.
- **Dependencias de terceros verificadas:** las dependencias directas de L1/L2
  (`canonicalize` Apache-2.0, `web-bot-auth` Apache-2.0, `@noble/post-quantum`
  MIT) no presentan conflicto con `Apache-2.0`; `better-sqlite3` (MIT) y los 14
  stores SQLite/D1 permanecen en `geroiloyola/portaless`.
- **Estado actual honesto en el arbol:** los 7 `package.json` del bloque
  `verared` (`packages/{net,apw-resolver,ltp-engine,ltp-reputation,trust-layer,cloud-images,identity-atproto}`)
  ya declaran `"license": "Apache-2.0"` e incluyen su archivo `LICENSE`
  Apache-2.0; los paquetes del nodo `geroiloyola` permanecen en
  `AGPL-3.0-or-later`, `packages/plugin-sdk` en `MIT` y `docs/protocol-apw/` en
  `CC-BY-4.0`. Los nombres de workspace `@portaless/*` se conservan hasta la
  extraccion fisica de **Tanda 2** (ver [`ARCHITECTURE.md`](../../ARCHITECTURE.md)).

## 8. Preguntas frecuentes para desarrolladores de plugins

**¿Puedo distribuir mi plugin cerrado?** Si, mientras corra en el sandbox y
no incorpore codigo del core fuera de la superficie publica descrita en la
seccion 2.

**¿Necesito abrir el codigo de mi plugin porque Portaless es AGPL-3.0?** No,
si respeta la frontera de la seccion 2. La licencia AGPL-3.0 del core no se
propaga a traves del sandbox.

**¿Necesito el `packages/plugin-sdk` para licenciar mi plugin como quiera?**
No. El aislamiento tecnico del sandbox ya es efectivo por si solo; el SDK es
una comodidad de tipado, no un requisito legal.

**¿Puedo publicar mi plugin gratis en AppLibre bajo licencia cerrada?**
Tecnicamente si es legalmente posible, pero rompe la convencion esperada de
esa comunidad -- consultar las guias especificas de AppLibre (proyecto
aparte) antes de publicar.