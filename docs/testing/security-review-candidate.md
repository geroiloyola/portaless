# Guía de revisión de seguridad — candidato de versión

Complementa `docs/security-review-guide.md` (más detallado). Esta guía es el punto de entrada para un revisor humano sobre el candidato actual (post-#113).

## Superficies

1. Trust Layer: `functions/_middleware.js`, `packages/trust-layer/src/webbotauth/verify.ts`, `directory-fetch.ts`, `packages/apw-resolver/src/federation/safe-fetch.ts`, `server/node-runtime.mjs`.
2. Verificador Web Bot Auth: nonce, firma, key directory, replay, expiración.
3. MCP HTTP: `packages/mcp-server`, identidad por invocación, host allowlisting, Origin/rate limits.
4. Correo: `packages/auth/src/email-sender.ts`, password reset, tokens hasheados.
5. Publicación: `scripts/publish-site.mjs`, `public-build-stage.mjs`, snapshot, rollback.
6. Backup/restauración: `scripts/backup-node.mjs`, checksums, secretos opt-in.
7. AI provider: `packages/ai-provider`, clave server-side, SSE, timeouts.
8. Presupuesto de resolución: kernel inactivo por defecto; adaptador de directorio opt-in.
9. `ltp-engine`: superficie inactiva en el runtime; revisar solo como código, no como comportamiento activo.

## Archivos clave

- `functions/_middleware.js`
- `functions/admin/api/*.js`
- `server/node-runtime.mjs`
- `packages/auth/src/*.ts`
- `packages/trust-layer/src/**/*.ts`
- `packages/plugin-sandbox/src/**/*.ts`
- `packages/mcp-server/src/**/*.ts`
- `scripts/publish-site.mjs`
- `scripts/backup-node.mjs`

## Ideas de ataque

- Falsificar IP detrás del túnel (sin `PORTALESS_TRUSTED_PROXIES`).
- Replay de nonce Web Bot Auth.
- Cambiar `Signature-Agent` después de firmar.
- Guardar política inválida y verificar que no se aplique.
- Ejecutar plugin sin grants (debe ser 501, no éxito).
- Reinstalar plugin con mismos bytes/manifest distinto (debe ser 409).
- Publicar contenido privado (debe abortar).
- Restaurar backup manipulado (checksum debe fallar).
- Activar presupuesto sin secreto (debe ser 503).

## Comandos

```bash
node node_modules/vitest/vitest.mjs run
npm run build
node node_modules/tsx/dist/cli.mjs scripts/validate-manifests.ts
npx playwright test
```

## Cobertura de tests

- Autenticación y rate limit: `tests/unit/admin-login-endpoints.test.ts`, `auth-persistent-mfa-ratelimit.test.ts`.
- Headers y protocolo: `tests/unit/security-headers.test.ts`, `request-protocol.test.ts`.
- Web Bot Auth: `tests/unit/webbotauth-verify*.test.ts`, `trust-layer-middleware.test.ts`.
- Publicación: `tests/unit/admin-publication-endpoint.test.ts`, `public-build-stage` (si existe).
- Schema: `tests/unit/schema-runtime-tables.test.ts`.
- Runtime: `tests/unit/node-runtime-nonblocking.test.ts`.

## Lo que no está cubierto

- Cuenta real de Cloudflare Workers/Deno.
- Revisión independiente del criptográfico ML-DSA.
- Prueba de campo con Trust Layer apagado y bloqueo de Cloudflare apagado.
- Migración real de SQLite a D1.
