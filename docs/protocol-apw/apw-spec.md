# Protocol APW (Air Portal Websites)
## Especificación Técnica Resumida

**Estado real de implementación: NO IMPLEMENTADO.** Este documento
describe el diseño conceptual del protocolo; no existe código funcional
de este componente en `packages/apw-resolver/` (ver ese paquete: es un
stub). Ver el whitepaper completo del proyecto para el razonamiento
detrás de cada decisión de diseño.

## Tesis

Protocol APW reduce la responsabilidad operativa del creador de un sitio
al mínimo indispensable — un dominio, DNS y SSL — delegando la entrega de
bytes a hosting estático gratuito (GitHub Pages, Cloudflare Pages) y
usando el DNS como plano de control de identidad y versión.

## Componentes técnicos de referencia (ya estandarizados por terceros)

- **DNSLink**: registro TXT que mapea un dominio a un CID de IPFS.
- **did:web / did:tdw**: identidad verificable resuelta vía HTTPS en
  `/.well-known/did.json`.
- Límite real de un TXT record: 255 bytes por string, ~512 bytes
  prácticos por registro sin forzar TCP.

## Lo que Protocol APW SÍ necesitaría implementar (pendiente)

- `packages/apw-resolver/src/dns-txt/`: lectura/escritura de los
  registros TXT bajo el prefijo `_apw.tudominio.com`.
- `packages/apw-resolver/src/dnslink/`: resolución de punteros de
  contenido inmutable.
- `packages/apw-resolver/src/did-apw/`: método DID propio (`did:apw`) o
  adopción directa de `did:web`.

## Limitaciones honestas

DNS no sirve bytes — solo resuelve nombres a datos pequeños. Protocol APW
nunca elimina el hosting, solo la necesidad de que el creador lo
administre directamente. Ver la sección de limitaciones del whitepaper
completo para el detalle de propagación DNS, contenido dinámico y
dependencia de la buena fe del host delegado.
