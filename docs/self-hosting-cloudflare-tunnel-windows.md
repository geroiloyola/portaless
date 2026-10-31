# Autoalojamiento con Cloudflare Tunnel en Windows 10

Borrador de guía operativa. No cambia comportamiento ni textos públicos. Verifica cada paso contra tu instalación antes de publicar.

## Alcance y límites

- El sitio depende de que el equipo esté encendido. No sustituye a un nodo privado con proyección estática.
- Windows 10 terminó su soporte general el 14 de octubre de 2025 (fuente oficial: Microsoft, fin de soporte de Windows 10). Usa esta guía solo si no podés migrar; preferí un servidor o un nodo privado.
- No compartas nunca: `cert.pem`, credenciales del túnel, `.env`, `data/` ni claves privadas.

## 1. DNS previo (Porkbun u otro proveedor)

Antes de `tunnel route dns`, revisá los registros del dominio:

- Borrá solo los registros `A`, `AAAA` y `CNAME` de `@` y `www` que apunten al hosting anterior.
- No borres `MX` ni `TXT` si hay correo (SPF, DKIM, DMARC) ni otros servicios.
- Si `tunnel route dns` falla por registros previos, eliminá manualmente los conflictivos y reintentá.

## 2. Carga de `.env` (no es automática)

Portaless **no carga `.env` por sí solo**. El runtime Node lee `process.env`:

- `server/node-runtime.mjs` usa `options.env || process.env` y `startSelfHostServer()` exige `PORTALESS_SQLITE_PATH` y `PORTALESS_PUBLIC_URL`.
- En Docker Compose, Compose sí lee `.env` del directorio actual; por eso `docker-compose.yml` usa `${PORTALESS_PUBLIC_URL:?...}`.
- En PowerShell, definí las variables en la sesión antes de arrancar:
  ```powershell
  $env:PORTALESS_PUBLIC_URL = "https://listashare.com"
  $env:PORTALESS_SQLITE_PATH = "C:\portaless\portaless.db"
  $env:PORTALESS_TRUSTED_PROXIES = "127.0.0.1,::1"
  npm run self-host:dev
  ```
- En `cmd.exe`: `set PORTALESS_PUBLIC_URL=https://listashare.com`.
- Alternativa: exportar las variables desde un script de arranque; no confíes en que un archivo `.env` se cargue solo.

## 3. TXT `_apw` por proveedor

El panel (`/admin`) genera el valor exacto en “Verificar ahora”. Copialo sin modificar comillas ni barras.

- Nombre: `_apw.<dominio>` (ej. `_apw.listashare.com`).
- Tipo: `TXT`.
- Valor: el JSON compacto que muestra el panel (ej. `{"v":2,"siteId":"listashare.com",...}`).
- El panel genera v2 con `k` cuando hay identidad `did:apw`, y `h` cuando hay historial encadenado.
- Si el proveedor envuelve el valor en comillas, dejá que lo haga el proveedor; no pegues comillas adicionales.
- Si el valor trae barras invertidas o comillas escapadas, no las “arregles” a mano: el resolver DoH (`parseDohTxtData`) desescapa `\"` a `"`. Un valor con comillas escapadas de más puede quedar inválido.
- Comprobá con:
  ```text
  nslookup -type=TXT _apw.listashare.com 1.1.1.1
  nslookup -type=TXT _apw.listashare.com 8.8.8.8
  ```

## 4. Diagnóstico: la verificación falla con un firewall local

El endpoint `GET /admin/api/apw-verification-status` consulta DoH a `https://cloudflare-dns.com/dns-query` (host fijo, no configurable). No usa DNS del sistema.

- Causas posibles: `doh_request_failed` (no se pudo consultar), `doh_response_not_ok`, `no_txt_records`, `malformed_dns_response`, `invalid_domain`.
- El panel hoy muestra un mensaje genérico (“Registro TXT … no encontrado todavía”) para todos los casos no verificados; no distingue “no pude consultar” de “registro ausente/inválido”. Si `data.reason` es `doh_request_failed`, el problema es de red/firewall/resolvedor, no del TXT.
- Regla práctica: permitir `node.exe` en Portmaster para `cloudflare-dns.com:443`; probar contra `1.1.1.1` y `8.8.8.8` desde otro equipo o VPN.
- Caché observada en campo: ~5 minutos. Reintentá “Verificar ahora” después de ese tiempo.

## 5. HOST y exposición local

- Default: `HOST` no está definido → `0.0.0.0`, puerto `PORT || 3000` (3000). El nodo queda accesible desde la red local.
- Para un PC personal, usá `HOST=127.0.0.1` y exponé solo por el túnel.
- El perfil mínimo de Compose ya publica `127.0.0.1:3000:3000`.

## 6. Cloudflare Access y límite de tasa para `/admin`

- El límite de login por IP (`PORTALESS_LOGIN_ATTEMPTS_PER_IP`, default 60 por 15 min) y el rate limit de fallos (20 por IP por 15 min) se calculan con la IP del cliente.
- Detrás de cloudflared, configurá `PORTALESS_TRUSTED_PROXIES=127.0.0.1,::1` para que el runtime use `X-Forwarded-For`. Sin esa variable, todos los clientes comparten el bucket del túnel.
- El runtime descarta `Cf-Connecting-Ip` y `True-Client-Ip` del cliente; solo confía en `X-Forwarded-For` si el socket es un proxy listado. Si Cloudflare Tunnel no envía `X-Forwarded-For` en tu configuración, todos los clientes colapsan a la IP del túnel: esto es un riesgo abierto y no se verificó localmente (no hay `cloudflared` instalado en este entorno).
- Para `/admin`, considerá Cloudflare Access (Zero Trust) delante del túnel como capa adicional; no reemplaza TOTP ni el límite de login.

## 7. TOTP, copias de seguridad y secretos

- Activá 2FA (TOTP) para el admin antes de exponer el nodo.
- Respaldá `.env` y `data/` por separado; la clave de cifrado (`PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY`) debe guardarse fuera del volumen.
- `npm run backup` crea un backup SQLite verificado con checksums; los secretos quedan fuera salvo opt-in explícito.
- Nunca compartas `cert.pem`, credenciales del túnel, `.env` ni claves privadas.

## 8. Lo que no sustituye

- Un nodo en un PC encendido no es un nodo privado con proyección estática. Para mayor disponibilidad, migrá a un servidor o a Cloudflare Pages + D1 (ver `self-hosting-where-to-keep-the-node.md`).
