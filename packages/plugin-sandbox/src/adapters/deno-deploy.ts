// Adaptador para Deno Deploy, alternativa a Cloudflare basada en el mismo
// principio de isolates V8 por tenant, pero con su propio runtime (Deno)
// y sus propios permisos nativos (--allow-net, --allow-read, etc.), que
// mapean de forma natural al modelo de capacidades de Portaless.

import type { SandboxAdapter, SandboxExecutionInput, SandboxExecutionResult, CapabilityId } from "../types";

export interface DenoDeployAdapterConfig {
  projectId: string;
  apiToken: string;
}

export class DenoDeployAdapter implements SandboxAdapter {
  readonly providerName = "deno-deploy";
  readonly supportsWasm = true;

  constructor(private config: DenoDeployAdapterConfig) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.config.projectId && this.config.apiToken);
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];

    // TODO(integracion real -- v0.0.9 deja esto documentado, NO
    // implementado; ver decision explicita del roadmap, item 2). Pasos
    // concretos para cuando se aborde:
    //
    // 1. Crear una deployment ("revision") nueva via la API REST de Deno
    //    Deploy: POST https://api.deno.com/v1/projects/{projectId}/deployments
    //    Header: `Authorization: Bearer ${this.config.apiToken}`.
    //    Body: `{ entryPointUrl, assets: { "main.ts": { kind: "file", content: input.code } }, envVars, permissions }`.
    //    Doc: https://docs.deno.com/deploy/api/rest/deployments/
    //    A diferencia de Cloudflare, Deno Deploy expone permisos nativos
    //    POR DEPLOYMENT en el campo `permissions` del body (`net`, `read`,
    //    `write`, `env`, `run`), asi que el mapeo de capacidades es mas
    //    directo que en Cloudflare.
    //
    // 2. Mapear `input.manifest.requestedCapabilities` de tipo
    //    "network:fetch" al campo `permissions.net`: una lista explicita
    //    de hosts permitidos (`["api.ejemplo.com", "cdn.ejemplo.com"]`),
    //    igual de granular que el allowlist ya implementado en
    //    node-isolated-vm.ts -- este es el adaptador donde el mapeo de
    //    red es mas fiel al modelo de capacidades de Portaless de los 3.
    //    Las 9 capacidades no-red (storage, email, commerce, media,
    //    agent:identify, site:admin) NO tienen equivalente nativo en Deno
    //    Deploy y seguirian necesitando un bridge HTTP propio: exponer un
    //    endpoint interno (p.ej. en el propio backend de Portaless) que
    //    el codigo desplegado invoque via `fetch()`, autenticado con un
    //    token de corta duracion inyectado como env var de la deployment
    //    (`envVars` en el body de (1)) -- analogo a lo que hace
    //    `hostBridge` + `ivm.Reference` en node-isolated-vm.ts pero sobre
    //    HTTP en vez de llamada in-process.
    //
    // 3. Invocar la deployment: cada deployment de Deno Deploy recibe una
    //    URL propia (`https://{deployment_id}.deno.dev` o el dominio
    //    custom del proyecto) -- ejecutar el plugin es un fetch HTTP
    //    normal a esa URL con el payload de entrada serializado. La
    //    respuesta HTTP (status + body) se traduce a
    //    `SandboxExecutionResult` (200 => success:true con `output` =
    //    body parseado; no-2xx => success:false con `error` del body).
    //
    // 4. Limites: `input.manifest.limits` (si existe) no tiene mapeo
    //    directo -- Deno Deploy no permite configurar CPU/memoria por
    //    deployment via API publica (son fijos por plan). Documentar esa
    //    limitacion al usuario final en vez de fallar silenciosamente si
    //    el manifest pide limites mas estrictos de lo que el plan
    //    contratado permite.
    //
    // 5. Limpieza: a diferencia de Cloudflare (que reusa `scriptName`),
    //    Deno Deploy acumula una deployment nueva por cada `execute()` si
    //    se sigue este patron 1:1 -- para produccion habria que decidir
    //    entre (a) reusar la misma deployment para invocaciones repetidas
    //    del mismo plugin/version via multiples requests a la misma URL,
    //    o (b) llamar al endpoint de borrado de deployments antiguas para
    //    no acumular basura en el proyecto.
    //
    // Sin (1)-(5) implementado, este adaptador NO debe reportarse como
    // disponible en produccion aunque `isAvailable()` devuelva true.
    return {
      success: false,
      error: "Integración con Deno Deploy pendiente (TODO en el código).",
      deniedCapabilityAttempts: deniedAttempts,
      durationMs: Date.now() - start,
      provider: this.providerName,
    };
  }
}
