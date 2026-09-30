# Portaless self-hosted

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

## Variables

| Variable | Default | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP. Railway y Render lo inyectan solos |
| `PORTALESS_SQLITE_PATH` | `/data/portaless.db` | Archivo SQLite |
| `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` | generada en `/data` | Clave AES-GCM de la identidad del sitio |
| `PORTALESS_SETUP_CODE` | generado | Código de configuración fijo |
| `PORTALESS_RUN_UID` / `PORTALESS_RUN_GID` | `1000` | Usuario con el que corre el servidor |
