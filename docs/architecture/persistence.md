# Persistencia Real Multi-Modulo - v0.0.6

| Modulo | Antes | Despues |
|---|---|---|
| Autenticacion | D1/SQLite (v0.0.5) | Sin cambios |
| Centro de Permisos | Memoria | D1/SQLite real |
| Ledger Trust Layer | Memoria | D1/SQLite real |

## Activar

Self-hosted: `PORTALESS_SQLITE_PATH=./portaless.sqlite`

Cloudflare D1:
```
wrangler d1 execute portaless-auth --file=packages/permissions/src/stores/schema.sql
wrangler d1 execute portaless-auth --file=packages/trust-layer/src/ledger/schema.sql
```

## Pendiente

- Sin migracion automatica de datos previos en memoria.
- Sin comando unico para aplicar los 3 schema.sql.
