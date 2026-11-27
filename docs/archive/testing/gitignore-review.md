# Revisión de `.gitignore` (A15)

## Cobertura actual antes de PR-A

Cubierto:

- `.env`, `.env.*`, con excepciones `.env.example` y `.env.*.example`.
- `*.db`, `*.sqlite`, `*.sqlite3`, `*.db-shm`, `*.db-wal`.
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`.
- `credentials.json`, `service-account*.json`.
- `config.json`, `node_modules/`, `dist/`, logs.

No cubierto:

- `data/` (puede contener SQLite, backups, `SETUP_CODE.txt`, secretos).
- `cloudflared.exe` / `cloudflared`.
- `.cloudflared/`.
- `config.yml` de cloudflared.
- Credenciales de túnel con nombre arbitrario (`<uuid>.json`).

## Cambios aplicados

```gitignore
data/
cloudflared
cloudflared.exe
.cloudflared/
/config.yml
cloudflared-credentials*.json
*.tunnel.json
```

## Límite

Las credenciales de túnel de Cloudflare suelen llamarse `<tunnel-id>.json`; no se puede ignorar `*.json` sin ocultar `package.json` y otros JSON legítimos. Regla operativa: guardar esas credenciales fuera del repo (por ejemplo en `~/.cloudflared/`) y no copiarlas al proyecto.

## Verificación

`git status --short` no muestra secretos nuevos. El cambio no altera el runtime ni textos públicos.
