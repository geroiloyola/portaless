# Portaless dispatcher Worker (Cloudflare Workers for Platforms)

Pieza de infraestructura **una vez por dispatch namespace** (no por plugin)
que el adaptador `CloudflareWorkersForPlatformsAdapter` asume pero no
despliega: Cloudflare no expone un endpoint HTTP público por Dynamic
Worker — toda invocación pasa por un Worker fijo que resuelve el script
con `env.DISPATCH_NAMESPACE.get(scriptName)`.

## Qué hace

1. Valida el secreto compartido (`x-portaless-dispatch-token` contra la
   env var `DISPATCH_TOKEN`) — **fail-closed**: sin token válido, 401.
2. Valida el nombre de script (`x-portaless-script-name`, patrón del
   adaptador: minúsculas/dígitos/guiones, máx. 63).
3. Resuelve el script en el namespace y reenvía la misma request.
4. Devuelve la respuesta JSON del bootstrap (`__portalessOutput` /
   `__portalessError`).

## Requisitos previos

- Cuenta Cloudflare con un **dispatch namespace** creado (ej.
  `portaless-plugins`) — el mismo nombre que
  `PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE` en la config del adaptador.
- `wrangler` (npx sirve).

## Despliegue

```bash
cd infra/cloudflare/dispatcher

# 1. Crear el namespace si no existe (una vez):
npx wrangler dispatch namespace create portaless-plugins

# 2. Secret del dispatcher (una vez): mismo valor que pasará el
#    adaptador como PORTALESS_CLOUDFLARE_DISPATCHER_TOKEN.
openssl rand -hex 32   # copia el output
npx wrangler secret put DISPATCH_TOKEN

# 3. Desplegar:
npx wrangler deploy
```

La salida del deploy imprime la URL pública del Worker — esa URL es
`PORTALESS_CLOUDFLARE_DISPATCHER_URL` para el adaptador.

## Uso con el adaptador

```ts
new CloudflareWorkersForPlatformsAdapter({
  accountId, dispatchNamespace: "portaless-plugins", apiToken,
  dispatcherUrl: "https://portaless-dispatcher.<account>.workers.dev",
  dispatcherToken: "<mismo valor que DISPATCH_TOKEN>",
});
```

O con el script de verificación real (Phase 3):

```bash
PORTALESS_CLOUDFLARE_ACCOUNT_ID=... \
PORTALESS_CLOUDFLARE_API_TOKEN=... \
PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE=portaless-plugins \
PORTALESS_CLOUDFLARE_DISPATCHER_URL=https://... \
PORTALESS_CLOUDFLARE_DISPATCHER_TOKEN=... \
node scripts/verify-sandbox-adapters.mjs
```

## Límites honestos

- El **outbound worker** (allowlist autoritativa de red por namespace)
  no se configura aquí — es infraestructura adicional de Cloudflare
  (Outbound Workers) que el adaptador asume pero no instala; el
  bootstrap aplica un chequeo best-effort propio.
- `usage_model` / límites de CPU por script se configuran en el PUT de
  subida del adaptador, no en este Worker.
- El token compartido protege la URL del dispatcher; la protección
  auténtica de los scripts dinámicos es el namespace aislado de
  Cloudflare — este Worker no reemplaza ese aislamiento, solo evita que
  terceros invocen scripts desde Internet.
