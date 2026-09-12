# Sandboxing Real de Plugins (v0.0.5)

Este módulo (`@portaless/plugin-sandbox`) ejecuta plugins de terceros con
únicamente las capacidades que un administrador concedió explícitamente
en el Centro de Permisos (`@portaless/permissions`) — sin importar cuántas
solicite el propio plugin en su manifiesto.

## Multi-proveedor por diseño (no solo Cloudflare)

Ningún componente central de Portaless conoce los detalles de un proveedor
específico. `SandboxRuntime` solo habla contra la interfaz `SandboxAdapter`
(`src/types.ts`), y hay cuatro implementaciones de referencia:

| Adaptador | Proveedor | Tipo de aislamiento | Estado en este MVP |
|---|---|---|---|
| `CloudflareWorkersForPlatformsAdapter` | Cloudflare Workers for Platforms | V8 isolate por tenant, dispatch namespace | Integración real pendiente (TODO) |
| `DenoDeployAdapter` | Deno Deploy | V8 isolate + permisos nativos de Deno | Integración real pendiente (TODO) |
| `FastlyComputeAdapter` | Fastly Compute@Edge | Sandbox WebAssembly | Integración real pendiente (TODO), solo plugins `runtime: "wasm"` |
| `NodeIsolatedVmAdapter` | Ninguno — self-hosted (VPS, Docker, cualquier Node) | V8 isolate vía `isolated-vm` | Integración real pendiente (TODO), **con advertencia de seguridad crítica**, ver abajo |

`AdapterRegistry` resuelve el primer adaptador disponible en el orden que
el sitio configure — un sitio puede correr 100% self-hosted sin depender
de ningún proveedor edge, usando únicamente `NodeIsolatedVmAdapter`.

## Riesgo conocido: isolated-vm

En agosto de 2026 se publicó **GHSA-864f-rcv7-6rh4**, una vulnerabilidad
crítica de type confusion en `isolated-vm` que permite que código
sandboxeado escape del isolate V8 y ejecute código arbitrario en el
proceso host (RCE). Afecta a todas las versiones ≤ 7.0.0; está corregida
en 6.2.0 y 7.0.1. `NodeIsolatedVmAdapter` **rechaza instanciarse** si
detecta una versión vulnerable (`assertSafeVersion()` en el constructor),
pero esto no reemplaza mantener la dependencia actualizada y monitoreada.

**Recomendación explícita para despliegues self-hosted**: correr el
proceso que hospeda `isolated-vm` dentro de un contenedor con una segunda
capa de aislamiento (seccomp, AppArmor, gVisor) — nunca confiar
únicamente en el aislamiento de V8 para ejecutar código no confiable de
terceros.

## Estado de integración real: todavía no ejecuta código de verdad

Los cuatro adaptadores en este MVP son **esqueletos con el contrato
completo y el punto de integración marcado explícitamente como `TODO`**.
Ninguno ejecuta código de plugin real todavía contra la API de su
proveedor. Esto es intencional: se prioriza tener la interfaz correcta y
segura por diseño (multi-proveedor, capacidades atómicas, fallback
self-hosted) antes de conectar la ejecución real, para no dar una falsa
sensación de sandboxing activo.

## Regla de oro del sistema

Un plugin declara en su manifiesto qué capacidades **solicita**, con una
razón legible para cada una. Un administrador decide, desde el Centro de
Permisos, qué capacidades **concede** — permiso por permiso, plugin por
plugin, exactamente como iOS/Android. `SandboxRuntime` siempre usa lo
concedido, nunca lo solicitado, como límite real de ejecución.
