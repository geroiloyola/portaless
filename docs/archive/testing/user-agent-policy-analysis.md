# Análisis — Política por familia de User-Agent con verificación de red para buscadores

Documento de análisis. No implementa nada. La decisión B3 queda para el dueño.

## Familias

- Buscadores declarados: Googlebot, Bingbot, etc.
- Agentes de IA declarados: GPTBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended.
- Previews sociales: Twitterbot, Slackbot, facebookexternalhit, WhatsApp, LinkedInBot, Discordbot.
- Monitoreo: UptimeRobot, feedly.
- Navegadores comunes.

## Comportamiento actual

- `looksLikeAutomatedAgent()` solo detecta UA con `bot|crawler|spider|gpt|claude|scrapy|python-requests`.
- El rechazo de bots sin firma ocurre antes de cargar la política (`ai_input` no lo cambia). Tests B3 actuales confirman esto.
- Propuesta pendiente (skip test): mover carga de política antes del rechazo para que `ai_input=allow` deje pasar bots sin firma. No implementar sin aprobación.

## Defaults propuestos para análisis

- Buscadores verificados (con firma Web Bot Auth o verificación de red): `allow`.
- Agentes de IA sin firma: `charge` por defecto (actual).
- Bots no verificados: `block` o `charge` según el dueño.
- Previews sociales: `allow` (necesarios para vistas previas).

## Riesgos

- Verificación de red para buscadores puede fallar por cambios de IP o por bloqueos de Cloudflare.
- Un bot que se hace pasar por navegador no queda bloqueado.
- Mover la política antes del rechazo cambia el significado de `ai_input=allow` y puede abrir el sitio a bots no deseados.
- La detección por UA es cooperativa, no criptográfica.

## Migración sin alterar instalaciones existentes

- Mantener el comportamiento actual por defecto.
- Agregar una opción explícita (ej. `PORTALESS_BOT_POLICY_MODE`) desactivada por defecto.
- No cambiar instalaciones existentes sin migración explícita.
- Documentar el cambio en `CHANGELOG.md` y en el panel.

## Qué se mostraría en el panel

- Familia detectada.
- Si está verificada por firma o por red.
- Política aplicada.
- Contador de rechazos por familia (ya existe en `/admin/agents`).

## Decisión requerida (B3)

- ¿Se implementa la verificación de red para buscadores?
- ¿Se mueve la carga de política antes del rechazo?
- ¿Qué default se usa para bots no verificados?

No implementar hasta la decisión del dueño.
