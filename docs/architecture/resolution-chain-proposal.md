# Propuesta A/B/C: gate de resolución completa

**Estado: arquitectura, decisiones D1–D9 y contratos Draft 0.1 aprobados formalmente
por el dueño (2026-10-23). Publicación normativa final y conformidad pendientes.**
Base inspeccionada: `main` después de #102 (`bc3b243`). No se modifican código,
defaults, política DNSSEC, protocolo ni grants mediante este documento.

La aprobación queda registrada en el
[ADR 0003](../decisions/0003-public-and-governed-resource-contract.md) y en el
[cierre contractual](../protocol-apw/LTP-STANDARDIZATION-STATUS.md). La baseline
documental ya fue fusionada en #103; no concede permiso de programación. Las
definiciones y estados de autorización viven únicamente en el
[registro canónico G1–G5](../protocol-apw/LTP-GATES-AND-AUTHORIZATIONS.md).
Aceptar datos o fusionar documentación no inicia motor, red ni presupuestos.
Un PR contra `main` a la vez: geroiloyola abre, linstarkcorp revisa y el dueño
fusiona. A/B/C conservan su significado de entregas del roadmap, no de permisos.

## Contratos de estándar neutrales

La nomenclatura aprobada es **LTP Index**, **LTP Proof
Package**, **LTP Attestation** y **SVRI Projection**. Portaless identifica solo
el runtime/implementación de referencia, no el protocolo, un paquete o una
autoridad de identidad. Un proveedor o consumidor independiente no requiere su
código fuente ni APIs privadas para cumplir el contrato.

El concepto principal es **LTP: confianza y trazabilidad**. APW define identidad
y estructura del intercambio P2P; LTP evalúa esa estructura, JWS y testigos;
SVRI es el vector de salida y HSVR su histórico verificable. La separación y
compatibilidad están en [LTP Stack](../protocol-apw/LTP-STACK-ARCHITECTURE.md).

La definición de mensajes, pruebas y validación vive separada de este plan:

1. [LTP Index Draft 0.1](../protocol-apw/LTP-INDEX-DRAFT-v0.1.md).
2. [LTP Proof Package Draft 0.1](../protocol-apw/LTP-PROOF-PACKAGE-DRAFT-v0.1.md).
3. [APW Identity Bootstrap Draft 0.1](../protocol-apw/APW-IDENTITY-BOOTSTRAP-DRAFT-v0.1.md).

Los contratos aprobados como baseline conservan Draft 0.1 hasta cerrar los
[gates de publicación](../protocol-apw/LTP-STANDARDIZATION-STATUS.md#2-remaining-gates-for-final-standard-publication).
No cambian APW v1.3/E-16, no renombran mensajes históricos ni activan
Edge. Su publicación final exige revisión y vectores interoperables independientes; publicar
Markdown junto al runtime no demuestra que ese runtime los implemente.

## Aclaraciones del dueño: independencia, SVRI y consumidores

### Identidad APW independiente del proveedor

La identidad `did:apw:<dominio>` se vincula al dominio, su TXT `_apw` y las
claves criptográficas; no a una cuenta de Cloudflare. La regla normativa exige
que la clave de did.json coincida con `k` del TXT, y HTTPS no puede sobreescribir
DNS (`docs/protocol-apw/APW-SPEC-v1.3.md:125-130`). Cloudflare es un proveedor de
transporte/resolución más, no autoridad de identidad ni requisito del protocolo.
La lista cerrada del resolver es una defensa SSRF, no una dependencia normativa
del proveedor. El operador puede elegir un proveedor compatible, incluso uno
autogestionado; ampliar proveedores requiere verificar el perfil, no adoptar una
URL controlada por el bot. D1 exige AD manteniendo esta independencia.

APW y AT Protocol comparten el objetivo de identidad verificable e interoperable,
pero no son métodos DID equivalentes: APW actual identifica un dominio; AT admite
handle↔DID con métodos como did:plc/did:web. El puente es opcional y ninguna
identidad obliga a la otra (`docs/architecture/identity-atproto.md:3-9,21-36`).

### Qué verifica A cuando consulta al dominio B

El resultado debe separar **identidad de B**, **integridad de su historial** y
**reputación/evidencia disponible**. Orden recomendado:

1. Resolver el TXT de B con la política DNS aprobada; validar su did.json y `k`.
2. Verificar firmas/ventanas, `seq`, `prev` y el vínculo de `h` con el historial
   APW; declarar qué entradas posteriores aún no están ancladas en DNS.
3. Para cada prueba requerida, calcular el hash de su JWS, compararlo con `att`
   y verificar además la firma del emisor, sujeto, categoría e instante válido.
4. Recalcular LTP y su proyección SVRI bajo la misma versión/perfil y conjunto de
   evidencia admisible; no confiar en el número que B presenta ni en la mera
   presencia de un hash. Las cuentas/tier y flags deben corresponder al cálculo.
5. Si falta identidad/prueba, hay timeout/límite o los archivos no existen,
   reportar identidad no demostrada o evidencia pendiente/sin datos según la
   etapa. Si hay contradicción verificable, informar prueba inválida. Una
   identidad puede ser válida aunque su SVRI siga Pendiente; el MVP grant-only
   no debe exigir un SVRI como requisito de identidad.

Es consistente con `docs/protocol-apw/SVRI-v1.0.md:7,27,83-103` y con las
reglas de cadena/bundle de `APW-SPEC-v1.3.md:211-255`. LTP es el cálculo y sus
reglas de confianza; el historial es el log APW que registra evidencia, no un
segundo archivo independiente denominado «historial LTP».

**Límite actual del contrato:** SVRI v1.0 define una proyección versionada, no
un campo normativo de «hash total del certificado SVRI»
(`docs/protocol-apw/SVRI-v1.0.md:53-81`). El compromiso disponible `h` ancla
historial y cada `att` vincula un JWS. No inventar un digest SVRI ni afirmar que
se verifica uno ya implementado. Si se requiere un certificado exportable con
digest propio, necesita un contrato versionado separado que ligue DID, ancla,
conjunto de evidencia, reglas, fecha/vigencia y firma; no basta hashear una cifra.
Esta propuesta no implementa ese artefacto ni abre al público el detalle SVRI/HSVR
administrativo. Sin autorización, A no puede afirmar que recalculó detalle privado.

Esto dificulta aceptar alteraciones o resultados sin respaldo; no hace imposible
todo fraude. Un propietario puede firmar declaraciones falsas u omitir evidencia
antes de registrarla; hay compromiso de claves, replay de información antigua y
equivocación. Fuentes independientes, frescura y testigos cubren amenazas distintas.
La ausencia de pruebas no es prueba de falsificación ni una reputación neutral.

### Dos entradas, un motor de verificación

Se recomienda conservar los dos consumidores por sus casos de uso documentados:
`/trust/:siteId` sirve el estado del sitio y su gobernanza; `/trust/atproto/:handle`
es un puente opcional que une identidad AT, reputación W del sitio y datos R del
usuario cuando existen (`docs/architecture/identity-atproto.md:30-46,92-98`).
No son dos certificados ni dos fuentes independientes que deban contarse dos
veces. A/B/C deben compartir transporte, presupuesto, resolución, validación y
vencimientos, manteniendo autorización/proyección propias en cada endpoint.
Conservar dos entradas no justifica dos implementaciones de criptografía/caché.
Unificar el motor tampoco permite publicar detalle gobernado en el puente.

### D3 revisada: LTP Index como transporte de pruebas, relay opcional, fail-closed

El dueño propone priorizar una ruta Index/proyección verificable para no exigir
un relay por instalación Edge. El contraste del repositorio y las condiciones
pendientes de implementación están en [indexed-resolution-review.md](./indexed-resolution-review.md).
El Index actual publica observaciones informativas, no un paquete SVRI completo.
La ruta objetivo usa LTP Index(es) fijos configurados por el operador, pruebas de
identidad con raíz independiente, historial/evidencia y verificación local.
Sin pruebas suficientes/vigentes, falla cerrada. El relay queda como alternativa
privada explícita, no requisito de instalación ni fallback automático.

**La decisión anterior de relay obligatorio queda sustituida como objetivo de
producto.** Sus requisitos técnicos siguen aplicándose cuando se elige un relay;
los párrafos siguientes describen esa alternativa y no un requisito para todo Edge.

Hashes, JWS, validación de cadena y cálculo LTP/SVRI pueden ejecutarse localmente
en JS/WebCrypto o WASM según el motor disponible. Pero WASM no obtiene por sí solo
control del DNS, sockets o IP de destino: la red la proporciona el runtime host.
Un módulo WASM que invoque el mismo fetch de Workers conserva la misma limitación
de pinning. Un conector alternativo tendría que demostrar conexión a la IP validada,
TLS/SNI/certificado, caps y cancelación; no se presume que exista ni se construye
en estas entregas. Workers/Edge no consulta destinos arbitrarios del solicitante.
Sin ruta indexada verificable o relay elegido válido/disponible, la resolución
externa requerida no ocurre y devuelve un motivo operativo. No se convierte en
identidad falsa, firma inválida ni prueba de mala conducta. Node conserva la
resolución local con su conector seguro.

TLS valida el certificado contra el **hostname original**, no contra la IP fijada;
la conexión usa una IP de esa misma resolución que pasó los bloqueos CIDR.
Una firma del relay autentica su respuesta, pero no prueba matemáticamente el
comportamiento de su socket: el relay y su despliegue son infraestructura de
confianza del operador y deben pasar pruebas de pinning, rangos, TLS y límites.
No se ha demostrado aquí un exploit contra metadatos de Workers; la decisión
elimina una carencia de garantía local, no certifica una explotación concreta.

El canal Edge→relay es la excepción de bootstrap: destino HTTPS fijo configurado
por el operador, sin redirects, autenticado con claves provisionadas por el
operador (sin resolver su confianza desde el mismo destino arbitrario). El relay
no es un proxy abierto: autentica peticiones, limita recursos y aplica la política
de egress en cada conexión. Peticiones/respuestas deben ligarse criptográficamente
a URL/método, identificador único, límites, vencimiento y hash de los bytes; proteger
replay y conservar las cuotas de cadena en ambos extremos. Estos son requisitos
de aceptación, no un protocolo de relay implementado.

El Worker verifica las firmas/APW/hashes de los bytes recibidos por su cuenta;
la firma del relay no sustituye las pruebas DNS/APW ni convierte SVRI en certificado
del relay. Falta de relay, fallo de autenticación o timeout no activa fallback
directo ni stale-on-error. Un resultado cacheado solo puede conservar la vigencia
ya autorizada por D6; no se presenta como una nueva comprobación externa.

## 1. Hallazgos verificados que cambian la propuesta anterior

Las referencias siguientes son relativas a la raíz del repositorio.

| ID | Veredicto actual | Evidencia archivo:línea | Consecuencia para el plan |
|---|---|---|---|
| H1 | El endpoint DoH APW ya es fijo; no hay verificación AD/DNSSEC en el cliente. El tipo de respuesta solo declara Status/Answer. | `packages/apw-resolver/src/dns-txt/dns-txt.ts:19,49-52,100-125` | A fija proveedor y política de autenticidad explícitos; no afirmar validación DNSSEC actual. |
| H2 | No se puede confirmar que B/C usen hoy pinning: `did.json`, historial, bundles y claves de emisores reciben `fetchImpl`, cuyo default es `fetch`. | `packages/apw-resolver/src/index.ts:88-107`; `did-apw/history-resolver.ts:109-133`; `scoring/reader-attestations.ts:80-91,108-114,130-138` dentro de ese paquete | Es una integración pendiente real, no una protección ya terminada. B/C deben eliminar los caminos de producción con egress directo en su alcance. |
| H3 | Node crea un SafeFetcher con lookup y fetchPinned, pero lo publica como binding del directorio WBA. Crear el binding no lo aplica a todos los resolvers. | `server/node-runtime.mjs:132-151`; `packages/apw-resolver/src/scoring/reader-identity.ts:187-220`; `functions/trust/[siteId].js:233` | Inyectar explícitamente el mismo transporte seguro en cada entrada real, no sustituir globalmente fetch. |
| H4 | Sin política activa, `/trust/:siteId` retorna antes de resolver lector/evidencia. Con política, `resolveReaderState` carga scores después de identidad/historial. | `functions/trust/[siteId].js:188-233`; `packages/apw-resolver/src/scoring/reader-identity.ts:274-290` | Esa ruta por sí sola permitiría estudiar diferir C. |
| H5 | Pero el puente público AT Protocol alcanza `loadReaderConduct` sin política de lectura activa: resuelto un handle válido y sin hit de caché, carga conducta. | `functions/trust/atproto/[handle].js:48-63`; `packages/identity-atproto/src/reputation.ts:241-247,286-302` | **C sigue siendo prerrequisito de PR3.** No basta inspeccionar únicamente `/trust/:siteId`. |
| H6 | Hay TTL de identidad de 5 min, fallo de 60 s y hasta 1.000 entradas; claves retiradas acotan éxito al final de su ventana efectiva. El puente tiene caché propia de 5 min. | `packages/apw-resolver/src/scoring/reader-identity.ts:61,133-160,281-294`; `packages/identity-atproto/src/reputation.ts:109-111,241-242,322` | La propuesta debe alinear todas las cachés; no sumar TTL ni ocultar latencia de revocación. |
| H7 | El verificador actual de cadena espera secuencia desde 1; el historial pagina con límites finitos. No tiene contrato de checkpoint incremental. | `packages/apw-resolver/src/did-apw/history-log.ts:183-225`; `did-apw/history-resolver.ts:74-75,126-148` dentro de ese paquete | B necesita un contrato incremental probado; no puede llamar al verificador actual con un sufijo y declararlo equivalente. |

El middleware permite continuar sin Trust Layer y también a solicitudes sin firma
que no parezcan bots (`functions/_middleware.js:213-220`). El puente no tiene un
gate local que exija política de lectura en su handler. Que algunas solicitudes
se rechacen en middleware no hace inalcanzable H5.

**Orden recomendado: A → B → C → evaluación de PR3.** Diferir C requeriría una
decisión adicional para desactivar/separar todos sus consumidores actuales,
incluido el puente, con migración y regresiones; no se propone hacerlo en silencio.
Endurecer evidencia existente no activa R-05 ni presupone emisores reales, en línea
con [VISION](../VISION.md#the-rule-that-decides-what-gets-built).

## 2. Contrato compartido y autenticidad DoH

Un único contexto de resolución conserva cliente confiable/unknown, origen raíz,
intentos, bytes, concurrencia, etapa, cancelación y deadline de cadena. Todo
resolver anidado hereda ese contexto. El proveedor DoH, otro emisor o una nueva
página no reinician presupuesto. La fuente de tiempo y los límites por instancia
siguen las limitaciones de [resolution-budget.md](./resolution-budget.md).

### Proveedores: lista cerrada, nunca elegida por el solicitante

- Lista inicial propuesta y aceptada para esta etapa: únicamente `https://cloudflare-dns.com/dns-query`,
  que es el endpoint presente en el código. Esto no prueba su comportamiento con
  DNSSEC ni su interoperabilidad externa: las pruebas de A usarán un servidor local.
- Como opción del dueño, permitir una lista de despliegue del operador con hasta
  el máximo de la tabla de límites. No aceptar endpoints desde headers, parámetros,
  TXT, DID, redirecciones o campos del documento del solicitante.
- HTTPS, origen/ruta exactos, sin credenciales, fragmentos ni query arbitraria;
  solo el adaptador construye name/type y parámetros DNSSEC aprobados. Rechazar
  destinos privados y no seguir redirects del proveedor.
- Selección ordenada del operador, sin carrera paralela ni retries ocultos.
  No alternar proveedores para obtener una respuesta más permisiva. Un fallback
  solo por error de transporte consume el mismo presupuesto y conserva la política.
- Validar Status, pregunta correspondiente a `_apw.<dominio>`, tipos/nombres de
  respuestas, truncamiento y límites antes de interpretar `k`/`h`. AD solo no
  corrige una respuesta para otra pregunta ni una respuesta truncada.

### Decisión D1: DNSSEC

| Política propuesta | Raíz de confianza efectiva | Consecuencias |
|---|---|---|
| **Recomendada: exigir AD=true** a un proveedor configurado que valide DNSSEC; solicitar validación, sin checking-disabled | HTTPS autentica al proveedor; **el proveedor** afirma haber validado DNSSEC. Portaless no verifica DNSSEC localmente por leer un booleano. | Dominios sin DNSSEC, AD ausente/false o proveedor incompatible no satisfacen identidad APW. Mayor exigencia de onboarding y operación. Motivo propio `dnssec_required`, sin downgrade automático ni acusación de firma inválida. |
| Aceptar confianza en el proveedor | HTTPS y corrección del proveedor recursivo; un TXT no autenticado por DNSSEC puede determinar `k`/`h`. | Mejor compatibilidad con zonas no firmadas, pero se confía también en la resolución DNS del proveedor. Declarar `provider_trusted`, nunca `dnssec_verified`. |

**D1 aprobada por el dueño:** exigir AD con independencia del proveedor DNS;
Cloudflare no es la raíz de identidad APW. La política debe ser de instalación,
versionada y visible en diagnóstico; ningún
bot puede seleccionarla. Un cambio exige aprobación/migración explícita y limpia
cachés de la política anterior. En ambos perfiles, `Status` de error/SERVFAIL o
respuesta incoherente falla; no reutilizar datos caducados. AD=true sigue
dependiendo de la honestidad/configuración del proveedor HTTPS.

**Registrar D1 y D2 aprobadas en el ADR antes de fusionar A.** La recomendación estricta
no cambia hoy la compatibilidad del producto ni añade requisitos al protocolo APW.

## 3. Egress real de B/C y contrato por runtime

El transporte a reutilizar es `createSafeFetcher` con la política compartida de
`packages/apw-resolver/src/federation/egress-ip.ts:6-13`. Incluye los rangos de
ronda 4 y posteriores correcciones, IPv4/IPv6, formas mapeadas y de transición.
`safe-fetch.ts:86-102` valida respuestas DNS y entrega la dirección elegida;
`:149-182` conecta por fetchPinned cuando está inyectado. Validar DNS y después
usar un fetch que resuelva otra vez **no es pinning**.

**Node, aceptación obligatoria de B/C:** lookup de todas las direcciones; si alguna
está bloqueada, no conectar; conectar a una dirección de esa misma respuesta,
manteniendo Host/SNI y validación de certificado del hostname. El conector existe
en `server/node-runtime.mjs:42-68`. Demostrar en las rutas reales de producción,
no solo en el factory, que did.json, cada página de historial/bundle, claves de
emisores y snapshots remotos pasan por él. No fallback a fetch directo si falta.

**Workers/Edge, objetivo D3 revisado:** no hay pinning de IP de aplicación con el
fetcher actual. Se prohíben descargas a dominios arbitrarios del solicitante. La
ruta Index fija debe entregar pruebas suficientes, sin referencias que obliguen
a completar la verificación llamando a B o emisores. El bootstrap DNSSEC/identidad
independiente se define en los dos perfiles de APW Identity Bootstrap Draft 0.1;
reenviar un AD=true del LTP Index no preserva D1. Relay privado es otra ruta explícita. Si ninguna ruta segura y
verificable está disponible, la operación externa falla cerrada con motivo propio.

La regla se aplica por capacidad efectiva de transporte/pruebas, no solo por nombre
del runtime. Una firma del Index no prueba un score ni autentica por sí sola DNS;
un relay tampoco demuestra pinning por firmar un recibo. La política no exige relay para servir HTML
público, administrar contenido local ni verificar pruebas ya disponibles localmente;
los módulos opcionales apagados y el caso estático no deben romperse.

El puente AT tiene además fetches de identidad y snapshot remoto:
`packages/identity-atproto/src/resolve.ts:147-168` y `reputation.ts:137-164`.
El inventario de A debe incluirlos: A cubre sus consultas DoH, B el transporte de
documentos/identidad y C snapshots/evidencia. No se cierra el gate si una llamada
anidada o un consumidor público conserva egress directo fuera del presupuesto.
No se añade soporte de nuevos métodos DID ni nuevos destinos externos en estas entregas.

## 4. B: historial largo sin denegación permanente por un tope por petición

**Recomendación D4: verificación incremental con estado de progreso acotado.**
El límite de páginas/entradas es por paso de resolución, no una longitud máxima
del historial legítimo. No recomendar un sufijo de la ventana de la clave por
sí solo: no prueba continuidad desde una raíz confiable ni completitud de evidencia.

1. Si existe un checkpoint previamente verificado y anclado, cargar DID, seq,
   hash de entrada, timestamp previo, identidad de claves/ventanas validadas,
   procedencia y política de autenticidad DNS, ancla observada y versión de reglas.
   Reconsultar `k`/`h` con la frescura aprobada; extender solo por `prev` y secuencia
   continuos, verificando cada firma, ventana, timestamp y nueva ancla.
2. Para bootstrap sin checkpoint, empezar en génesis y procesar un segmento por
   paso. Persistir progreso parcial separado de la caché de identidad autorizada.
   **Un prefijo aún no ligado al ancla objetivo no es una raíz confiable**: no
   otorga acceso ni autoriza claves. Solo se promueve tras verificar la cadena,
   las claves y el vínculo con el ancla DNS requerido por el protocolo.
3. Guardar estado rodante mínimo (seq/hash/timestamp/versión de claves y objetivo),
   no todas las páginas en RAM. Las referencias de atestaciones que C necesite
   requieren su propia estrategia acotada; un checkpoint de identidad no demuestra
   que el bundle completo esté presente.
4. Reanudar por DID/objetivo, single-flight y cuotas normales. Nunca lanzar una
   reconstrucción ilimitada en background por una petición. Los cursores públicos
   son datos no confiables; el cliente no elige ni importa checkpoints como verificados.
5. Si cambia una clave, ancla o versión de reglas incompatible con el progreso,
   no unir fragmentos de versiones distintas: invalidar o revalidar el progreso.
   Si hay una contradicción criptográfica, registrar ese motivo; si falta trabajo
   por hacer, informar progreso pendiente. Ni una ni otra cosa es un grant.
6. El estado de progreso tiene capacidad/retención limitadas (tabla única). Una
   cadena que supera el paso puede avanzar en peticiones sucesivas. No se promete
   procesar cualquier historial arbitrariamente grande dentro de recursos finitos;
   si no alcanza el perfil, el diagnóstico pide reconstrucción operativa acotada,
   no repite para siempre la primera página como si la firma fuera inválida.

El comportamiento normativo de entradas posteriores a `h` se conserva:
`history-resolver.ts:9-13,157-174` distingue entradas ancladas/no ancladas. Cualquier
cambio en qué porción basta para autorizar requiere decisión separada, no truncar
silenciosamente el historial al alcanzar el límite.

### Motivos públicos y operación del bot (contrato propuesto D5)

| Clase | Motivo / respuesta propuestos | Interpretación |
|---|---|---|
| Presupuesto del cliente | `resolution_client_budget_exhausted`, 429 con Retry-After | Reintentar tras la espera; no es fallo de firma. |
| Recursos/origen/backend | `resolution_origin_budget_exhausted` / `resolution_backend_unavailable`, 503 con Retry-After | Indisponibilidad operativa sin anotación de misconduct. |
| Segmento válido, trabajo pendiente | `history_verification_pending`, 503 con Retry-After y estado `incomplete` | Hay progreso local reanudable; no acceso ni reputación verificada todavía. |
| Tope de documento/estructura/deadline | `resolution_limit_exceeded`, 503 y dimensión pública del límite | No equivale a `bad_signature`; reintentar idéntico sin cambio/progreso no garantiza éxito. |
| Firma realmente inválida | `signature_invalid`, 401 | Solo después de una verificación criptográfica negativa. |
| Ancla/DID/clave incoherentes | Motivo específico (`anchor_mismatch`, `key_mismatch`, etc.), 401 | Identidad no demostrada; no colapsar todo a firma inválida. |
| Redirect deshabilitado | Motivo específico, 401 sin Retry-After | Contrato de #102; no caché de indisponibilidad. |
| Política DNSSEC no satisfecha | `dnssec_required`, 401; fallo de transporte mantiene clase operativa | Corregir DNS/proveedor; no afirmar que la firma del bot era inválida. |

El bot verá código estable, etapa, estado y acción sugerida; nunca IP cruda,
secreto, claves HMAC, cupo restante ni cursor interno reutilizable. No modificar
B3 ni convertir rechazos de infraestructura en atestaciones de mala conducta.

## 5. Caché entre peticiones y revocación

**Recomendación D6:** techo de éxito corto en la tabla única, con expiración
heredada, no deslizante. Para identidad/cadena/evidencia verificada:

`TTL efectivo = min(techo local, TTL DNS restante, vigencia restante de la clave,
frescura restante de las pruebas y de cada dependencia usada)`.

Un cache hit no inicia un nuevo plazo. Cachear no exime de verificar la firma y
nonce de cada petición ni de volver a consultar grants/política aplicables.
Separar caché de contenido/verificación de autorización. No stale-on-error.
Una clave con `validTo = null` sigue limitada por el techo de caché; no es eterna.
Para claves retiradas, conservar explícitamente la ventana efectiva que permita
el protocolo (hoy existe gracia de rollover), sin extenderla por caché.

**Ese TTL es la latencia de revocación local:** después de cambiar/retirar una
clave, un resultado anterior puede seguir aceptándose hasta expirar. No prometer
revocación instantánea ni un plazo absoluto contado desde publicar el TXT:
cachés DNS upstream y cachés HTTP/CDN externas pueden añadir demora. Todos los
consumidores locales, incluido el puente, deben heredar el mismo vencimiento para
no sumar varias ventanas locales. Acotar también max-age HTTP en respuestas que
incluyan ese resultado; un grant no debe compartirse mediante caché pública.

Capturar vencimiento de validez de pared y duración restante; usar tiempo
monótono para TTL local, sin extenderlo por retroceso de pared. Ante reloj no
confiable no se prolonga la aceptación criptográfica. Checkpoints pueden retener
integridad histórica más tiempo que la caché de autorización: retención no es
frescura ni permiso para usar una clave revocada.

La actualización debe incluir los TTL existentes: caché WBA, ReaderStateCache,
caché del puente y respuestas HTTP. Los valores actuales se documentan en H6;
el nuevo techo aprobado necesita pruebas de migración/comportamiento antes de activarse.

<a id="approved-resource-limits"></a>

## 6. Tabla única de límites aprobados (D7, baseline restrictiva)

**Aprobada formalmente por el dueño el 2026-10-23 como presupuesto restrictivo
base de implementación. E = estimado, no medido.** Los números existentes se citan como
antecedente, no como evidencia de suficiencia. **M = medición local del kernel**,
que no mide DNS/TLS/criptografía de A/B/C. Límites simultáneos: se corta al alcanzar
el primero; los máximos de cada fila no son una promesa de poder consumirlos todos.
Se cuentan páginas/bytes/intentos/firmas de consumidores anidados y emisores.

| Recurso y alcance | Tope aprobado | Fuente / justificación |
|---|---|---|
| Proveedores DoH configurados | 1 inicial; hasta 2 solo por decisión del operador | E; código actual tiene 1 (`dns-txt.ts:19`). Evitar descubrimiento controlado por bot y retries ilimitados. |
| Consultas DoH por host y paso | 1; segundo proveedor solo ante fallo de transporte | E; reutilizar resultado para DID/historial/emisor, sin downgrade DNSSEC. |
| Pregunta DNS / respuestas | FQDN hasta 253 caracteres; 8 respuestas; sin consultas recursivas ocultas | E; límite de nombre y defensa ante listas excesivas, validar también el prefijo `_apw`. |
| Respuesta DoH | 64 KiB por respuesta; 4 KiB de TXT APW concatenado | E; holgura para JSON/fragmentación, sin usar tamaño práctico de TXT como cap del transporte. |
| Documento DID | 128 KiB, 16 verification methods/claves por documento | E; perfil inicial pequeño, mayor tamaño debe diagnosticarse y medirse. |
| Página de historial | 100 entradas y 256 KiB | E; antecedente actual 500 entradas (`history-resolver.ts:74`); reducir trabajo antes de crypto. |
| Páginas/entradas de historial por paso | 4 páginas / 400 entradas en total, incluidos emisores | E; segmento reanudable y coste acotado, no tope de longitud vitalicia de cadena. |
| Claves de historial/emisor | 16 por documento, 48 distintas por resolución completa | E; lector + hasta 2 emisores, sin importar claves arbitrarias de documentos enormes. |
| Bundle de evidencia por paso | 4 páginas × 100 entradas; 256 KiB por página | E; misma capacidad de segmento que historial. No aceptar un bundle truncado como completo. |
| Candidatas reader_conduct a verificar | 200 por resolución | E; antecedente `reader-conduct-config.ts:46` ya selecciona 200. No usar selección para ocultar negativas o fingir completitud; exceso produce resultado parcial hasta definir resumen incremental verificable. |
| Emisores únicos de evidencia por resolución | 2 | E; fan-out multiplicativo bajo en cold start. Exceso no produce score/grant aceptado. |
| Verificaciones de firma de cadena/evidencia/WBA | 640 intentos en toda la resolución | E; hasta 400 entradas + 200 atestaciones + margen para WBA; intentos fallidos también consumen. |
| HTTP egress por resolución completa | 24 intentos, redirects incluidos | E; holgura para WBA, DoH/DID, segmentos y 2 emisores; sin retry nuevo por etapa. |
| Bytes por resolución completa | 4 MiB de body acumulado, cap individual máximo 512 KiB | E; directorio ya propone 512 KiB; subcaps DoH/DID/páginas más bajos. Limitar antes de parsear. |
| Deadline completo | 10 s; cada hop como máximo 3 s y nunca más que el restante | E; el transporte actual propone 8 s por hop (`safe-fetch.ts:67-70`), no es deadline global. Medir latencias reales locales dentro del límite aprobado. |
| Redirects A/B/C | 0 por defecto | E; conserva contrato de #102; futuro soporte requiere propuesta por salto, sin ampliar esta tabla tácitamente. |
| Concurrencia local | 8 total, 4 por cliente, 1 por host de destino | E; antecedentes `resolution-budget.ts:27-31` y single-flight de directorio. No cuota distribuida. |
| Cuota cliente / ventana | 40 intentos / 16 MiB por 60 s | E; **cambio aprobado** frente a 20/8 MiB actuales: permitir un paso cold completo de hasta 24 hops. Requiere medición/implementación; no es un default ya cambiado. |
| Cuota origen raíz / ventana | 32 intentos / 8 MiB por 60 s | E; **cambio aprobado** frente a 8/4 MiB actuales: no hacer imposible una cadena legítima por diseño. Raíz preservada al consultar emisores/proveedor compartido. |
| Capacidad de cuota | 4.096 buckets por instancia | M: `resolution-budget.md`, medición sostenida de #102, p50/p95/p99 0,006250/0,012583/0,044333 ms con transporte sintético. No valida los nuevos límites de red. |
| Caché positiva entre peticiones | 60 s máximo; nunca más que cada dependencia/clave | E; reduce TTL de identidad/puente de 5 min y WBA de 10 min. Declara latencia local de revocación. |
| Caché negativa | 15 s para ausencia/invalidación estable; 0 para cuota, deadline, fallo transitorio, progreso pendiente y redirect deshabilitado | E; recuperación rápida sin tratar infraestructura como identidad inválida. |
| Capacidad de caché de resolución | 256 hosts por clase, LRU de datos cacheados | E; antecedente de cachés WBA de 256. No confundir con desalojo de cuotas agotadas. |
| Progreso incremental / checkpoints persistidos | 64 progresos, 256 checkpoints por instancia; 24 h de retención máxima | E; estado rodante acotado y reanudación, sin TTL de autorización de 24 h. Medir tamaño/disco antes de B. |
| Harness de carga local | datasets de 1, 4 y 8 páginas; 1, 2 y 3 emisores; cadena de bootstrap de 1.000 entradas | E; casos bajo/en/sobre topes y una cadena mayor que un paso. Medir 30 repeticiones cold y 100 warm por escenario válido; negativos verifican límites y conexiones, no percentiles de una sola muestra. |

Las cuotas por ventana superiores a las actuales son **límites base aprobados,
aún estimados y por medir**, no defaults ya implementados. A debe medir también continuidad de alias HMAC, tabla
llena con denegaciones protegidas y aggregate egress por instancia. Si los datos
contradicen un número, actualizar propuesta/ADR y pedir nueva aprobación antes
de fusionar; no ajustar silenciosamente para hacer pasar un fixture.

## 7. Harness compartido: se entrega una vez en A

Ubicación propuesta: `tests/support/resolution-harness/`. A entrega CA y claves
sintéticas, servidor HTTPS con puertos efímeros, DNS/transporte inyectados solo
en tests, contadores de conexiones/bytes y modos normal, headers lentos, body
lento, redirect/ciclo, JSON inválido y body enorme. B/C importan este módulo;
no mantienen copias de CA, servidor o transporte de prueba.

Los hosts lógicos se conectan a loopback mediante dependencias explícitas del
harness. No se añade una variable de producción para permitir IP privadas ni se
deshabilita TLS. Tests separados demuestran que la política real bloquea loopback,
metadata, rangos de ronda 4 y rebinding sin llegar a un servidor prohibido.
No hay fallback a DoH público ni carga contra dominios de terceros.

**Regresión requerida en A:** examinar el grafo de módulos de producción
(`src`, `functions`, `server`, `packages` y entradas runtime de `scripts`) y sus
imports/reexports estáticos y dinámicos resolubles, incluidos aliases. Fallar
si alcanza el harness o un fixture de tests. Incluir un caso negativo sintético
con import/reexport indirecto para demostrar que la guarda realmente falla.
Imports dinámicos no resolubles se revisan explícitamente; un grep literal no
prueba aislamiento. El harness no se exporta por paquetes de producción ni se
incluye en artefactos runtime. No activar DNS/transporte de prueba desde env/HTTP.

## 8. Entregables y aceptación por PR

### A — TXT/DoH, contexto base, caché y harness

- Adaptador fijo DoH con la política D1/D2 seleccionada, transporte seguro y
  Accept correcto; mantiene raíz/cliente, bytes, deadline y cancelación.
- Contexto base sin dependencia inversa nueva de `apw-resolver` hacia Trust Layer.
- Harness compartido y guarda de imports; inventario de consumidores APW/puente.
- Negativos: dominio/pregunta inválidos (cero egress), AD ausente/false, Status
  error, respuesta de otra pregunta, truncamiento, exceso TXT/respuestas, timeout,
  body enorme, redirect, fallback que intenta downgrade, cuota agotada y cancelación.
- Medir con el servidor local de A: latencia completa p50/p95/p99, consultas
  iniciadas/evitadas por caché/single-flight, bytes, memoria y leases activos.
- D1/D2/D3/D6/D7 registrados en ADR antes de fusionar. A sola no cierra el gate.

### B — Documento DID e historial incremental

- Adaptadores seguros para todos sus consumidores reales, incluido el transporte
  de identidad del puente; ningún default fetch directo en las rutas protegidas.
- Contrato de progreso/checkpoint D4 y diagnósticos D5; reutilizar DoH de A.
- Negativos: rebinding/redirect privado, DID/clave distintos, firma inválida,
  ventana de clave cerrada, cursores cíclicos/retrocesos, cambio de objetivo entre
  páginas, exceso de claves/bytes, abort en página intermedia y pérdida de backend.
- Probar cadena de 1.000 entradas en múltiples pasos hasta verificarla, sin
  autorizar prefijos no anclados. Probar corrupción después del checkpoint y
  expiración/reanudación de progreso. No convertir un cap en firma inválida.
- Medir HTTPS local con cadenas sintéticas firmadas: p50/p95/p99 por paso y total
  de reconstrucción, fetches, firmas, bytes, RAM/disco, progreso retenido y latencia
  de revocación cacheada. Conservar pruebas TLS/SNI y rangos bloqueados existentes.

### C — Evidencia, emisores y consumidores públicos existentes

- Bundle, claves/historial de emisores y snapshots remotos del puente usan el
  mismo contexto/transporte. No resolver reputación de los emisores recursivamente.
- Distinguir completar identidad de completar evidencia: el checkpoint de B no
  permite omitir atestaciones negativas. Si el corpus excede el segmento, devolver
  parcial/límite; el diseño de resumen incremental completo necesita revisión,
  no inventar un score con la porción disponible.
- Negativos: exceso de emisores/candidatas, duplicados, JWS/hash/chain mismatch,
  clave caducada, bundle incompleto, body enorme, proveedor lento/redirigido,
  falta de datos y corte antes de consultar el siguiente emisor al agotar cuota.
- Probar explícitamente H5 con política de lectura ausente/desactivada y un handle
  AT resuelto en fixtures: comprobar que esos fetches también están acotados.
- Medir corpus sintético con HTTPS local: p50/p95/p99, fan-out, verificaciones,
  bytes/RAM, reuso de claves y cero egress posterior a una denegación.
- R-05 y admisión por reputación siguen bloqueadas por emisores/datos reales.
  La futura ruta grant-only no debe llamar a loadScores incidentalmente.

Cada PR incluye hipótesis → test que reproduce → corrección confirmada → evidencia
archivo:línea → commit; Vitest/build/manifests/Playwright y checks requeridos verdes.
Un PR abierto, revisión de linstarkcorp y fusión manual del dueño. **PR3 no empieza
hasta cerrar A+B+C, la cobertura de todos los consumidores reales y las decisiones
del dueño; ni tres adapters aislados ni tests del kernel sustituyen esa evidencia.**

## 9. Registro de decisiones del dueño

| ID | Decisión | Estado / recomendación | Consecuencia / gate |
|---|---|---|---|
| D1 | Exigir AD/DNSSEC o confiar en el proveedor | **Aprobada:** AD obligatorio con independencia del proveedor; lo valida el proveedor, no Portaless | Puede excluir zonas no firmadas. Registrar en ADR antes de A; sin fallback permisivo. |
| D2 | Lista y fallback DoH | **Aprobada:** endpoint actual único en esta etapa; extensiones solo del operador | No dependencia normativa de Cloudflare ni descubrimiento desde la petición. Verificar interoperabilidad de cada alternativa. |
| D3 | Resolución externa en Workers/Edge | **Aprobados dirección y contratos baseline:** LTP Index + LTP Proof Package, bootstrap independiente; APW para identidad/estructura, SVRI/HSVR para salidas; relay opcional | Programación bloqueada hasta fusionar el commit documental. Publicación final, vectores y activación siguen pendientes; fail-closed. |
| D4 | Historial mayor que un paso | **Aprobada:** progreso incremental separado de checkpoints confiables; sin autorización parcial | Requiere persistencia y extensión del verificador en B; no basta truncar a ventana de clave. |
| D5 | Motivos públicos y HTTP para límite/progreso/crypto | **Aprobada** la recomendación de sección 4, preservando el 401 de redirect de #102 | Distinguir límite, espera, configuración e identidad inválida; sin misconduct por infraestructura. |
| D6 | TTL y latencia de revocación | **Aprobada:** techo corto y vencimiento heredado, sin stale ni suma de cachés | Revisar rollover y HTTP/CDN; no prometer revocación instantánea. |
| D7 | Tabla única de límites | **Aprobada formalmente como presupuesto restrictivo base**, estimado, no como medición realizada | Registrada en ADR; cualquier ajuste posterior por mediciones requiere nueva aprobación. |
| D8 | Orden de C | **Aprobada:** C antes de PR3 por el puente público alcanzable hoy | Dos consumidores con usos distintos, motor común; sin activar R-05 ni fabricar datos. |
| D9 | Regla de borde y garantía por instancia | **Aprobada:** edge-first + cuotas locales aproximadas documentadas en #102 | N instancias, reinicios y día HMAC no dan cuota global. Backend compartido requiere contrato propio si se exige. |

**Cierre de fase documental:** D1–D9 y los contratos quedan aprobados como baseline,
con raíz independiente y presupuesto restrictivo expresos. El registro está en el
ADR y los [gates restantes de estandarización](../protocol-apw/LTP-STANDARDIZATION-STATUS.md).
La fusión del commit documental habilita iniciar exclusivamente el trabajo del motor;
no habilita la ruta Edge, PR3 ni certifica interoperabilidad. Los vectores,
verificadores independientes y aceptación de runtime siguen pendientes antes
de publicar el estándar final y anunciar soporte. Este documento no cambia código
ni la especificación normativa vigente.
