Roadmap técnico + análisis competitivo — Portaless

Documento 2. No repite la revisión de seguridad ya entregada: los hallazgos aparecen únicamente como identificadores que funcionan como habilitadores técnicos. Si necesitás el detalle de un ID, está en el informe anterior.

Etiquetas genéricas usadas a pedido:

    Incumbente A — CMS monolítico de código abierto, el más desplegado del mundo, extensible por extensiones, con adaptador MCP oficial publicado en 2026.
    Incumbente B — constructor visual de páginas líder de mercado, con MCP en beta desde septiembre de 2026.
    Categoría C — plataformas "prompt → sitio" (SaaS) que generan un sitio completo desde una descripción.

PARTE I — Roadmap técnico

1. La tesis de secuencia

El error clásico de un proyecto así es tratar los fixes como "deuda" y las features como "producto", en paralelo. Acá no aplica: casi ningún fix es una tarea de higiene — cada uno es la llave de una feature que hoy es imposible.

Tres horizontes con puerta de salida explícita:

Horizonte	Nombre	Semanas	Qué se entrega	Puerta de salida (medible)
H1	Confianza operativa	1–6	Nada nuevo visible; todo desbloqueado	Instalar → sitio publicado y verificado en ≤30 min, sin terminal de DNS, 0 críticos abiertos
H2	Ciclo agente → publicación firmada	6–14	El flujo estrella + provenance	Un agente externo autorizado con grant publica una página con evidencia firmada verificable offline
H3	Red y escala	14–36	Federación real y multi‑sitio	3 nodos independientes, índice firmado, revocación funcionando

Regla de oro: no se abre un horizonte nuevo con la puerta del anterior abierta a medias. H2 sin H1 produce un flujo estrella que se rompe en el paso 4 (que es exactamente lo que pasa hoy).

2. Mapa completo: cada hallazgo → qué habilita

Los IDs remiten al informe anterior. "Habilita" es la capacidad técnica que se vuelve posible; "Feature" es lo que el usuario ve.

ID	Qué habilita (técnico)	Feature que desbloquea	H
C‑01	Sesión OAuth sujeta a segundo factor ⇒ cualquier método de login es igual de fuerte	"Entrá como quieras, con el mismo nivel de seguridad" (SSO para operadores no técnicos sin degradar 2FA)	H1
C‑02	Vinculación de identidad externa sin ambigüedad ⇒ se puede tener más de un humano por instancia	Invitaciones y equipo (roles por sitio)	H1→H3
A‑01	Un tercero no puede dejar fuera al operador ⇒ el panel es un punto de administración confiable	Acceso de emergencia: código de recuperación offline + registro de intentos	H1
A‑02	El origen propio es una decisión declarada, no una inferencia del request	Dominio canónico y cualquier endpoint que devuelva URLs propias (badges, manifiestos, webhooks)	H1
A‑03	Los documentos públicos no reflejan datos controlados por el cliente	Badges y manifiestos publicables sin riesgo de envenenar caches	H1
A‑04	La cookie viaja solo por canal cifrado ⇒ el login funciona igual detrás de túnel/proxy	Instalación "detrás de túnel" en 1 comando (la topología de referencia deja de ser frágil)	H1
A‑05	Los endpoints públicos tienen techo de costo ⇒ se pueden abrir sin convertir el nodo en amplificador	Abrir la federación al público (index sync de pares sin allowlist)	H1→H2
A‑06	La conexión de proveedor de despliegue completa su ciclo	Publicar desde el panel, de punta a punta, con cualquier proveedor cableado	H1
A‑07	Hay segunda línea de defensa en el panel ⇒ se puede afirmar "endurecido"	Perfil de despliegue endurecido vendible a agencias/entes	H1
A‑08	Los secretos de sesión no viven en claro; el costo de hashing es actual	Panel de dispositivos y sesiones (ver y revocar una sesión concreta)	H1
M‑01	Una firma de agente no se puede reutilizar ⇒ la atribución es confiable	Grants para agentes externos (base de todo H2)	H2
M‑02	Respuesta de login uniforme ⇒ no se puede enumerar la base de usuarios	Descubrimiento de instancias (endpoints públicos que revelan si existe un usuario)	H2
M‑03	La identidad del sitio y el host público son el mismo dato, siempre	"Verificado por defecto": el wizard termina con un sitio verificable sin edición manual	H2
M‑04	Las resoluciones de terceros tienen techo de tiempo y de bytes	Índice tolerante a pares lentos/caídos (operable con 20 pares)	H2
M‑05	El estado de 2FA de una sesión es un dato persistido y consultable	Acciones sensibles sin re‑pedir contraseña (step‑up por sesión, no por prompt)	H1
M‑06	Una sola política de cookie ⇒ comportamiento predecible en todo el ciclo	Login sin fricción (sin rebotes por política distinta entre pasos)	H1
M‑07	El proveedor externo declara lo que se le pide ⇒ cualquier OIDC entra	"Traé tu propio proveedor de identidad" (empresas, universidades, gobiernos)	H2
M‑08	El proceso de build no hereda secretos ⇒ se puede publicar sin exponer claves	Publicación en el host del cliente (no hay que confiar el entorno al build)	H2
M‑09	El runtime no bloquea el event loop ⇒ sirve N requests concurrentes	Múltiples sitios/instancias por nodo (requisito de H3)	H3
M‑10	El esquema es la forma completa, sin DDL en runtime	Compatibilidad D1/edge de primera clase (base del despliegue serverless)	H2
M‑11	Las Functions cargan igual en los tres runtimes	Paridad real estático / edge / self‑host (promesa de portabilidad)	H2
E‑01	Se define qué publica el índice (observaciones vs. directorio)	"Directorio de sitios verificados" como producto (no solo cache)	H3
E‑02	El ancla temporal deja de depender de que alguien pegue un TXT	Anclaje automático (publish → ancla) — el corazón de "verificado por defecto"	H2
E‑09	Las afirmaciones del producto se pueden ejecutar	Página de confianza pública (claims verificables por cualquiera)	H3

Lectura del mapa: 13 de los 21 IDs alimentan features de H1/H2. Solo 3 (M‑09, E‑01, E‑09) son estrictamente de H3. No hay forma de llegar a H2 sin cerrar H1, y no hay forma de vender H2 sin H1.

3. Grafo de dependencias

```text
                    ┌─────────────── H1 ───────────────┐
C-01 ─┐
C-02 ─┼─► F1 "SSO + sesiones revocables" ──────────────┐
M-05 ─┤                                                │
M-06 ─┤                                                │
A-08 ─┘                                                │
A-01 ───► F2 "Acceso de emergencia"                     │
                                                       ▼
A-02 ─┐                                            ┌─────────┐
A-03 ─┼─► F3 "Origen canónico" ──► F4 "Verificado   │  H2     │
A-04 ─┘        │                    por defecto" ◄── M-03 ────┤
               │                        ▲              │
A-05 ──► F5 "Presupuesto federación"    │ E-02 ─► F5b "Anclaje automático"
               │                        │              │
A-06 ──► F6 "Publicar en 1 clic" ───────┼──────────────┤
               │                        │              │
A-07 ──► F7 "Perfil endurecido" ────────┘              │
                                                       ▼
M-01 ──► F8 "Grants para agentes externos" ──► F9 "Ciclo agente→diff→aprobar→publicar"
M-02 ─┘                        │                      │
                                ▼                      ▼
                          F10 "Provenance firmada"  F11 "Bundle portable verificable"
                                                       │
                    ┌──────────────── H3 ───────────────┘
E-01 ─┐
      ├─► F12 "Índice firmado + admisión + revocación"
      │
M-09 ─┴─► F13 "Multi-sitio real"
E-09 ────► F14 "Claims ejecutables"
```

Camino crítico hacia la prueba pública de dos nodos: F6 → F3 → F5b → F12(mínimo). Nada más. F8/F9/F10 son el producto; eso es la salida de Beta.

4. Fichas de las features que importan

Cada ficha asume lo anterior cerrado. "Sobre qué se construye" apunta a piezas que ya existen en el repo (no hay que inventar la base).

F1 · SSO + sesiones revocables · H1 (2 semanas)

    Problema: hoy el operador elige entre seguridad (contraseña + 2FA) y comodidad (SSO). No debería elegir.
    Sobre qué: AuthService, SessionStore, PasswordEventStore, public-admin-paths.
    Qué agrega: lista de sesiones activas (fecha, IP aproximada, user agent, si pasó segundo factor) y botón "cerrar esa sesión".
    Aceptación: un segundo login desde otro dispositivo aparece en la lista <5 s; revocarla invalida el acceso en <1 request; el usuario ve "esta sesión no tiene 2FA" cuando corresponde.

F2 · Acceso de emergencia · H1 (2 días)

    Problema: si el operador se bloquea, la única salida es la base de datos.
    Sobre qué: first-run.mjs (el patrón de código de un solo uso ya está resuelto y bien resuelto).
    Qué agrega: código de recuperación impreso al crear el admin, canjeable una sola vez desde la CLI del nodo, con registro en el historial.
    Aceptación: canje sin acceso HTTP; el código se invalida al usarse; queda evento con hora e IP.

F4 · "Verificado por defecto" · H2 (3 semanas)

    Problema: el usuario instala, publica… y su sitio no es verificable hasta que alguien con terminal hace magia con DNS.
    Sobre qué: identidad + historial + apw-verification-status + CLI de anclaje.
    Qué agrega: el wizard ofrece pegar un token de API del proveedor DNS y hace el PATCH del TXT por vos; si no querés token, te deja un paso a paso con el valor exacto ya calculado y un botón "verificar ahora" que reintenta hasta propagar.
    Aceptación: instalación limpia → verified: true y anchor.status: "up_to_date" en ≤30 min sin terminal, en al menos 2 proveedores de DNS.

F6 · Publicar en 1 clic · H1 (1 semana)

    Problema: el publicador integrado no completa el ciclo para nadie.
    Sobre qué: orquestador de publicación + estados + reintento (ya existe) y el flujo de conexión de proveedor.
    Qué agrega: nada nuevo conceptualmente; arregla el camino para que el botón "Publicar" termine en una URL viva.
    Aceptación: 3 corridas consecutivas de punta a punta; un fallo reintenta y deja estado legible; un viewer no puede disparar la publicación.

F8 · Grants para agentes externos · H2 (3 semanas) — la feature bisagra

    Problema: hoy un agente externo es un token con acceso total o nada. Es lo mismo que ofrecen los incumbentes.
    Sobre qué: permission_grants + agent_access_policy + capability tokens + ledger de uso + verificación Web Bot Auth.
    Qué agrega: un grant dirigido a un DID de agente con: capacidades concretas, scope (qué páginas/secciones), cuota (N operaciones/día), vencimiento y revocación inmediata. La política se publica y se aplica en el origen.
    Aceptación: un agente autorizado solo puede tocar lo declarado; al vencer el grant recibe 403 en el siguiente request; el ledger muestra exactamente cuánto usó; revocar corta sin reiniciar servicios.
    Por qué es bisagra: convierte "MCP" en "gobernanza de agentes". Es la única feature de la lista que un incumbente no puede copiar sin reescribir su modelo de identidad.

F9 · Ciclo agente → diff → aprobación → publicación · H2 (4 semanas)

    Problema: la IA genera y el humano aprueba a ciegas, o no aprueba nada.
    Sobre qué: propuestas de revisión + aprobaciones + preview privado + estados de publicación (todo existe).
    Qué agrega: vista de diff por nodo del layout (no por línea de HTML), aprobación con un clic, y botón "publicar esta revisión" que arrastra la cadena de evidencia.
    Aceptación: agente propone → humano ve qué cambia → aprueba → publicado; cada paso queda en el feed de actividad con actor identificable; un rechazo no toca el sitio público.

F10 · Provenance firmada · H2 (3 semanas)

    Problema: no hay forma de demostrar, meses después, qué generó qué y quién lo aprobó.
    Sobre qué: el patrón de declaredOrigin firmado que ya usás en imágenes, extendido a PageLayout y al snapshot de publicación.
    Qué agrega: cada publicación emite un manifiesto firmado: hash del snapshot, revisiones incluidas, actor humano, DID del agente, grant usado, declaración human|ai|mixed.
    Aceptación: un tercero, con solo el manifiesto y la clave pública del sitio, verifica sin hablar con el servidor; alterar un byte invalida la verificación.

F11 · Bundle portable verificable · H2 (2 semanas)

    Problema: "tu sitio es tuyo" es una promesa; hoy se puede exportar, pero no demostrar que el export es el original.
    Sobre qué: el índice de revisiones por publicación y el paquete de portabilidad ya existentes.
    Qué agrega: un .tar con layout + manifiesto + firmas + verificación offline (npx verificar-bundle).
    Aceptación: el bundle verifica en una máquina sin red y sin la instancia de origen; detecta un layout modificado.

F12 · Índice firmado + admisión + revocación · H3 (6 semanas)

    Problema: un índice sin firma no es infraestructura, es un cache; y sin admisión ni revocación no es un grafo, es una lista.
    Sobre qué: el pipeline de testigos (verificación de punta a punta, anclaje, calibración) ya está; falta la capa de gobernanza.
    Qué agrega: documento firmado por el nodo; política de quién puede testificar (peso base ≠ default); endpoint de revocación con efecto inmediato; y un registro público de altas/bajas.
    Aceptación: un tercero verifica el índice con una sola firma; retirar un sujeto deja de aparecer en el siguiente GET; un testigo no admitido no aporta peso.

F13 · Multi‑sitio real · H3 (8 semanas) — el techo de adopción

    Problema: una agencia con 8 clientes necesita 8 instalaciones. Cada tabla lleva site_id, pero el código fija el sitio por defecto en cada handler.
    Sobre qué: el modelo de datos ya está preparado; lo que falta es la capa de API/UX y el scoping por rol.
    Qué agrega: N sitios por nodo, roles por sitio (editor/publisher/viewer), identidad y clave por sitio, y un selector en el panel.
    Aceptación: un usuario publisher del sitio B no puede publicar en A; dos identidades conviven con cadenas independientes; el ledger se consulta por sitio.
    Por qué importa más de lo que parece: sin esto, el producto tiene un techo de un cliente por despliegue, y el modelo de negocio de proveedores (que es donde está el dinero en el ecosistema) no puede existir.

5. Qué NO hacer en estos 9 meses (y por qué)

Tentación	Por qué no
Marketplace de extensiones / plugins	Requiere un foso que no tenés (masa crítica de autores) y una revisión de seguridad externa del sandbox que sigue pendiente. Con 7 de 12 capacidades reales, un marketplace se llena de "próximamente".
Comercio / checkout propio	Ya está bien resuelto como "consumir catálogo externo". Reimplementar pagos en un proyecto de un maintainer es el atajo más corto a un incidente.
Editor con IA generativa nativa (chat dentro del editor)	Es exactamente donde compiten la Categoría C y el Incumbente B, con más recursos y mejor UX. Vos tenés el resultado (layout estructurado), no la generación.
Multi‑región / alta disponibilidad	La unidad de despliegue es un nodo con SQLite. La resiliencia correcta hoy es backup firmado + restore probado, no clúster.
App móvil	El panel ya es responsive; el esfuerzo no compra ninguna de las tres features que importan.
Firmar el contenido con transparencia tipo log público global	Requiere infraestructura de logs de transparencia (tipo CT) que no existe para sitios. Es investigación, no roadmap. Anotalo como norte; no como tarea.

6. Doble uso: cada feature vende dos cosas

Esto es lo que hace que el roadmap sea comercialmente coherente: no hay feature que sirva solo al usuario final o solo a la tesis de protocolo.

Feature	Vende al operador	Vende a la red
F4 Verificado por defecto	"Tu sitio es verificable sin saber DNS"	Un nodo más con identidad anclada
F8 Grants de agentes	"Decidís qué agente toca qué"	Políticas comparables entre sitios ⇒ semántica común
F10 Provenance	"Podés demostrar qué se publicó y cómo"	Evidencia verificable sin confiar en el nodo
F11 Bundle portable	"Te podés ir con todo y demostrarlo"	Export verificable ⇒ menos lock‑in, más adopción
F12 Índice firmado	"Encontrá sitios verificados"	Grafo con gobernanza real
F13 Multi‑sitio	"Gestioná los sitios de tus clientes"	N nodos con N sitios ⇒ densidad

Si una feature no aparece en las dos columnas, no entra al roadmap. Es el filtro más útil que tenés.

7. Puertas de salida, en números

H1 se cierra cuando:

    Instalación limpia → sitio publicado y verificado en ≤30 min, en 2 proveedores de DNS distintos, sin terminal.
    0 hallazgos críticos/altos abiertos; los medios con test de regresión.
    Un test de contrato por flujo compuesto (conexión de proveedor, login→2FA→cookie, propuesta→publicación).

H2 se cierra cuando:

    Un agente externo, autorizado con grant y sin credenciales del panel, produce una página que un humano aprueba y se publica.
    El bundle de esa publicación verifica offline, alterando el layout falla.
    El ciclo completo, cronometrado, ≤10 minutos para un usuario no técnico.

H3 se cierra cuando:

    3 nodos con operadores distintos: cada uno indexa a los otros dos, el índice verifica con una firma, y revocar a uno se propaga en <1 sync.
    Una agencia gestiona 3 sitios de 3 clientes en un nodo, con roles aislados y cadenas independientes.

PARTE II — Análisis competitivo

8. El mapa real de competidores

No hay un competidor. Hay tres, con fortalezas incompatibles entre sí:

	A — CMS monolítico dominante	B — constructor visual líder	C — prompt‑a‑sitio (SaaS)	Portaless
Origen	Ecosistema de extensiones, 20 años	Diseño visual, masa instalada	Velocidad, precio, cero infra	Protocolo + CMS
Modelo de escritura por agentes	Adaptador MCP oficial sobre su API de capacidades (2026)	MCP en beta desde sep‑2026, genera estructura editable	La generación es el producto	MCP + capabilities + grant por DID
Identidad del agente	Usuario + contraseña de aplicación / OAuth	Sesión del constructor	No aplica	DID + firma por request
Aislamiento de extensiones	Código en el mismo proceso	Código en el mismo proceso	N/A (SaaS cerrado)	Sandbox con capabilities
Aprobación humana	Borrador + confirmación explícita	Todo cae en borrador por diseño	Publicación directa	Propuesta + revisión + preview
Verificabilidad del resultado	—	—	—	Cadena firmada + testigos
Portabilidad	DB + PHP (exportable con trabajo)	Depende del constructor	Cautivo	Export verificable
Multi‑sitio	Nativo (multisite)	Multisitio en planes altos	N/A	❌ hoy (F13)
Costo de infra	Hosting + DB	Hosting	Suscripción	~0 (estático) o 1 VPS
Ecosistema	Decenas de miles de extensiones	Miles de plantillas	N/A	0 hoy
Distribución	Ubicuidad	Marca	Marketing pagado	Ninguna

Lo primero que hay que aceptar: A y B ya tienen el flujo "IA edita tu sitio con aprobación". Perdiste esa carrera por 8 meses y no la vas a ganar. Portaless no compite en "generar"; compite en "gobernar y demostrar".

9. Qué pueden copiar y qué no

Esta es la parte fina: distinguir feature de arquitectura.

Capacidad	¿Copiable por A?	¿Copiable por B?	Por qué
Generar páginas con IA	Ya lo tienen	Ya lo tienen	—
Todo cae en borrador hasta aprobar	Ya lo tienen	Ya lo tienen	—
Editor estructurado con vocabulario cerrado	Sí (ya lo hicieron una vez)	Ya es su modelo	No es foso
Panel de grants con cuotas y vencimiento	Sí, con esfuerzo	Difícil (no tiene modelo de usuarios)	Requiere un modelo de principal que no existe en su núcleo
Identidad criptográfica del agente	Difícil	Muy difícil	Su unidad de identidad es "usuario con sesión", no "clave que firma cada request"
Política publicada y aplicada en el origen	Difícil	Muy difícil	Su política vive en el hosting/CDN o en el código de la extensión, no en el sitio
Historial firmado anclado en DNS	Muy difícil	Muy difícil	No tienen cadena de historial de la identidad del sitio
Export que se verifica offline	Difícil	Casi imposible	Su formato de salida es dependiente del constructor
Sandbox de extensiones	Muy difícil (rompe todo el ecosistema)	Muy difícil	Cambiar el modelo de extensiones rompe 20 años de compatibilidad

La asimetría central: A no puede endurecer su modelo de extensiones sin romper su ecosistema; B no puede exportar verifiablemente sin dejar de ser un constructor. Sus fosos son exactamente lo que les impide copiarte. Eso es lo que hay que explotar.

10. Dónde NO pelear (y por qué perderías bien)

    Variedad de plantillas y diseño. B gana con años de luz. Tu contraoferta no es "mejor diseño", es "tu agente genera y vos ajustás en 3 minutos".
    Ecosistema de extensiones. A tiene decenas de miles. Con 7 de 12 capacidades reales, ni te presentes.
    Tiempo hasta la primera vista previa. C gana en segundos; vos competís en el minuto 10, cuando el usuario pregunta "¿y esto quién lo tocó?".
    SEO y contenido educativo. Perderías meses. Tu canal son los operadores que ya tienen el problema, no el tráfico genérico.
    Precio como argumento. Gratis es una trampa: tu costo real es tiempo de un maintainer. El argumento es costo de salida, no costo de entrada.

11. Dónde ganar (los tres ICP concretos)

ICP 1 — Agencia que entrega sitios a clientes con obligación de transparencia.
Necesita: demostrar qué se publicó, quién lo aprobó, qué parte generó una IA. Hoy lo resuelve con capturas de pantalla. Paga por F10 + F11 + F13.
Argumento: "Entregás el sitio con un certificado, no con un correo".

ICP 2 — Operador individual técnico con agentes propios.
Necesita: que su agente de confianza edite sin darle las llaves del reino, y poder cortarle el acceso en un segundo. Paga por F8.
Argumento: "Tu agente con permisos de agente, no con tu contraseña".

ICP 3 — Sitio de nicho que quiere controlar el crawl de IA sin depender de su CDN.
Necesita: política por agente, ejecutada en el origen, portable si cambia de hosting. Paga por F4 + F8.
Argumento: "La política es del sitio, no del proveedor de turno".

Los tres comparten una propiedad: no te comparan con A ni con B en diseño. Te comparan con "no tener nada".

12. Escenarios de respuesta competitiva

Escenario	Probabilidad / plazo	Qué haría Portaless
A o B lanzan "provenance firmada" de contenido	Media, 12–18 meses	La suya será propietaria y de plataforma. La tuya es del sitio y verificable sin ellos. Publicá la suite de conformidad como terreno neutral.
Un CDN grande ofrece "verificación de agentes" en el edge	Alta, ya está pasando	No compitas en el edge: competí en el origen. El CDN decide sobre el tráfico; vos decidís sobre el contenido y dejás la decisión escrita y firmada en el sitio.
A implementa identidad de agente con firma por request	Baja‑media, 12–24 meses	Necesitaría tocar su modelo de usuarios. Si lo hace, tu ventaja se reduce a historia + portabilidad. Acelerá F10/F11.
C (prompt‑a‑sitio) agrega gobernanza de agentes	Baja	No puede: no tiene el sitio, tiene la suscripción.
Un proveedor de hosting empaqueta Portaless y vende el plan	Alta, y es el mejor final	El core no compite con sus proveedores: les da la capa de confianza que ellos revenden. Ese es el modelo (ya está escrito en tu propia visión).
Nadie adopta la federación	Media‑alta	El producto sigue funcionando como CMS verificable de un solo nodo. El roadmap no debe depender de H3 para tener valor.

Ese último punto es el más importante del análisis: H1 y H2 valen por sí solos; H3 es opcional y multiplicador. Un roadmap que se cae si la red no prende es un roadmap mal secuenciado.

13. La frase de posicionamiento que se desprende de todo esto

Los incumbentes compiten por quién genera mejor.
Portaless compite por quién puede demostrar qué pasó.

    A y B te dicen: "mirá qué rápido hice tu sitio".
    Portaless tiene que decir: "mirá quién lo tocó, bajo qué reglas, y verificálo sin creerme".

Eso no es marketing: es la única columna de la tabla del punto 8 donde las otras tres están vacías, y es la única que no se puede llenar sin cambiar su arquitectura.

14. Resumen ejecutivo en 6 líneas

    13 de 21 hallazgos son llaves de features, no deuda: cerrar H1 no retrasa el producto, lo desbloquea.
    El flujo "IA edita con aprobación" ya está commoditizado: no es el foso, es el gancho.
    El foso es la gobernanza del agente (F8) y la provenance (F10): únicas columnas que los otros tres no pueden llenar sin reescribir su núcleo.
    H3 no es requisito de valor: el CMS verificable de un nodo se sostiene solo.
    Multi‑sitio (F13) es el techo silencioso de adopción y nadie lo está mirando; el modelo de datos ya lo soporta.
    El filtro para cada feature nueva: ¿vende al operador y a la red? Si no, no entra.
