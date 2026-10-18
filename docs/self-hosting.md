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
docker compose up -d
docker compose logs portaless
```

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

El backup queda en `<dataDir>/backups/db-vN-<fecha>.sqlite`. En Docker, además,
el servidor migra solo al arrancar (después de aplicar `schema.sql`), así que
actualizar es:

```bash
docker compose pull       # con el tag de imagen fijado
docker compose up -d
```

**Rollback**: restaurá el backup sobre el volumen y volvé al tag de imagen
anterior. Si una migración falla, su transacción se revierte y el arranque
corta (el backup queda intacto).

Para Cloudflare D1: `wrangler d1 migrations apply <DB_NAME> --remote`.
Ver también la sección **Migration** del [`CHANGELOG`](../CHANGELOG.md).

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
| `PORTALESS_SQLITE_PATH` | `/data/portaless.db` | Archivo SQLite |
| `PORTALESS_TRUSTED_PROXIES` | vacía | IPs de proxies confiables delante del servidor (separadas por coma, coincidencia exacta). `X-Forwarded-For` solo se usa si la conexión viene de una de esas IPs; sin la lista, manda la IP del socket y los headers de IP del cliente (incluido `CF-Connecting-IP`) se descartan. Detrás de un proxy (Railway, Render, nginx) es necesario para que los rate limits por IP —login, MFA, password reset— identifiquen al cliente real y no al proxy |
| `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` | generada en `/data` | Clave AES-GCM de la identidad del sitio |
| `PORTALESS_SETUP_CODE` | generado | Código de configuración fijo |
| `IP_HASH_SALT` | **sin default** | Salt para hashear la IP del votante community. **Obligatorio**: sin él, `POST /trust/:siteId/vote` responde `500 server_misconfigured` y el voto queda deshabilitado. Un salt público o vacío vuelve reversible por fuerza bruta el hash de una IPv4 |
| `PORTALESS_RUN_UID` / `PORTALESS_RUN_GID` | `1000` | Usuario con el que corre el servidor |
