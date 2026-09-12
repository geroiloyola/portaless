# Sandboxing Real de Plugins (v0.0.6)

## Multi-proveedor

| Adaptador | Proveedor | Estado |
|---|---|---|
| CloudflareWorkersForPlatformsAdapter | Cloudflare | Esqueleto, TODO |
| DenoDeployAdapter | Deno Deploy | Esqueleto, TODO |
| FastlyComputeAdapter | Fastly | Esqueleto, TODO |
| NodeIsolatedVmAdapter | Self-hosted | Ejecucion real implementada |

## Como funciona

1. Isolate V8 con limite de memoria (128MB default).
2. Contexto aislado sin require/process/filesystem/red por defecto.
3. Solo se inyectan puentes de capacidades concedidas.
4. Timeout de 2s por defecto. isolate.dispose() siempre al final.

## Probarlo

```
npm install isolated-vm --workspace=@portaless/plugin-sandbox
node --experimental-strip-types packages/plugin-sandbox/examples/hello-plugin/run-example.ts
```

## Riesgo conocido

GHSA-864f-rcv7-6rh4 (RCE) afecta <=7.0.0. El adaptador rechaza versiones vulnerables.

## Pendiente

- Cloudflare, Deno Deploy, Fastly sin integracion real.
- Solo 3 de 12 capacidades tienen puente (network:fetch, content:read, content:write).
