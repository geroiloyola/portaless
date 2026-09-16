# Fronteras de licencia: core, SDK, AppPlace, AppLibre y plugins de terceros

Este documento define, sin ambiguedad, que licencia aplica a cada parte del
ecosistema de Portaless, y por que. Cualquier duda de un desarrollador de
plugins externo (de AppPlace, de AppLibre, o independiente) sobre si puede
cerrar el codigo de su plugin debe resolverse leyendo este documento primero.

## Resumen ejecutivo

| Componente | Licencia | Repositorio |
|---|---|---|
| Portaless core (CMS, dashboard, auth, Trust Layer, Centro de Permisos, motor del sandbox) | AGPL-3.0 | Este repo (`linstarkcorp/portaless`) |
| Plugin SDK (tipos, interfaces, contratos del capability bridge) | MIT | `packages/plugin-sdk` en este repo |
| AppPlace (tienda oficial curada) | Proyecto aparte, no cubierto por este LICENSE | Repositorio independiente |
| AppLibre (registro comunitario) | Proyecto aparte, no cubierto por este LICENSE | Repositorio independiente |
| Plugins de terceros individuales | Libre eleccion del autor (abierta o cerrada) | Repos independientes de cada autor |

## 1. Por que el core es AGPL-3.0 y no MIT

Portaless es una plataforma completa (CMS + comercio + dashboard + sandbox de
plugins + capa de confianza criptografica), no una libreria utilitaria. El
modelo de negocio real depende de que el core siga siendo la base que un
ecosistema de plugins (AppPlace, AppLibre, terceros) construye encima. Bajo
MIT, cualquiera podria tomar el core, modificarlo, y ofrecerlo como servicio
de red competidor sin publicar ni una linea de sus cambios.

AGPL-3.0 cierra especificamente ese vacio (el "SaaS loophole"): cualquiera
puede autohospedar Portaless sin ninguna obligacion adicional, pero si
alguien modifica el core y lo ofrece como servicio de red a terceros, debe
publicar el codigo de esa version modificada bajo la misma licencia
(Section 13, AGPL-3.0). Es el mismo patron que usan proyectos comparables en
tamano y modelo (Nextcloud, n8n en su nucleo, entre otros).

## 2. Donde esta la frontera legal (el "punto de separacion")

La pieza que hace posible que un plugin cerrado sea legal es el **aislamiento
tecnico real**, no solo una declaracion de intenciones:

- Los plugins corren dentro de `packages/plugin-sandbox`, en un proceso
  aislado (`isolated-vm` u otro adaptador edge), sin acceso directo a memoria
  ni a modulos internos del core.
- La UNICA superficie que un plugin puede importar o consumir es la publicada
  en `packages/plugin-sdk` (tipos TypeScript, interfaces de capacidades,
  contratos del capability bridge) -- licenciada aparte bajo MIT
  (ver `LICENSE-SDK`).
- Toda comunicacion entre el plugin y el core pasa por el capability bridge
  (`ivm.Reference` + `hostBridge`) descrito en
  `packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md`, nunca por import
  directo de codigo del core.

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
sugerida para plugins publicados ahi es usar licencias permisivas (MIT o
Apache-2.0) para maximizar la reutilizacion entre desarrolladores de la
comunidad, pero esto es una convencion de la comunidad de AppLibre, no una
obligacion impuesta por el core de Portaless -- el aislamiento tecnico
(seccion 2) es lo que legalmente habilita cualquier licencia, no la
plataforma de distribucion.

## 5. Plugins de terceros individuales

Cualquier desarrollador puede escribir y distribuir un plugin de Portaless
(via AppPlace, AppLibre, o de forma privada/directa a un cliente) bajo la
licencia que elija, abierta o cerrada, siempre que:

1. El plugin se ejecute dentro del sandbox aislado (`plugin-sandbox`).
2. Solo consuma la API publica de `packages/plugin-sdk` (MIT) para
   comunicarse con el core.
3. No incorpore ni parchee directamente codigo del core AGPL-3.0.

## 6. Riesgos a vigilar (para que este modelo no falle en el futuro)

- Si algun plugin llega a necesitar modificar el core mismo (no solo
  consumir el SDK), ese plugin especifico pasa a estar bajo AGPL-3.0.
- Si Portaless ofrece soporte/hosting administrado a un cliente y ese
  cliente pide cambios al core (no a un plugin), esos cambios deben
  publicarse bajo AGPL-3.0 si el cliente los corre como servicio de red --
  esto debe quedar claro en cualquier contrato de soporte.
- Cualquier codigo de terceros vendorizado directamente en el arbol de este
  repo (no como dependencia de npm) debe revisarse por compatibilidad de
  licencia antes de que el cambio a AGPL-3.0 se considere definitivo (ver
  tarea manual 9 en ROADMAP.md).

## 7. Preguntas frecuentes para desarrolladores de plugins

**¿Puedo vender mi plugin cerrado en AppPlace?** Si, mientras corra en el
sandbox y solo use el SDK publico.

**¿Necesito abrir el codigo de mi plugin porque Portaless es AGPL-3.0?** No,
si respeta la frontera de la seccion 2. La licencia AGPL-3.0 del core no se
propaga a traves del sandbox.

**¿Puedo publicar mi plugin gratis en AppLibre bajo licencia cerrada?**
Tecnicamente si es legalmente posible, pero rompe la convencion esperada de
esa comunidad -- consultar las guias especificas de AppLibre (proyecto
aparte) antes de publicar.
