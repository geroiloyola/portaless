## Protocolo APW y Veranet

Portaless es la implementación de referencia de **Protocol APW (Air Portal Website)**: un protocolo abierto de identidad criptográfica y confianza verificable para sitios web independientes, publicado formalmente en septiembre de 2026 ([especificación completa](./APW-SPEC-v1.0.md)).

**El problema que resuelve**: hoy no existe ningún mecanismo técnico completo, descentralizado y gratuito que permita a un agente de IA (o a un humano) verificar si un sitio es confiable sin depender de un dominio de alta reputación, sin una autoridad central certificadora, y sin señales proxy circunvenibles.

**Cómo lo resuelve**: cada sitio publica su identidad criptográfica (Ed25519, RFC 9421) y un `SiteTrustScore` público calculado de 4 fuentes independientes y auditables — autodeclaración, verificación de agentes de IA, voto comunitario, y reportes de custodia externos. Todo el diseño está preparado para crypto-agilidad post-cuántica desde el esquema de base de datos (columna `key_algorithm`, migración futura a ML-DSA / FIPS 204 sin perder la cadena de custodia).

**Veranet**: es el nombre del resultado final hacia el que converge Protocol APW — una red de sitios verificablemente confiables, con identidad criptográfica inmutable y post-cuántica, donde ningún humano, máquina, agente o IA puede falsificar la procedencia de un sitio o de su contenido sin que quede una señal auditable públicamente. Veranet no es una plataforma centralizada: es el estado de la red cuando suficientes sitios independientes adoptan Protocol APW y se descubren entre sí a través del **Portaless Index** — una capa de descubrimiento federado, con identidad verificable, score de confianza previo a la agregación, y capacidad de cobro por acceso incorporados desde el diseño.

**Estado real de implementación** (verificable por commit, no por promesa): la verificación de identidad de agentes y `SiteTrustScore` están implementados y en producción en este repositorio. `packages/apw-resolver/` (la resolución de identidad vía DNS) es, al momento de esta publicación, una especificación formal sin código — ver `ROADMAP.md` para el estado exacto y actualizado de cada pieza.

Fecha de publicación de esta especificación: **septiembre de 2026**.
