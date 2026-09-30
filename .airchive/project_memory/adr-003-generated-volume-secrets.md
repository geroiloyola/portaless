# ADR-003 — Secretos generados en el volumen de datos

- Estado: aceptado (PR B)

## Decisión

- Si `PORTALESS_SITE_IDENTITY_ENCRYPTION_KEY` existe en el entorno, se usa esa y nunca se copia al volumen (`siteIdentityKeySource: "environment"`).
- Si no existe, se generan 32 bytes aleatorios en Base64 estándar, compatible con el `atob()` + AES-GCM de `site-identity-store.ts`, y se guardan en `portaless-secrets.json` con permisos 0600 (`siteIdentityKeySource: "generated-volume"`).
- `/setup` y los logs muestran un aviso cuando la clave vive en el volumen.
- El archivo de estado tiene `version: 1` y se escribe de forma atómica (tmp + rename).

## Consecuencias

Con la clave generada en el volumen, quien obtenga una copia del volumen tiene la base de datos y la clave juntas. La protección de v0.0.9.30 (la DB sola no alcanza para descifrar) solo se mantiene si la clave se configura como secreto de la plataforma. Por eso existe el aviso.
