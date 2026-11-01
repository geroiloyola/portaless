# Decisiones del dueño — 2026-10-31

Registro de decisiones tomadas por el dueño. Este documento no implementa nada: cada PR asociado figura como **no iniciado**. Las cuestiones de marca/nombre se limitan a hechos técnicos; no son asesoría legal.

| ID | Tema | Estado | PR asociado |
|---|---|---|---|
| D1 | Nombre/dominio de la prueba de campo | DECIDIDO | No iniciado (aplicado en PR-A/#114) |
| D2 | Identidad con el nodo apagado | DECIDIDO (diseño ahora, implementación después) | PR-D (no iniciado) |
| D3 | IP del cliente | DECIDIDO (opción C) | PR-E (no iniciado; precondición: observación de cabeceras) |
| D4 | Lista de proveedores DoH | DECIDIDO (mejora posterior al starter) | PR-F (no iniciado) |
| D5 | B3 y C1 | B3 DIFERIDO; C1 ACCIÓN DEL DUEÑO | B3 sin PR hasta contraste; C1 no es PR de código |
| D6 | Perfiles de despliegue | DECIDIDO | Documentación en PR-A/#114; sin PR de código |
| D7 | Starter canónico | DECIDIDO a nivel de principio | PR-B1/B2 (no iniciados) |
| D8 | Contenido personal y demo ficticia | DECIDIDO (opción C) | PR-B1/B2 (no iniciados) |
| D9 | Plantillas del wizard | DECIDIDO | PR-B1/B2 (no iniciados) |
| D10 | Idioma del starter | DECIDIDO | PR-B1/B2 (no iniciados) |
| D11 | Sitio de marketing | DECIDIDO | PR-B1/B2 (no iniciados) |

## D1 — Nombre/dominio

**Estado:** DECIDIDO.

**Decisión:** el dominio usado en la prueba de campo no forma parte de Portaless ni de LTP Stack. En todos los documentos y registros se usa el marcador `<tu-dominio>`. No se tocan identificadores firmados, vectores ni bytes de fixtures.

**Hechos técnicos:**

- El DID `did:apw:<dominio>` está atado al dominio y no se renombra.
- Reescribir una rama no borra apariciones ya presentes en `main` ni en commits antiguos accesibles por SHA.
- El marcador `<tu-dominio>` no debe interpretarse como un dominio real ni como una recomendación de nombre.

**Opciones consideradas:** (a) mantener el dominio real en documentos; (b) reemplazarlo por `<tu-dominio>`; (c) inventar otro dominio. Se eligió (b).

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| Mantener el dominio real | Trazabilidad literal | Mezcla una plataforma ajena con Portaless/LTP | No |
| `<tu-dominio>` | Neutro, no atribuye marca, no toca artefactos firmados | Requiere revisar documentos y registros | Sí |
| Otro dominio inventado | Ninguna ventaja técnica | Puede confundirse con una recomendación de marca | No |

**Racional:** separar la prueba de campo de Portaless/LTP Stack sin alterar DID ni bytes firmados.

**Consecuencias:** los documentos usan `<tu-dominio>`; las apariciones históricas en `main`/commits antiguos no se pueden borrar reescribiendo esta rama.

**PR asociado:** aplicado en PR-A/#114; no hay PR de código.

## D2 — Identidad con el nodo apagado

**Estado:** DECIDIDO (diseño ahora, implementación después).

**Decisión:** se exportarán como archivos estáticos firmados y públicos, en la proyección estática, primero `did.json`, el historial (`apw-log`) y el manifiesto firmado (`apw-manifest.jws`). Testigos y atestaciones quedan para una fase posterior.

**Opciones consideradas:** (a) no exportar identidad a la proyección; (b) exportar solo `did.json`; (c) exportar los tres artefactos base. Se eligió (c).

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| No exportar | Sin nuevos archivos públicos | La identidad no resuelve con el nodo apagado | No |
| Solo `did.json` | Simple | Un verificador no puede comprobar historial/manifiesto | Parcial |
| Los tres artefactos | Identidad verificable offline | Caducidad/republicación/reanclaje de `h` | Sí |

**Esbozo de diseño:**

- Alcance: `did.json`, `apw-log.json` e `apw-manifest.jws` en `/.well-known/` de la proyección estática.
- Caducidad: cada archivo debe declarar una ventana de validez o una marca de generación; un verificador debe fallar cerrado si está caducado.
- Republicación: cada cambio de historial requiere regenerar los tres archivos y publicarlos juntos; el `h` del TXT debe reanclarse.
- Frescura: documentar que la copia estática puede quedar atrás del nodo canónico; el verificador debe poder distinguir “no verificable” de “inválido”.
- Pruebas necesarias: nodo apagado + verificación desde la copia; archivo caducado; historial desactualizado; `h` no reanclado; fallo cerrado.

**Racional:** permitir identidad APW sin depender de que el nodo esté encendido, sin prometer frescura que la copia estática no puede garantizar.

**Consecuencias:** PR-D deberá definir caducidad, republicación, reanclaje y fail-closed antes de implementar.

**PR asociado:** PR-D (no iniciado).

## D3 — IP del cliente

**Estado:** DECIDIDO: opción C.

**Decisión:** un ajuste explícito `PORTALESS_CLIENT_IP_HEADER` con valores `none` (por defecto), `x-forwarded-for` y `cf-connecting-ip`. Nunca se acepta una cabecera salvo que el origen no reciba tráfico por otra vía (`HOST=127.0.0.1` más lista de proxies de confianza). Antes de implementar, el dueño observará las cabeceras reales de su túnel.

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| A) Aceptar `Cf-Connecting-Ip` | Sencillo, un solo valor | Solo seguro si el origen es inaccesible salvo vía Cloudflare; ata el núcleo a un proveedor | Parcial |
| B) Aceptar `X-Forwarded-For` | Estándar y neutral | Hay que leer bien qué valor es el real; depende de proxies de confianza | Sí |
| C) Ajuste explícito (elegida) | Cubre ambos y por defecto no confía en ninguna | Más configuración y documentación | El mejor |

**Opciones consideradas:** A, B y C; se eligió C por el default seguro y la cobertura de ambos casos.

**Racional:** `none` evita confiar en cabeceras por defecto; el operador habilita explícitamente solo el modo que su despliegue puede garantizar.

**Consecuencias:** PR-E debe probar: ninguna cabecera se acepta con `none`; `x-forwarded-for` solo si el par es proxy de confianza; `cf-connecting-ip` solo con ingreso declarado; cliente sin IP distinguible; regresión de #113.

**PR asociado:** PR-E (no iniciado). Precondición: observación de cabeceras del túnel (T6).

## D4 — Lista de proveedores DoH

**Estado:** DECIDIDO como mejora posterior al starter.

**Decisión:** lista configurable; el siguiente proveedor se consulta solo si el anterior falla por red (nunca porque respondió “no existe”); si dos proveedores se contradicen, el resultado es “no verificable”. Mientras tanto, la documentación declara que el proveedor es único (`cloudflare-dns.com`).

**Opciones consideradas:** (a) proveedor único fijo; (b) lista con failover por red; (c) lista con consenso. Se eligió (b) con regla de contradicción = no verificable.

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| Proveedor único | Simple, ya implementado | Punto único de fallo | Parcial |
| Lista con failover | Tolera fallos de red | No resuelve contradicciones | Sí |
| Lista con consenso | Mayor robustez | Complejidad y latencia | Futuro |

**Esbozo de diseño:**

- Alcance: resolución TXT/DoH configurable; proveedor único por defecto.
- Regla: fallo de red → siguiente; `no_txt_records`/`invalid_domain` → no continúa; contradicción → `no_verifiable`.
- Pruebas: fallo de red, “no existe”, contradicción, timeout, todos fallan, proveedor único.

**Racional:** mejorar disponibilidad sin convertir una respuesta negativa legítima en una consulta a otro proveedor.

**Consecuencias:** la documentación actual debe seguir diciendo que el proveedor es único hasta PR-F.

**PR asociado:** PR-F (no iniciado).

## D5 — B3 y C1

**Estado:** B3 DIFERIDO; C1 ACCIÓN DEL DUEÑO.

**Decisión B3:** diferido hasta tener la prueba de contraste (qué bloqueó a las IA: Portaless, Cloudflare, robots.txt o el montaje). Hasta entonces el comportamiento no cambia, el `it.skip` permanece y los textos públicos deben decir la verdad (PR-C).

**Decisión C1:** activar GitHub Private Vulnerability Reporting es tarea del dueño; después el agente verifica con `gh api` y actualiza `SECURITY.md`.

**Opciones B3:** (a) implementar ahora verificación de red y mover política antes del rechazo; (b) esperar contraste; (c) no implementar nunca. Se eligió (b).

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| Implementar ahora | Resuelve antes | Sin evidencia de causa; riesgo de abrir el sitio | No |
| Esperar contraste | Decide con datos | Retrasa | Sí |
| No implementar | Menos cambios | No resuelve el caso | No |

**PR asociado:** B3 sin PR hasta el contraste; C1 no es PR de código.

## D6 — Perfiles de despliegue

**Estado:** DECIDIDO.

**Decisión:** cuatro perfiles: (1) Estático (GitHub Pages), (2) Borde (Cloudflare Pages + D1), (3) Autoalojado (PC o servidor, con túnel o proxy), (4) Combinado (nodo privado + proyección estática pública).

**Corrección:** el túnel (`cloudflared`) expone un nodo que corre en la máquina del operador; Pages ejecuta el código en Cloudflare sin máquina propia ni túnel. “Cloudflare Pages con túnel” es una confusión y no se documenta como perfil.

**Límites:** no se promete “apto para empresas”. Faltan revisión externa de seguridad, copias de seguridad probadas, actualización probada en producción y alta disponibilidad (ausente con SQLite).

| Perfil | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| Estático | Sin servidor; barato | Sin panel, Trust Layer ni MCP en runtime | Sitios publicados |
| Borde | Cloudflare ejecuta Functions | D1; sin Node local; límites de Workers | Producción edge |
| Autoalojado | Nodo completo | Depende del equipo/red; administración | Operador técnico |
| Combinado | Nodo privado + copia pública | Dos piezas y publicación | Mayor control |

**Consecuencias:** la matriz de funciones vive en `docs/self-hosting-where-to-keep-the-node.md`.

**PR asociado:** documentación en PR-A/#114; sin PR de código.

## D7 — Starter canónico

**Estado:** DECIDIDO a nivel de principio.

**Decisión:** un `git clone` debe entregar una sola plantilla canónica: home sencilla lista para editar y un post “Welcome to your Portaless site”; sin plantillas de ejemplo repetidas. El contenido de demostración se MUEVE a un perfil de demo (no se elimina), que usan el workflow de GitHub Pages, los tests y el script de capturas.

**Opciones consideradas:** (a) dejar el contenido actual; (b) borrar la demo; (c) mover la demo a un perfil. Se eligió (c).

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| Dejar actual | Sin trabajo | Clon con demo repetida | No |
| Borrar demo | Clon limpio | Pierde el sitio público actual | No |
| Mover a perfil demo | Clon limpio y demo preservada | Requiere PR-B1/B2 | Sí |

**Consecuencias:** PR-B1 debe responder las preguntas B1.6 y PR-B2 implementa exactamente lo aprobado.

**PR asociado:** PR-B1/B2 (no iniciados).

## D8 — Contenido personal y demo ficticia

**Estado:** DECIDIDO (opción C, B1.6-1).

**Decisión:** ningún dato real ni canal propio del dueño en el repo. Todos los casos de uso se conservan como ejemplo en el perfil de demo, con datos ficticios, y siguen visibles en el sitio público de demostración como prueba viva. No se publican activos por defecto en un clon. El sitio real del dueño vive en su propio repositorio.

**Casos de uso que se conservan en el perfil demo:** creador/influencer, músico y merch, evento/club, boutique, portafolio, lanzamiento, servicios y link-in-bio.

**Criterio de ficticio:** nombres inventados; sin enlaces sociales reales; sin etiquetas de afiliado; sin fotos de personas reales; imágenes con licencia verificada; etiqueta visible “Demo content, fictional”. El patrón de enlaces propuesto está en [`docs/testing/demo-fictional-links-pattern.md`](../testing/demo-fictional-links-pattern.md).

**Opciones consideradas:** (a) mantener contenido real; (b) retirar los casos de uso; (c) conservarlos con datos ficticios. Se eligió (c).

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| A) Mantener real | Sin trabajo | Datos personales/canales reales en el repo | No |
| B) Retirar casos | Menos superficie | Se pierde la prueba viva | No |
| C) Ficticio en demo | Conserva ejemplos y prueba viva sin datos reales | Requiere inventario y auditoría de imágenes | Sí |

**Racional:** preservar la demostración pública y los tests sin exponer datos del dueño.

**Consecuencias:** PR-B1 clasifica y audita; el dueño exporta su sitio real a su propio repositorio antes de PR-B2; el historial de Git conserva el contenido antiguo y no se puede borrar reescribiendo una rama.

**PR asociado:** PR-B1/B2 (no iniciados).

## D9 — Plantillas del wizard

**Estado:** DECIDIDO (B1.6-2).

**Decisión:** las plantillas del wizard se conservan como opciones (son código en `packages/onboarding`). El starter usa la canónica.

**Opciones consideradas:** (a) retirarlas; (b) conservarlas como opciones; (c) convertirlas en el starter. Se eligió (b).

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| Retirar | Menos código | Pierde el onboarding existente | No |
| Conservar como opciones | No rompe el wizard | Hay que alinear copy/idioma | Sí |
| Convertirlas en starter | Menos decisiones | El starter deja de ser mínimo | No |

**Consecuencias:** el starter no depende de las plantillas; el wizard puede seguir generando opciones. El hallazgo de idioma/copy está en [`docs/testing/admin-panel-language.md`](../testing/admin-panel-language.md).

**PR asociado:** PR-B1/B2 (no iniciados).

## D10 — Idioma del starter

**Estado:** DECIDIDO (B1.6-3).

**Decisión:** el starter es solo en inglés. El mecanismo i18n permanece. El español vive en el perfil de demo y en las guías cuyo idioma esté declarado (por ejemplo `docs/first-steps.md`).

**Opciones consideradas:** (a) starter bilingüe; (b) starter solo inglés; (c) starter solo español. Se eligió (b).

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| Bilingüe | Cobertura inmediata | Más contenido y tests en el clon | No |
| Solo inglés | Starter mínimo y coherente | El español queda en demo/guías | Sí |
| Solo español | Audiencia local | Contradice el canon actual en inglés | No |

**Consecuencias:** `/es/` no se publica por defecto en el starter; el perfil demo conserva la proyección en español.

**PR asociado:** PR-B1/B2 (no iniciados).

## D11 — Sitio de marketing

**Estado:** DECIDIDO (B1.6-4).

**Decisión:** el sitio de marketing de Portaless permanece en este repositorio como perfil de demo, desplegado por el workflow de GitHub Pages. Se reevalúa mudarlo cuando evolucione a otro ritmo que el producto o al extraer la especificación LTP.

**Opciones consideradas:** (a) moverlo ahora a otro repo; (b) dejarlo como perfil demo; (c) eliminarlo. Se eligió (b).

| Opción | Ventajas | Desventajas | Encaje |
|---|---|---|---|
| Mover ahora | Separación temprana | Trabajo y riesgo de tests/workflow | No |
| Perfil demo | Conserva la demo y el deploy actual | Sigue acoplado al repo | Sí |
| Eliminar | Menos contenido | Pierde la prueba viva | No |

**Consecuencias:** PR-B1 debe separar el perfil demo del starter; el workflow de Pages sigue usando el perfil demo.

**PR asociado:** PR-B1/B2 (no iniciados).

## Tareas que siguen siendo del dueño

- C1: activar Private Vulnerability Reporting; luego el agente verifica con `gh api` y actualiza `SECURITY.md`.
- Responder A2; aprobar o corregir las redacciones de A8; autorizar cada PR de la cola.
- Prueba de contraste de bloqueo de IA y observación de cabeceras del túnel.
- Exportar su sitio real a su propio repositorio antes de PR-B2.
- Artículo real del blog para el demo y cronometrar la instalación con una persona ajena.
- Endurecer el nodo: `HOST=127.0.0.1`, Cloudflare Access o TOTP para `/admin`, copia de seguridad de `.env` y `data/`.
- Asesoría legal sobre el nombre/dominio, si procede.
