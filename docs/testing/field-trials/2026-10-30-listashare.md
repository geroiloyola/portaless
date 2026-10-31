# Prueba de campo — listashare.com (operador asistido por el mantenedor)

Fecha de registro: 2026-10-30. Perfil: operador no técnico asistido por el mantenedor. Nodo Windows 10, expuesto con Cloudflare Tunnel, dominio listashare.com. Trust Layer activo. **No cumple criterios de salida de fases 4/5** (un solo operador, asistido).

## A0 — Reconciliación de estado

PR fusionados desde #104 (según `gh pr list --state merged`):

| PR | Título | Commit fusionado |
|---|---|---|
| #104 | docs(ltp): S1/S3 draft assets, cross-checks and extraction boundaries | `7991fe5` |
| #105 | feat(ltp): bounded G2/G3 identity acquisition and verifier | `a045a5d` |
| #106 | feat(ltp): harden live egress against SSRF and rebinding | `48f940a` |
| #107 | docs(ltp): static REP-01..REP-11 reputation vectors | `1cff35d` |
| #108 | feat(ltp): G4 SVRI reputation engine for 117 vectors | `889dfd9` |
| #109 | docs(ltp): approve Beta-first strategy and pause A/B/C | `6483985` |
| #110 | docs(testing): add P1/P2 external adoption protocol | `ffcdfa3` |
| #111 | fix(auth): close P0 web and authentication review findings | `9938ba5` |
| #112 | fix(security): close P1 auth, trust egress and headers | `714db7c` |
| #113 | fix(security): enforce login IP limit and post-audit deployment fixes | `5b81d58` (merge `301fe58`) |

Comparación con documentos:

- `ROADMAP.md`: registra P0/P1 cerrados y P2 abiertos; la sección de seguridad lista A-01 como `[x]` con residual. Coherente con #111–#113.
- `CHANGELOG.md`: no lista #111–#113 por número; los agrupa en “Post-release audit hardening (P0–P3)” y en Unreleased (G2/G4/LTP). La auditoría de seguridad P0/P1 no tiene bloque Unreleased propio fuera de la sección de seguridad.
- `README.md`: la tabla de estado dice “P0 + P1 auth/web closed; P2 findings remain open”, coherente.
- “PR #113 de auditoría”: **existe**, ya fusionado en `main` (`301fe58`). No es un PR abierto.

## A2 — Registro de campo (solo hechos)

### Qué se hizo

1. Instalación de Portaless en Windows 10.
2. Exposición del nodo con Cloudflare Tunnel hacia listashare.com.
3. Anclaje de identidad (TXT `_apw`).
4. Activación del Trust Layer (según el dueño).
5. Pruebas de lectura del sitio con Gemini, ChatGPT y Perplexity.

### Qué se observó

- Registros DNS previos de Porkbun bloquearon `tunnel route dns`.
- Variables de `.env` no se cargaron solas en PowerShell.
- El TXT `_apw` quedó con comillas escapadas.
- La verificación de identidad falló al activar un firewall local (Portmaster) y un resolvedor (Quad9), con caché ~5 minutos.
- El panel no distinguió “no pude consultar” de “registro inválido”.
- Gemini, ChatGPT y Perplexity no pudieron leer el sitio con el Trust Layer activo.
- Desde VPN un humano sí pudo leer el sitio.
- Aún no se sabe qué lo causó (Portaless, Cloudflare, robots.txt o el montaje).

### Qué falló

- Configuración DNS inicial por registros previos.
- Carga de variables en PowerShell.
- Entrada del TXT con comillas escapadas.
- Verificación DNS desde el equipo con firewall/resolvedor local.
- Lectura por agentes de IA con Trust Layer activo.

### Qué se midió (con método)

- Caché DNS observada: ~5 minutos. Método: reintentos de “Verificar ahora” y observación del cambio. No se registró hora exacta ni comando.
- No se midió TTFB, peso, número de requests ni tiempo de instalación con cronómetro.

### Qué quedó abierto

- Causa exacta del bloqueo a agentes de IA (Portaless vs Cloudflare vs robots.txt vs montaje).
- Comportamiento real de Cloudflare Tunnel respecto a `Cf-Connecting-Ip` / `X-Forwarded-For` en este entorno.
- Reproducibilidad con Trust Layer apagado y con bloqueo de bots de Cloudflare apagado.
- Aplicabilidad de la guía a Windows 10, que terminó su soporte general el 14 de octubre de 2025.

### Marcado como no verificado

- Versiones exactas de Node y Windows.
- Texto exacto de los mensajes del panel.
- Salidas de `nslookup -type=TXT _apw.listashare.com 1.1.1.1` y `8.8.8.8`.
- Configuración de Cloudflare: Bot Fight Mode, Browser Integrity Check, bloqueo de crawlers de IA.
- Configuración de Portmaster.
- Fecha/hora y prompt de cada prueba con IA.
- Versión de cloudflared y modo de túnel (quick vs named).

## Preguntas para el dueño (datos que solo él tiene)

1. ¿Qué versión de Node y de Windows 10 usaste (`node --version`, `winver`)?
2. ¿Qué texto exacto mostró el panel en cada intento (“Verificar ahora”)?
3. ¿Cuál fue la salida de `nslookup -type=TXT _apw.listashare.com 1.1.1.1` y `... 8.8.8.8`?
4. ¿Estaban activos en Cloudflare Bot Fight Mode, Browser Integrity Check y bloqueo de crawlers de IA?
5. ¿Qué reglas de Portmaster estaban activas (DNS, proceso node.exe)?
6. ¿Qué fecha/hora y prompt usaste en cada prueba con Gemini, ChatGPT y Perplexity?
7. ¿El túnel era nombrado (con dominio) o rápido (`trycloudflare.com`)?
8. ¿Se usó VPN en el navegador humano y con qué proveedor?
9. ¿Se rotó la identidad o se reancló `h` durante la prueba?

## Relación con PR-A

Este documento es el registro de campo requerido por PR-A. No importa ningún informe externo al repo; todo lo anterior es lo que el dueño reportó y lo verificado contra el código en los documentos hermanos de esta carpeta.
