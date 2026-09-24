# Protocol APW — Especificación Formal v1.0

**Autor**: Gerardo Loyola
**Proyecto**: Portaless
**Fecha de publicación**: Septiembre 2026
**Versión analizada del repositorio**: v0.0.9.11 (rama `agentic`)
**Estado de implementación de esta versión**: Especificación formal. `packages/apw-resolver/` es un stub (estructura de carpetas prevista, sin lógica) al momento de esta publicación — ver "Estado real" más abajo.

Este documento fija la especificación citable de Protocol APW (Air Portal Website) con fecha y autoría explícitas, para que el diseño quede documentado como anterioridad verificable de forma independiente a cuándo se complete la implementación de código.

## 1. Tesis

Protocol APW reduce la responsabilidad operativa de quien publica un sitio al mínimo indispensable — un dominio, DNS, y SSL — delegando la entrega de bytes a proveedores de hosting estático con planes gratuitos permanentes, y usando el DNS como plano de control de identidad, versión, y confianza.

El problema que resuelve no tiene, hoy, ningún mecanismo técnico completo en producción: **confianza verificable en un sitio web sin depender de un dominio de alta reputación, sin autoridad central, y legible de forma nativa por agentes de IA**. Los mecanismos existentes (certificados de seguridad tradicionales, posicionamiento en buscadores, verificación de plataforma propietaria) son señales proxy circunvenibles — un sitio de phishing puede tener un certificado válido, buen posicionamiento, y años de antigüedad aparente.

## 2. Los tres componentes del stack

```
Protocol APW (identidad + confianza)
  └── Portaless Index (descubrimiento federado)
```

- **Protocol APW**: capa de identidad criptográfica y confianza verificable por sitio. Responde "¿quién es este sitio, y qué tan confiable es?"
- **Portaless Index**: capa de descubrimiento federado que agrega manifiestos y `SiteTrustScore` de múltiples instancias APW sin custodiar el contenido en sí — equivalente en espíritu a un lector de feeds sindicados, pero con identidad verificable, score de confianza previo a la agregación, y capacidad de cobro por acceso incorporados desde el diseño.

## 3. SiteTrustScore: las 4 fuentes

El componente de confianza de APW no es un puntaje único opaco — es la ponderación pública y auditable de 4 fuentes independientes, cada una con una fortaleza de señal distinta:

| Fuente | Qué certifica | Fortaleza de la señal |
|---|---|---|
| `self` | Autodeclaración del propio sitio (cumplimiento, política de privacidad, origen humano/IA del contenido) | La más débil — es la propia fuente hablando de sí misma |
| `agent` | Identidad criptográfica de un agente de IA verificado (Ed25519, RFC 9421, verificación de firma de bots) que reporta sobre el sitio | Verificación de identidad, no de veracidad del contenido |
| `community` | Votos de la comunidad (1-5), transparentes y consultables, no un número opaco | Se fortalece con volumen, débil con pocos votos |
| `escrow_report` | Reporte de un proveedor externo de custodia sobre el resultado real de una transacción | La más objetiva — es la única con ground truth externo verificable |

**Aplicación concreta al problema de procedencia de contenido generado por IA**: hoy no existe mecanismo técnico descentralizado que distinga "contenido publicado por un humano con identidad verificable" de "contenido generado por IA publicado sin responsable identificado". Las 4 fuentes, combinadas, sí pueden hacerlo — una imagen o texto con identidad `agent` verificada como IA conocida, más un score `community` que penaliza consistentemente contenido no declarado como tal, es una señal que ningún banco de contenido visual comercial ofrece hoy de forma abierta y auditable. Los metadatos técnicos tradicionales de una fotografía no son verificables criptográficamente. Los contratos legales de licenciamiento no son legibles por un agente de IA. Los estándares de procedencia de contenido que dependen de una autoridad certificadora central requieren confiar en esa entidad particular.

## 4. Timestamp criptográfico de existencia

Cada pieza de contenido firmada bajo APW incluye un timestamp criptográfico embebido, firmado con la misma clave Ed25519 del sitio publicador. Esto es funcionalmente equivalente a una prueba de existencia (el mismo principio detrás de los servicios de sellado de tiempo que anclan hashes en redes de registro distribuido), pero sin sus costos asociados: sin tarifas de transacción, sin latencia de confirmación, y sin depender de que una red de consenso distribuido siga existiendo indefinidamente. La contrapartida honesta: es una prueba más débil en inmutabilidad que un anclaje en una red de registro distribuido real, porque no hay consenso de terceros verificando la marca de tiempo — la garantía descansa en la clave privada del sitio, no en una red.

## 5. Crypto-agilidad post-cuántica

Ed25519 (curva elíptica clásica) es vulnerable al algoritmo de Shor en computadoras cuánticas con suficientes qubits estables. La columna `key_algorithm` (ya presente en el esquema real de `authorized_agents`, default `"ed25519"`) no es una promesa futura — es una decisión de esquema ya tomada, que permite que cualquier timestamp o firma emitida hoy con Ed25519 migre su cadena de custodia a ML-DSA (FIPS 204, ya estandarizado por el organismo de normas técnicas de Estados Unidos desde agosto de 2024) sin perder la historia de proveniencia cuando la amenaza cuántica sea práctica. Es la diferencia entre un sistema de procedencia diseñado para durar décadas y uno que queda obsoleto con el primer avance cuántico significativo.

## 6. Componentes técnicos de referencia (ya estandarizados por terceros)

APW no reinventa primitivas donde ya existen estándares maduros:

- **DNSLink**: registro TXT que mapea un dominio a un puntero de contenido inmutable (patrón ya usado por redes de almacenamiento distribuido de contenido).
- **did:web / did:tdw**: identidad verificable resuelta vía HTTPS en `/.well-known/did.json`.
- **RFC 9421**: firma de requests HTTP con Ed25519 para verificación de identidad de agentes automatizados — ya implementada en Portaless como base de la fuente `agent`.
- Límite real de un registro TXT DNS: 255 bytes por string, ~512 bytes prácticos por registro sin forzar TCP.

## 7. Lo que Protocol APW necesita implementar (pendiente al momento de esta publicación)

- `packages/apw-resolver/src/dns-txt/`: lectura de registros TXT bajo el prefijo `_apw.tudominio.com`.
- `packages/apw-resolver/src/dnslink/`: resolución de punteros de contenido inmutable.
- `packages/apw-resolver/src/did-apw/`: método DID propio (`did:apw`) o adopción directa de `did:web`.
- Definición formal del payload JSON publicado en el TXT record (mínimo: `siteId`, referencia al `SiteTrustScore` público, resumen de `contentKinds`).

## 8. Compatibilidad con protocolos de identidad descentralizada existentes

Existen protocolos de identidad descentralizada orientados a redes sociales que resuelven identidad y portabilidad de datos mediante identificadores descentralizados (DIDs) — cada usuario tiene una identidad portable independiente de cualquier plataforma. Pero ese tipo de protocolo está diseñado para contenido social (publicaciones, seguimientos, interacciones): no tiene un modelo de confianza para contenido web estático, no tiene score multifuente, y no tiene protocolo de settlement por acceso.

APW resuelve exactamente lo que ese tipo de protocolo no cubre. Ambos son compatibles por diseño porque comparten la misma primitiva criptográfica (clave pública/privada) y el mismo principio de descentralización sin autoridad central — el mismo par de claves podría, en principio, firmar tanto una identidad descentralizada social como un registro APW. Un agente de IA que consulte un sitio podría entonces verificar tanto la identidad social del publicador como su reputación como fuente de contenido (APW `SiteTrustScore`) — una capa de confianza combinada que no existe hoy en ningún stack tecnológico en producción.

## 9. Modelo de cobro: un modelo invertido respecto a los bancos de imágenes gratuitos actuales

Los bancos de imágenes gratuitos actuales suelen ser subsidiados por una empresa matriz de gran escala, mientras que quien crea el contenido no cobra nada salvo que participe de un nivel de suscripción específico — el modelo es centralizado y quien crea el contenido es quien menos se beneficia económicamente.

Con APW el modelo se invierte: el contenido sale del sitio soberano de quien lo crea, el registro APW identifica su origen, el `SiteTrustScore` indica cuán confiable es esa fuente, y el settlement adapter del Trust Layer puede cobrar por cada acceso verificado — directamente a quien lo creó, sin intermediario. Portaless, deliberadamente, no toca el dinero (ver "Trust Layer y Pay per Crawl: protocolo abierto, no asegurador" en `ROADMAP.md`) — solo provee el protocolo y el ledger de trazabilidad; el cobro real requiere un procesador de pagos regulado externo.

## 10. El sitio soberano como unidad básica de la web

La soberanía digital se discute hoy casi siempre a nivel de usuario (tus datos, tu cuenta, tu identidad). Pero la unidad real de publicación en la web es el sitio, no el usuario individual. La propuesta de fondo de APW es que cada sitio tenga, desde el día 0:

1. Identidad criptográfica propia, independiente de cualquier plataforma.
2. Score de confianza verificable por cualquier agente externo, sin autoridad central.
3. Mecanismo de cobro por acceso a su contenido, sin intermediario obligatorio.
4. Timestamp de existencia verificable para cada pieza de contenido que publica.
5. Capacidad de federarse con otros sitios soberanos sin perder ninguna de las cuatro propiedades anteriores.

## 11. Público objetivo y casos de aplicación concretos

Esta sección documenta, deliberadamente, tanto el mecanismo técnico como el escenario de uso real — un protocolo sin casos de aplicación concretos es solo teoría.

### 11.1 Quién puede operar Portaless + APW hoy (requiere perfil técnico)

- Desarrolladores independientes y agencias pequeñas que construyen sitios para terceros y quieren eliminar el hosting como variable de costo. El argumento de venta cambia de "gratis para quien lo construye" a "gratis de forma permanente para el cliente final".
- Constructores de proyectos personales que ya operan con control de versiones y proveedores de borde, y quieren control total sin una mensualidad de plataforma.
- Proyectos de código abierto que necesitan presencia web (documentación, landing page, micrositio de lanzamiento) con costo cero, identidad verificable, y operable por cualquier colaborador vía el servidor de agentes.

### 11.2 Quién podría operarlo con un flujo de instalación de un clic (público ampliado)

- Creadores de contenido en mercados donde una mensualidad de 10 a 30 dólares por un servicio de páginas de enlaces representa una fracción significativa del ingreso disponible. El argumento de costo cero pesa proporcionalmente al costo de oportunidad local — este es el segmento más obvio y menos explotado hoy.
- Periodistas independientes y medios muy pequeños (2 a 5 personas) que no necesitan un portal de noticias completo, pero sí un sitio con dominio propio, identidad verificable, y sin depender de una plataforma de publicación de terceros.
- Agencias de bajo presupuesto en mercados emergentes que entregan sitios a comercios locales: instalan Portaless una vez, crean sitios para múltiples clientes sin costo de hosting, y cobran solo por el servicio de creación.

### 11.3 Casos de aplicación donde converge el mecanismo técnico con el caso de uso real

**Página de enlaces con identidad verificable**: los 4 tipos de elemento de link-en-bio (encabezado de perfil, lista de enlaces, iconos sociales, bloque de tienda) permiten replicar lo que ofrecen los servicios de páginas de enlaces de pago, a costo cero y sin comisión sobre ventas. Flujo técnico: un agente de IA con acceso al servidor MCP recibe la instrucción de crear la página, genera la estructura con esos 4 elementos, y despliega el sitio — con Web Bot Auth activo desde el primer despliegue, la página ya tiene identidad criptográfica verificable antes de tener tráfico.

**Red federada de wikis temáticas verificadas**: múltiples instancias independientes sobre un mismo tema general (por ejemplo, distintas comunidades regionales de un mismo interés), cada una con su propio registro APW y `SiteTrustScore` público. El Portaless Index agrega esos registros sin custodiar el contenido, permitiendo que un buscador especializado o un agente de IA muestre "esta fuente tiene identidad verificada y X/5 de confianza comunitaria" sin que ninguna entidad central controle a ninguna de las instancias. Este es el caso donde la ventaja de APW es más clara: no existe hoy un mecanismo equivalente para una red de fuentes independientes que se autoverifican sin autoridad central.

**Portafolio profesional mantenido por un agente de IA**: quien más necesita un portafolio actualizado suele ser quien menos tiempo tiene para mantenerlo. Con las tools reales del servidor MCP (`update_page`), un agente puede agregar un proyecto nuevo o actualizar la biografía a partir de una instrucción en lenguaje natural, sin que la persona abra el editor visual.

**Micrositio de lanzamiento con identidad desde el día cero**: un proyecto que lanza un producto puede tener Web Bot Auth activo desde el primer despliegue — cualquier agente de IA que rastree el sitio encuentra una fuente con identidad criptográfica responsable detrás, antes de tener tráfico y antes de aparecer en cualquier buscador. Ninguna plataforma de costo cero ofrece esto hoy de forma nativa.

**Medio independiente pequeño con presencia verificable**: un periodista o una publicación de pocas personas no necesita un portal de noticias completo — necesita un sitio propio, identidad verificable, y costo fijo cero. Con APW, esa fuente puede declarar identidad criptográfica frente a cualquier agregador de contenido, algo que hoy solo existe mediante mecanismos costosos de registro distribuido o mediante plataformas propietarias centralizadas.

### 11.4 El patrón común

La ventaja de esta combinación no es ninguna característica aislada: es la convergencia simultánea de costo operativo cero, una IA como interfaz principal de administración, e identidad verificable desde el primer despliegue. Los constructores de sitios basados en diseño visual con IA integrada suelen tener costo asociado. Los servicios de páginas de enlaces de bajo costo no tienen identidad criptográfica verificable. Los sistemas de gestión de contenido autoalojados sin costo de licencia no traen, por defecto, ni la interfaz de IA ni la identidad verificable. Portaless es el punto donde las tres propiedades convergen a la vez.

## 12. Estado real de implementación (honestidad verificable, no marketing)

| Pieza | Estado confirmado |
|---|---|
| Verificación de firma de agentes automatizados (RFC 9421, Ed25519) | Implementado, con tests unitarios reales |
| `SiteTrustScore` — capa de datos, endpoints, UI | Completo end-to-end para las 4 fuentes |
| `key_algorithm` (crypto-agilidad post-cuántica) | Presente en el esquema real de `authorized_agents` |
| `packages/apw-resolver/` (dns-txt, dnslink, did-apw) | Stub — solo estructura de carpetas, sin lógica, al momento de esta publicación |
| Portaless Index | No existe ni como stub |
| Identidad mediante protocolo descentralizado social externo | No implementada — mencionada como dirección de largo plazo |

Este documento fija el diseño con fecha citable. La implementación de código se documenta por separado en `ROADMAP.md`, con actualizaciones verificables por commit.
