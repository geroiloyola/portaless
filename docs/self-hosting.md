# Portaless self-hosted

> ¿No sos técnico? La guía de 10 minutos con capturas (Docker + navegador) es [`first-steps.md`](./first-steps.md). Esta página es la versión corta para operadores.

Portaless corre como un único contenedor Node 24 con SQLite en un volumen persistente montado en `/data`.

## Primer arranque

1. Levantá el contenedor con un volumen en `/data`.
2. Buscá en los logs el bloque `CODIGO DE CONFIGURACION`. El código también queda en `/data/SETUP_CODE.txt`.
3. Abrí `/setup`, ingresá el código y creá el primer admin (contraseña de 12 caracteres como mínimo).
4. El código vence a los 60 minutos y admite 5 intentos. Si se agota, reiniciá el contenedor para generar uno nuevo.

Si preferís no leer logs, definí `PORTALESS_SETUP_CODE` como secreto de la plataforma.

## Clave de cifrado

Definí `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` como secreto de la plataforma:

```bash
openssl rand -base64 32
```

Si no la definís, Portaless la genera dentro de `/data` y `/setup` muestra un aviso. En ese caso, quien obtenga una copia del volumen tiene la base de datos y la clave juntas. Respaldá la clave aparte: sin ella no se puede descifrar la identidad del sitio.

## Docker Compose

```bash
# Sin default en el compose: declará el origen real antes de arrancar.
touch .env
grep -q '^PORTALESS_PUBLIC_URL=' .env || echo 'PORTALESS_PUBLIC_URL=http://localhost:3000' >> .env   # local; HTTPS en producción
docker compose up -d
docker compose logs portaless
```

## Perfiles de nodo privado

- **Mínimo (2 GiB RAM / 1 CPU / concurrencia 8):**
  `docker compose -f docker-compose.minimal.yml up -d`
- **Red privada, sin puertos públicos:** `docker compose -f docker-compose.private.yml up -d`
- **Acceso remoto opcional con Tailscale:** agrega `--profile tailscale` y sigue
  [`private-node.md`](./private-node.md); Tailscale no concede capacidades a plugins.

## Reserva de directorios Web Bot Auth

Con `ENABLE_TRUST_LAYER=true`, el proceso permite un solo fetch en vuelo por
origen canónico (single-flight), hasta 6 orígenes normales y 8 en total. Los
2 huecos reservados solo están disponibles para los orígenes que el dueño
configure en `PORTALESS_WBA_RESERVED_ORIGINS`. **Una firma válida previa no
concede reserva:** un atacante también puede firmar con claves de sus dominios.

```bash
PORTALESS_WBA_RESERVED_ORIGINS=https://lector.example,https://otro-lector.example:8443
```

Esta variable está incluida en [`.env.example`](../.env.example). Usa orígenes
HTTPS separados por comas: sin credenciales, ruta distinta de `/`, query,
fragmento ni comodines. Se normalizan mayúsculas, IDN/punycode, puerto HTTPS
por defecto y punto final; se deduplican. Se descartan individualmente las
entradas inválidas, localhost, `.local`, literales IP bloqueados y las entradas
posteriores a las primeras 256 no vacías. Si está vacía o todas son inválidas,
no se asigna ninguna reserva y los orígenes usan los 6 huecos normales. No se
deshabilita la validación de firma ni se permite más tráfico por ese motivo.
La resolución DNS y el pinning de Node siguen comprobando los destinos reales.

### Presupuesto experimental del directorio

`PORTALESS_RESOLUTION_BUDGET_ENABLED=true` activa únicamente la primera
integración del kernel, para el directorio Web Bot Auth; no cubre aún TXT/DoH,
DID, historial o evidencia y no satisface por sí sola el gate completo previo a
PR3. Requiere `PORTALESS_RESOLUTION_BUDGET_SECRET` con al menos 32 caracteres.
En Node, la IP debe proceder del header que inyecta `server/node-runtime.mjs`.
En Cloudflare se requiere además
`PORTALESS_TRUSTED_CLOUDFLARE_INGRESS=true`, solo con ingress confiable y origen
protegido. Si el presupuesto está activado con configuración ausente/inválida,
la verificación devuelve indisponibilidad `503` sin hacer fetch ni registrar
una violación de política.

Durante rotación, configura el secreto nuevo en `PORTALESS_RESOLUTION_BUDGET_SECRET`
y conserva el previo en `PORTALESS_RESOLUTION_BUDGET_PREVIOUS_SECRET`; ambos
HMAC se cargan contra la misma cuota mientras exista solapamiento. Este mecanismo
no provisiona ni sincroniza secretos entre instancias. Los límites actuales son
propuestas por proceso/isolate, no cuotas globales. La elección entre memoria,
D1 y Durable Objects sigue pendiente de decisión y medición; consulta
[`resolution-budget.md`](./architecture/resolution-budget.md).

En Cloudflare Pages/Workers, define la misma variable en el entorno del
despliegue. La configuración se aplica en cada isolate; cachés, single-flight
y huecos no son globales entre isolates. Un isolate nuevo no aprende reservas
de firmas anteriores: solo lee esta lista explícita. No hay garantía de cuota
global por zona ni de disponibilidad universal. Saturación devuelve `503` con
`Retry-After`, sin guardar un fallo negativo del origen.

Los rechazos B3 se agregan en memoria y se vuelcan cada 10 segundos; todas las
cifras del panel se rotulan **declarada**. Un reinicio, descarte de isolate o
fallo de volcado puede perder el lote; no son un recuento exhaustivo de bots.
Workers conserva el trabajo con `waitUntil`; en Node el timer no mantiene el
proceso vivo. Nada de esto modifica el rechazo por User-Agent actual.

## Backup del nodo canónico

`npm run backup` crea un backup SQLite verificado con checksums; los secretos
quedan fuera salvo opt-in explícito (`--include-secrets`, archivo `0600`
separado). Restaurar es una operación CLI que exige detener el escritor activo:

```bash
npm run backup -- verify <backup-dir>
npm run backup -- restore <backup-dir> --target=/data/portaless.db --overwrite
```

Ver [`private-node.md`](./private-node.md) y el presupuesto medido en
[`testing/resource-budget.md`](./testing/resource-budget.md).

## Railway

1. Creá un servicio desde el repositorio. `railway.json` indica usar el `Dockerfile` y el healthcheck `/healthz`.
2. Agregá un volumen montado en `/data`. Railway no permite declararlo en `railway.json`.
3. Cargá `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` en las variables del servicio.

No hace falta `RAILWAY_RUN_UID=0`: el entrypoint ajusta el dueño de `/data` y corre el servidor como UID 1000.

## Render

1. Creá un Blueprint desde el repositorio. `render.yaml` declara el servicio, el disco en `/data` y el healthcheck.
2. Completá `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` cuando Render lo pida.

Los discos persistentes requieren un plan pago. Con plan free, Render rechaza el Blueprint.

## Actualizar (sin perder datos)

El contrato de datos es explícito: la base registra su versión en
`schema_migrations`, el core **se niega a arrancar** si la base es más nueva que
el código, y **nunca degrada el schema en silencio**. Antes de actualizar:

```bash
# 1. Diagnóstico: ¿en qué versión está la base y qué espera el código?
npm run doctor            # o: docker compose exec portaless npm run doctor

# 2. Si la base está atrás, migrar (hace BACKUP primero):
npm run migrate           # --dry-run para ver qué haría, sin tocar nada
```

El backup queda en `<dataDir>/backups/db-vN-<fecha>.sqlite`. En Docker, el
primer arranque crea una DB con `schema.sql`; las DB existentes aplican solo
deltas numerados después del backup. Para actualizar:

```bash
docker compose pull       # con el tag de imagen fijado
docker compose up -d
```

**Rollback**: restaurá el backup sobre el volumen y volvé al tag de imagen
anterior. Si una migración falla, su transacción se revierte y el arranque
corta (el backup queda intacto).

Para Cloudflare D1: usa `npm run setup:d1 -- --db <DB> --remote` solo en una base vacía; las actualizaciones usan `npm run migrate:d1 -- --db <DB> --remote`, que exporta un backup y aplica deltas verificados (ver `docs/DEPLOY_CLOUDFLARE_PAGES.md`). `migrate:d1` adquiere un lock local por base/modo y escribe la fila del ledger como última sentencia de cada delta. El lock no es distribuido: no ejecutes la misma migración remota desde dos máquinas a la vez. Si falla antes del ledger, el gate fail-closed responde 503; restaurá el backup y reintentá.

El vector de DNS rebinding en egress (webhooks/SMTP) está documentado en [`decisions/0002-egress-dns-rebinding.md`](./decisions/0002-egress-dns-rebinding.md).

Ver también la sección **Migration** del [`CHANGELOG`](../CHANGELOG.md).

## Email transaccional

Los plugins con la capacidad `email:send` usan el proveedor que configura el
dueño en **`/admin/settings/email`**. La recuperación de contraseña usa un
remitente de autenticación separado, configurado mediante variables de entorno:

- **Webhook** (recomendado): Portaless hace `POST` JSON `{ from, to, subject, text }`
  a una URL tuya; detrás conectás Resend, Mailgun, SES o tu servicio. La URL debe
  ser pública (se rechazan hosts internos/metadata — SSRF).
- **SMTP**: host, puerto (587 STARTTLS / 465 TLS), usuario y contraseña. El
  cliente negocia STARTTLS cuando el relay lo anuncia; en el remitente de
  autenticación, cualquier puerto distinto de 465 exige STARTTLS aunque no haya
  credenciales, para no enviar enlaces de recuperación en claro.
- **`none`**: apaga el envío; `email:send` responde `501`.

`PORTALESS_PUBLIC_URL` es **obligatoria** para arrancar el runtime Node: es la
única fuente de verdad para el origen CSRF, los documentos `.well-known` y los
redirects OAuth. No se deriva del header `Host`. En Docker Compose el valor por
defecto es `http://localhost:3000`; detrás de un túnel o proxy TLS debe ser la
URL HTTPS pública real.

Para los correos de recuperación (y la abstracción auth EmailSender), configura
el webhook o estas variables en el entorno del servidor —no en el repositorio ni
en la base de datos—:

```bash
PORTALESS_PUBLIC_URL=https://tu-dominio.example
PORTALESS_EMAIL_SMTP_HOST=smtp.tu-proveedor.example
PORTALESS_EMAIL_SMTP_PORT=587       # default 587; 465 usa TLS implícito
PORTALESS_EMAIL_SMTP_USERNAME=...
PORTALESS_EMAIL_SMTP_PASSWORD=...
PORTALESS_EMAIL_FROM=cuentas@tu-dominio.example
```

Se pueden usar en su lugar `PORTALESS_EMAIL_WEBHOOK_URL` y opcionalmente
`PORTALESS_EMAIL_WEBHOOK_TOKEN`. `PORTALESS_PUBLIC_URL` debe ser HTTPS fuera de
desarrollo; el enlace de reset no se construye desde el header Host de la
request. Sin proveedor, remitente/destino o URL pública confiable, la solicitud
de reset mantiene la respuesta genérica pero no emite un token inutilizable.
SMTP directo funciona solo en el runtime self-hosted de Node; en Cloudflare Pages
usa el webhook para delegar al servicio de correo.
La entrega debe probarse con una cuenta destinataria controlada antes de
habilitar el flujo en una instalación.

Para enviar un mensaje de smoke test al destinatario controlado, configura las
variables localmente y ejecuta:

```bash
npm run test:email -- --to=kilo@tu-dominio.example
```

El comando solo informa que el proveedor aceptó el mensaje; confirma también
que llegó a la bandeja de entrada o spam. No pegues credenciales SMTP en el
repositorio ni en tickets.

El **`from`** lo inyecta el core desde el panel: el plugin nunca lo elige
(delegación ciega). Hay una **cuota diaria por plugin** (default 50/día,
`PORTALESS_PLUGIN_EMAIL_DAILY_LIMIT`); la cuota vive en la base
(`plugin_email_quota`) y, sin backend de base de datos, el envío se **rechaza**
(fail-closed) en vez de no contar.

La credencial es **write-only**: la API nunca la devuelve y el panel no la
pre-carga (dejar el campo vacío la conserva).

## Backup

Todo lo que el dueño escribe vive en dos lugares:

- **Base SQLite** (`/data/portaless.db`): páginas del editor, skin, política de
  acceso de agentes, claves de identidad cifradas, ledger. Respaldá el archivo
  (o dejá que `npm run migrate` lo copie a `/data/backups/` antes de cada
  migración).
- **Clave de cifrado** (`PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY`): **aparte del
  volumen**. Sin ella, el backup de la base no sirve para descifrar la
  identidad del sitio.

El contenido en archivos (`src/content/**`, `public/**`) es parte del repositorio:
se respalda con git.

## Variables

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP. Railway y Render lo inyectan solos |
| `PORTALESS_PUBLIC_URL` | **sin default** | **Obligatoria** para arrancar. Origen público real (HTTPS detrás de túnel/proxy). Es la única fuente de verdad para CSRF, `.well-known` y redirects OAuth; nunca se usa el header `Host`. Docker Compose falla explícitamente si no la declarás |
| `PORTALESS_SQLITE_PATH` | `/data/portaless.db` | Archivo SQLite |
| `PORTALESS_LOGIN_CONCURRENCY` | `4` | Máximo de verificaciones scrypt simultáneas. Cada scrypt `N=2^17` usa ~128 MiB; el resto de logins espera turno |
| `PORTALESS_TRUSTED_PROXIES` | vacía | IPs de proxies confiables delante del servidor (separadas por coma, coincidencia exacta). `X-Forwarded-For` y `X-Forwarded-Proto` solo se usan si la conexión viene de una de esas IPs; sin la lista, manda la IP/protocolo del socket y los headers del cliente (incluido `CF-Connecting-IP`) se descartan. Detrás de un proxy (Railway, Render, nginx) es necesario para que los rate limits y la cookie `Secure` identifiquen al cliente y al TLS reales, no al proxy |
| `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` | generada en `/data` | Clave AES-GCM de la identidad del sitio |
| `PORTALESS_OPENAI_API_KEY` / `_BASE_URL` / `_MODEL` / `_TIMEOUT_MS` | sin default | Perfil de proveedor OpenAI-compatible: clave server-side, endpoint HTTPS, modelo y timeout opcional. No es una conexión MCP ni implica compatibilidad universal. Ver [`openai-compatible-provider.md`](./openai-compatible-provider.md) |
| `PORTALESS_SETUP_CODE` | generado | Código de configuración fijo |
| `IP_HASH_SALT` | **sin default** | Salt para hashear la IP del votante community. **Obligatorio**: sin él, `POST /trust/:siteId/vote` responde `500 server_misconfigured` y el voto queda deshabilitado. Un salt público o vacío vuelve reversible por fuerza bruta el hash de una IPv4 |
| `PORTALESS_RUN_UID` / `PORTALESS_RUN_GID` | `1000` | Usuario con el que corre el servidor |
