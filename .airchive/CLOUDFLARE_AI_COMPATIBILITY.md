# Compatibilidad de Portaless con el ecosistema de IA de Cloudflare

Estado real, verificado contra la documentacion publica (octubre 2026). La regla es no declarar compatibilidad con nada que no se pueda comprobar.

## Resumen

| Pieza | Estado | PR |
|---|---|---|
| llms.txt (llmstxt.org v2) | Implementado en build estatico | PR D |
| Markdown por post (`/blog/<id>.md`) | Implementado | PR D |
| Content Signals en robots.txt | Generador existe (`robots-generator.ts`), sin conectar | Pendiente |
| Web Bot Auth en runtime Node | Pendiente de paridad con draft-03 | PR C |
| Pay Per Crawl | Pendiente; depende de Web Bot Auth | PR E |

## llms.txt

- Formato llmstxt.org v2: H1 obligatorio, blockquote, secciones H2 con links, `## Optional`.
- Un llms.txt describe lo que esta bajo su path, asi que respeta el `base` de Astro (GitHub Pages bajo `/repo/`).
- Fuentes: coleccion `posts` sin borradores y `src/content/pages/*.json`. El contenido de la tabla `pages` (D1/SQLite) no existe en build y queda afuera.
- Coherencia con el Trust Layer: si `portaless-content-policy.json` bloquea `ai_input`, el llms.txt no lista contenido; solo el aviso y el link a la politica.
- `llms-full.txt` NO es parte de la especificacion v2. No se genera ni se presenta como estandar.
- No hay anuncio verificado de que el AI Search de Cloudflare lea llms.txt. Se implementa por valor propio, no por esa razon.

## Web Bot Auth (PR C)

Requisitos de Cloudflare para la paridad:

- `Signature-Agent` como string estructurado entre comillas (draft-03). La forma de diccionario (`sig2="..."`) se rechaza.
- `Signature-Input` con `tag="web-bot-auth"`, `keyid` (thumbprint JWK) y Ed25519.
- Directorio de claves en `/.well-known/http-message-signatures-directory`.
- Cloudflare no valida `nonce`; recomienda `expires` cortos.

Pendiente detectado: `functions/_middleware.js` responde 403 `unsigned_automated_request` a pedidos automatizados sin firma cuando el Trust Layer esta activo. `/llms.txt`, `/blog/*.md`, `/robots.txt` y `/.well-known/*` tienen que quedar fuera de ese bloqueo o el indice no le sirve a ningun agente.

## Pay Per Crawl (PR E)

- Cloudflare es el merchant of record y la funcion esta en beta cerrada.
- Detras de Cloudflare: el origen NO arma el 402. Responde el header `crawler-price` (precio dinamico) y Cloudflare emite el 402 y cobra.
- Self-host sin Cloudflare: un 402 con `crawler-price` no cobra nada porque no hay quien liquide. Necesita settlement propio (por ejemplo x402, para el que Cloudflare publica una plantilla de Worker).
- Los headers de pago (`crawler-exact-price`, `crawler-max-price`) tienen que ir firmados en `Signature-Input`. Por eso PR E va despues de PR C.

## Lenguaje publico

- Si: "Compatible con llms.txt", "Content Signals desde el manifiesto de politicas", y despues de PR C "Verifica Web Bot Auth igual que Cloudflare".
- No: "el primer CMS ..." ni cualquier afirmacion que no se pueda verificar.

## Fuentes

- https://llmstxt.org/
- https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
- https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/
- https://developers.cloudflare.com/ai-crawl-control/changelog/
