# Protocolo de atribución de bloqueo de IA

Objetivo: determinar si un bloqueo de lectura por agentes de IA proviene de Portaless, de Cloudflare o del montaje, sin asumir la causa.

## 1. Heurística actual de Portaless

`functions/_middleware.js` define:

```js
function looksLikeAutomatedAgent(request) {
  const ua = request.headers.get("user-agent") || "";
  return /bot|crawler|spider|gpt|claude|scrapy|python-requests/i.test(ua);
}
```

Solo si `ENABLE_TRUST_LAYER=true` y la ruta no es pública (`isPublicBotRoute`), un UA que coincide y no firma recibe `403 unsigned_automated_request`. Si no coincide, pasa. Si Trust Layer está apagado, todo pasa.

Rutas exentas para cualquier agente (sin firma): `/robots.txt`, `/llms.txt`, `/sitemap.xml`, `/.well-known/*`, `/blog/*.md`.

## 2. Clasificación de User-Agents (sin red)

| User-Agent | Coincide con la heurística | Resultado esperado con Trust Layer activo, sin firma |
|---|---|---|
| Googlebot | sí (`bot`) | 403 en rutas no públicas; 200 en rutas públicas |
| Bingbot | sí (`bot`) | 403 / 200 públicas |
| Twitterbot | sí (`bot`) | 403 / 200 públicas |
| Slackbot | sí (`bot`) | 403 / 200 públicas |
| facebookexternalhit | no | pasa (200) |
| WhatsApp | no | pasa (200) |
| LinkedInBot | sí (`bot`) | 403 / 200 públicas |
| Discordbot | sí (`bot`) | 403 / 200 públicas |
| feedly | no | pasa (200) |
| UptimeRobot | sí (`bot` dentro de “Robot”) | 403 / 200 públicas |
| GPTBot | sí (`bot`, `gpt`) | 403 / 200 públicas |
| ChatGPT-User | sí (`gpt`) | 403 / 200 públicas |
| PerplexityBot | sí (`bot`) | 403 / 200 públicas |
| ClaudeBot | sí (`bot`, `claude`) | 403 / 200 públicas |
| Google-Extended | no | pasa (200) |
| Navegador común | no | pasa (200) |

Nota: la detección es por User-Agent declarado. Un cliente que se haga pasar por navegador no queda bloqueado. `UptimeRobot` entra por la subcadena `bot` de “Robot”, no porque sea un crawler de IA.

Test sin red: `tests/unit/trust-layer-middleware.test.ts` → `A5: matriz sin red de User-Agents declarados` (403 para los declarados, 200 para los no detectados y rutas públicas exentas).

## 3. Tabla de resultados esperados

| Escenario | Trust Layer | Bloqueo de bots de Cloudflare | Resultado esperado |
|---|---|---|---|
| Bot declarado, sin firma, ruta no pública | on | off | 403 `unsigned_automated_request` |
| Bot declarado, sin firma, ruta pública | on | off | 200 |
| Bot declarado, sin firma | off | off | 200 |
| Bot declarado, sin firma | on/off | on | puede ser 403 de Cloudflare o challenge |
| Navegador humano | on/off | on/off | 200 (salvo WAF) |
| Agente firmado válido, `ai_input=allow` | on | off | 200 |
| Agente firmado válido, `ai_input=charge`, sin proveedor | on | off | 402 `payment_required` |
| Agente firmado válido, `ai_input=block` | on | off | 403 `ai_input_blocked_by_policy` |

## 4. Pruebas de contraste

1. Panel `/admin/agents`: contadores “declarada” por familia (Googlebot, Bingbot, other, unknown). Solo agregados, sin IP ni UA crudo.
2. Eventos de seguridad de Cloudflare: comparar con los contadores del panel.
3. Apagar `ENABLE_TRUST_LAYER` y repetir la lectura con el mismo agente.
4. Apagar el bloqueo de bots de Cloudflare (Bot Fight Mode / Browser Integrity Check / bloqueo de crawlers de IA) y repetir.
5. `curl` con distintos User-Agent a una ruta no pública y a una ruta pública.
6. Vista previa en Slack/WhatsApp/X (genera requests con UA de preview).
7. Search Console (rastreo de Googlebot).

## 5. Ruta positiva (agente propio)

Documentada por tests (`tests/unit/trust-layer-middleware.test.ts`):

- Firma válida con política por defecto (`ai_input=charge`): `402` `payment_required`, `settlement: "not_available"`.
- Firma válida con `ai_input=allow`: `200` y continúa al siguiente handler.
- Firma válida con `ai_input=block`: `403` `ai_input_blocked_by_policy`.
- La política por defecto es `charge` (no `allow`). Ver `packages/trust-layer/src/policy/manifest-schema.ts`: `ai_input: { access: "charge", price_usd: 0.002, unit: "request" }`.

Para reproducir con un agente propio se necesita una clave de prueba y un directorio de claves; el test genera el par Ed25519 y mockea el directorio. No ejecutar contra un dominio real sin una clave y un directorio publicados.

## 6. Lo que no prueba

- No distingue un bot que se hace pasar por navegador.
- No prueba disponibilidad de Cloudflare Pay Per Crawl (ver `pay-per-crawl-field-trial.md`).
- No prueba G4/G5 ni `ltp-engine` (inactivos).

## 6. Monitoreo y `/healthz` (E4)

- **Node `/healthz`:** se responde antes de despachar middlewares (`server/node-runtime.mjs:206`). UptimeRobot/Pingdom reciben `200` y no pasan por Trust Layer.
- **Cloudflare Pages:** no hay `/healthz` del runtime Node. Si existe una ruta estática o Function, el middleware global se aplica.
- **Rutas no exentas:** `/` y `/rss.xml` no están en `isPublicBotRoute` (`packages/trust-layer/src/policy/public-bot-routes.ts:12-18`); un monitor cuyo UA contiene `bot` recibe `403 unsigned_automated_request` (`functions/_middleware.js:62-65,220-235`).
- **Rutas exentas:** `/robots.txt`, `/llms.txt`, `/sitemap.xml`, `/.well-known/*` y `/blog/*.md` pasan sin firma.
- **UptimeRobot:** su UA contiene `bot` dentro de “Robot”; el test A5 confirma `403` en `/pages/foo`. Pingdom se comporta igual si su UA contiene `bot`; la cadena exacta de Pingdom no se verificó: **NO VERIFICABLE**.
- **Mitigación actual:** para Node, monitorear `/healthz`; para Pages/estático, usar `/sitemap.xml` (exento) o un monitor con UA que no contenga `bot`. No hay allowlist de monitores ni cambio de comportamiento en PR-A.
