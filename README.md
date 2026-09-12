

## Sandboxing real de plugins + Centro de Permisos (nuevo en v0.0.5)

**Sandboxing multi-proveedor** (`packages/plugin-sandbox/`): el aislamiento
de plugins ya no depende únicamente de Cloudflare. Hay adaptadores de
referencia para Cloudflare Workers for Platforms, Deno Deploy, Fastly
Compute@Edge, y un adaptador **self-hosted** (`isolated-vm`) para quienes
no quieren depender de ningún proveedor edge. Un plugin nunca ejecuta con
más capacidades que las explícitamente concedidas — sin importar cuántas
solicite en su manifiesto.

**Centro de Permisos** (`packages/permissions/`): control atómico, permiso
por permiso, de qué puede hacer cada plugin, tema o agente de IA — igual
que la pantalla de Privacidad de iOS/Android, nunca "todo o nada" por
plugin. Pruébalo abriendo `public/permissions/index.html` directamente en
el navegador.

⚠️ **Advertencia de seguridad real documentada**: el adaptador self-hosted
usa `isolated-vm`, que sufrió una vulnerabilidad crítica de RCE
(GHSA-864f-rcv7-6rh4) en versiones ≤7.0.0. El adaptador rechaza
instanciarse si detecta una versión vulnerable. Ver
`packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md`.

**Importante**: los cuatro adaptadores de sandboxing en esta versión son
esqueletos con el contrato completo, pero **la ejecución real contra la
API de cada proveedor queda marcada como `TODO` explícito** — no
implementan sandboxing activo todavía, solo la arquitectura correcta y
segura por diseño.
