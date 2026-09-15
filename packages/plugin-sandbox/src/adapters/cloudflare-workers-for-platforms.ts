// Adaptador para Cloudflare Workers for Platforms (dispatch namespaces) /
// Dynamic Worker Loader. Cada plugin se ejecuta en su propio V8 isolate,
// con limites de CPU/memoria administrados por Cloudflare y acceso de red
// controlado via "globalOutbound" -- ver referencia oficial en
// developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/.
//
// Este NO es el unico adaptador soportado -- ver deno-deploy.ts,
// fastly-compute.ts y node-isolated-vm.ts para alternativas equivalentes
// en otros proveedores o en despliegues self-hosted.
//
// v0.0.9.1: integracion real implementada siguiendo la API REST publica
// de Cloudflare (developers.cloudflare.com/api/operations/worker-namespace-uploads-a-worker-module).
// IMPORTANTE -- no se pudo verificar end-to-end contra una cuenta real de
// Cloudflare en el momento de escribir esto (sin credenciales de prueba
// disponibles). La logica de construccion de requests, mapeo de
// capacidades y parsing de respuestas esta cubierta por tests con
// `fetch` mockeado (ver tests/e2e/sandbox-cloudflare-adapter.test.ts).
//
// REQUISITO DE INFRAESTRUCTURA (fuera del alcance de este archivo): a
// diferencia de Deno Deploy, Cloudflare NO expone un endpoint HTTP
// publico directo por-script dentro de un dispatch namespace -- la
// invocacion siempre pasa por un "Worker dispatcher" fijo, desplegado
// UNA VEZ por namespace (no por plugin), que usa
// `env.DISPATCH_NAMESPACE.get(scriptName)` para resolver y reenviar la
// request al script dinamico correspondiente. Ese dispatcher fijo:
//   1. Debe existir y estar desplegado ANTES de usar este adaptador
//      (no lo despliega este codigo).
//   2. Debe exponer una URL HTTP publica que este adaptador invoca
//      pasando `scriptName` (via header o path) para seleccionar el
//      script dinamico correcto.
//   3. Es tambien el punto natural donde correria el "outbound worker"
//      que aplica el allowlist de host para network:fetch (ver
//      developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/)
//      -- este adaptador NO configura el outbound worker, solo asume
//      que existe y confia en que el dispatcher aplique el allowlist
//      que se le pasa via `dispatcherUrl` + headers.
// Ver `dispatcherUrl` en CloudflareAdapterConfig.

import type {
  SandboxAdapter,
  SandboxExecutionInput,
  SandboxExecutionResult,
  CapabilityId,
  CapabilityHostBridge,
} from "../types";

export interface CloudflareAdapterConfig {
  accountId: string;
  dispatchNamespace: string;
  apiToken: string;
  /**
   * URL HTTP publica del Worker dispatcher fijo del namespace (ver nota
   * de infraestructura arriba). REQUERIDO para que execute() pueda
   * invocar el script subido -- sin esto, el adaptador puede subir
   * scripts (isAvailable/paso 1) pero no ejecutarlos.
   */
  dispatcherUrl?: string;
  /** Base URL de la API de Cloudflare. Parametrizable para tests. */
  apiBaseUrl?: string;
  /** `fetch` a usar -- parametrizable para tests con mocks. */
  fetchImpl?: typeof fetch;
  /** Timeout (ms) por llamada HTTP individual. Default: 15000. */
  timeoutMs?: number;
}

const DEFAULT_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const DEFAULT_TIMEOUT_MS = 15000;

const NON_NETWORK_CAPABILITIES: Array<{ id: CapabilityId; jsName: keyof CapabilityHostBridge }> = [
  { id: "media:read", jsName: "mediaRead" },
  { id: "media:write", jsName: "mediaWrite" },
  { id: "email:send", jsName: "emailSend" },
  { id: "commerce:read", jsName: "commerceRead" },
  { id: "commerce:checkout", jsName: "commerceCheckout" },
  { id: "storage:read", jsName: "storageRead" },
  { id: "storage:write", jsName: "storageWrite" },
  { id: "agent:identify", jsName: "agentIdentify" },
  { id: "site:admin", jsName: "siteAdmin" },
];

/** scriptName deterministico por plugin -- reusa/actualiza en vez de
 * acumular scripts huerfanos en el namespace (mismo nombre => mismo
 * script, PUT lo sobreescribe). */
function deterministicScriptName(manifest: SandboxExecutionInput["manifest"]): string {
  const raw = `${manifest.name}@${manifest.version}`;
  // Cloudflare exige nombres de script alfanumericos + guiones; se
  // sanitiza de forma simple y determinista (no criptografica, solo
  // para evitar caracteres invalidos).
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63);
}

/**
 * Bootstrap subido como `main_module` del script dinamico. Igual
 * principio que buildBootstrapCode en deno-deploy.ts: envuelve el codigo
 * del plugin en un `export default { fetch(request, env) {...} }`
 * (formato de modulo ES que exige Workers for Platforms), inyectando
 * `fetchAllowed` y `capabilities`. La diferencia clave con Deno Deploy:
 * aqui NO se confia en un allowlist de host propio dentro del bootstrap
 * -- el filtrado real de red debe ocurrir en el outbound worker del
 * namespace (ver nota de infraestructura al inicio del archivo); este
 * bootstrap solo aplica una verificacion best-effort adicional en caso
 * de que el outbound worker no este configurado, para no fallar
 * silenciosamente en modo mas permisivo de lo esperado.
 */
function buildBootstrapCode(params: {
  pluginCode: string;
  allowedHosts: string[];
  bridgeUrl: string | undefined;
  bridgeToken: string;
  grantedNonNetwork: CapabilityId[];
}): string {
  const { pluginCode, allowedHosts, bridgeUrl, bridgeToken, grantedNonNetwork } = params;
  const grantedSet = JSON.stringify(grantedNonNetwork);
  const allowedHostsJson = JSON.stringify(allowedHosts);
  const bridgeUrlJson = JSON.stringify(bridgeUrl ?? null);
  const bridgeTokenJson = JSON.stringify(bridgeToken);

  return `
// --- Bootstrap generado por Portaless (CloudflareWorkersForPlatformsAdapter) ---
// No editar a mano: se regenera en cada execute(). Ver
// packages/plugin-sandbox/src/adapters/cloudflare-workers-for-platforms.ts::buildBootstrapCode.
// El filtrado AUTORITATIVO de red debe venir del outbound worker del
// namespace -- este check es solo defensa en profundidad best-effort.

const __portalessAllowedHosts = new Set(${allowedHostsJson});
const __portalessGrantedNonNetwork = new Set(${grantedSet});
const __portalessBridgeUrl = ${bridgeUrlJson};
const __portalessBridgeToken = ${bridgeTokenJson};

async function __portalessFetchAllowed(url, opts) {
  const parsed = new URL(url);
  if (!__portalessAllowedHosts.has(parsed.host)) {
    throw new Error("Host no autorizado: " + parsed.host);
  }
  const res = await fetch(url, opts);
  return await res.text();
}

async function __portalessInvokeBridge(capabilityId, jsName, args) {
  if (!__portalessGrantedNonNetwork.has(capabilityId)) {
    throw new Error("Capacidad '" + capabilityId + "' no concedida.");
  }
  if (!__portalessBridgeUrl) {
    throw new Error("Capacidad '" + capabilityId + "' concedida pero no hay bridge HTTP configurado (portalessBridgeUrl ausente).");
  }
  const res = await fetch(__portalessBridgeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + __portalessBridgeToken,
    },
    body: JSON.stringify({ capability: jsName, args: args ?? null }),
  });
  if (!res.ok) {
    throw new Error("Bridge HTTP respondio " + res.status + " para la capacidad '" + capabilityId + "'.");
  }
  return await res.json();
}

const __portalessCapabilities = {
${NON_NETWORK_CAPABILITIES.map(
  (c) => `  ${c.jsName}: (args) => __portalessInvokeBridge(${JSON.stringify(c.id)}, ${JSON.stringify(c.jsName)}, args),`
).join("\n")}
};

${pluginCode}

export default {
  async fetch(request) {
    try {
      const payload = request.method === "POST" ? await request.json() : null;
      if (typeof __portalessPluginEntry !== "function") {
        return new Response(JSON.stringify({ __portalessError: "El plugin no exporto __portalessPluginEntry (ver contrato en cloudflare-workers-for-platforms.ts)." }), { status: 500 });
      }
      const output = await __portalessPluginEntry(payload, {
        fetchAllowed: __portalessFetchAllowed,
        capabilities: __portalessCapabilities,
        console,
      });
      return new Response(JSON.stringify({ __portalessOutput: output }), { status: 200 });
    } catch (err) {
      return new Response(JSON.stringify({ __portalessError: err instanceof Error ? err.message : String(err) }), { status: 500 });
    }
  },
};
`;
}

export class CloudflareWorkersForPlatformsAdapter implements SandboxAdapter {
  readonly providerName = "cloudflare-workers-for-platforms";
  readonly supportsWasm = true;

  constructor(private config: CloudflareAdapterConfig) {}

  async isAvailable(): Promise<boolean> {
    // Solo valida presencia de configuracion minima -- NO confirma
    // contra la API real que el token/namespace sean validos, ni que el
    // dispatcher este desplegado. Un problema real solo se descubre en
    // execute(), donde se propaga como error explicito.
    return Boolean(this.config.accountId && this.config.dispatchNamespace && this.config.apiToken);
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const apiBaseUrl = this.config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!this.config.dispatcherUrl) {
      return failure(
        this.providerName,
        deniedAttempts,
        start,
        "dispatcherUrl no configurado -- se puede subir el script pero no invocarlo (ver nota de infraestructura en cloudflare-workers-for-platforms.ts).",
      );
    }

    const grantedSet = new Set(input.granted);
    const networkCap = input.manifest.requestedCapabilities.find((c) => c.id === "network:fetch");
    const allowedHosts = grantedSet.has("network:fetch") ? networkCap?.allowedHosts ?? [] : [];

    const grantedNonNetwork = NON_NETWORK_CAPABILITIES.filter((c) => grantedSet.has(c.id)).map((c) => c.id);
    for (const cap of NON_NETWORK_CAPABILITIES) {
      const wasRequested = input.manifest.requestedCapabilities.some((r) => r.id === cap.id);
      if (wasRequested && !grantedSet.has(cap.id)) {
        deniedAttempts.push(cap.id);
      }
    }

    const bridgeToken = `pless_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const scriptName = deterministicScriptName(input.manifest);

    const bootstrapCode = buildBootstrapCode({
      pluginCode: input.code,
      allowedHosts,
      bridgeUrl: input.bridgeUrl ?? process.env.PORTALESS_CAPABILITY_BRIDGE_URL,
      bridgeToken,
      grantedNonNetwork,
    });

    // Paso 1: subir/actualizar el script en el dispatch namespace. Ver
    // https://developers.cloudflare.com/api/operations/worker-namespace-uploads-a-worker-module
    // El body es multipart/form-data: una parte `metadata` (JSON) y una
    // parte con el modulo principal, nombrada igual que
    // `metadata.main_module`.
    const uploadUrl = `${apiBaseUrl}/accounts/${this.config.accountId}/workers/dispatch/namespaces/${this.config.dispatchNamespace}/scripts/${scriptName}`;
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({
        main_module: "main.js",
        compatibility_date: new Date().toISOString().slice(0, 10),
      }),
    );
    form.append("main.js", new Blob([bootstrapCode], { type: "application/javascript+module" }), "main.js");

    let uploadResponse: Response;
    try {
      uploadResponse = await withTimeout(
        fetchImpl(uploadUrl, {
          method: "PUT",
          headers: { authorization: `Bearer ${this.config.apiToken}` },
          body: form,
        }),
        timeoutMs,
      );
    } catch (err) {
      return failure(this.providerName, deniedAttempts, start, `No se pudo subir el script a Cloudflare: ${describeError(err)}`);
    }

    if (!uploadResponse.ok) {
      const bodyText = await safeReadText(uploadResponse);
      return failure(
        this.providerName,
        deniedAttempts,
        start,
        `Cloudflare respondio ${uploadResponse.status} al subir el script: ${bodyText}`,
      );
    }

    let uploadJson: { success?: boolean; errors?: Array<{ message: string }> };
    try {
      uploadJson = await uploadResponse.json();
    } catch (err) {
      return failure(this.providerName, deniedAttempts, start, `Respuesta de subida de script no es JSON valido: ${describeError(err)}`);
    }

    if (uploadJson.success === false) {
      const messages = uploadJson.errors?.map((e) => e.message).join("; ") ?? "error desconocido";
      return failure(this.providerName, deniedAttempts, start, `Cloudflare rechazo el script: ${messages}`);
    }

    // Paso 3: invocar via el dispatcher fijo del namespace, pasando el
    // scriptName a resolver. Convencion de este adaptador (no impuesta
    // por Cloudflare): header `X-Portaless-Script-Name` -- el dispatcher
    // debe leer este header y hacer
    // `env.DISPATCH_NAMESPACE.get(scriptName)` internamente.
    let invokeResponse: Response;
    try {
      invokeResponse = await withTimeout(
        fetchImpl(this.config.dispatcherUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-portaless-script-name": scriptName,
          },
          body: JSON.stringify(input.payload ?? null),
        }),
        timeoutMs,
      );
    } catch (err) {
      return failure(this.providerName, deniedAttempts, start, `No se pudo invocar el script via el dispatcher: ${describeError(err)}`);
    }

    let invokeJson: { __portalessOutput?: unknown; __portalessError?: string };
    try {
      invokeJson = await invokeResponse.json();
    } catch (err) {
      return failure(this.providerName, deniedAttempts, start, `Respuesta de invocacion no es JSON valido: ${describeError(err)}`);
    }

    if (!invokeResponse.ok || invokeJson.__portalessError) {
      return failure(
        this.providerName,
        deniedAttempts,
        start,
        invokeJson.__portalessError ?? `El dispatcher respondio ${invokeResponse.status} al invocar el script.`,
      );
    }

    // NOTA -- pendientes reales no cubiertos en este PR:
    // - Limites (CPU wall-time/memoria): se configuran via
    //   `usage_model`/`limits.cpu_ms` en el mismo PUT de subida (paso 1);
    //   no se mapea aqui `input.manifest.limits` todavia.
    // - El outbound worker que aplicaria el allowlist de forma
    //   AUTORITATIVA a nivel de namespace no lo despliega este
    //   adaptador -- ver nota de infraestructura al inicio del archivo.
    return {
      success: true,
      output: invokeJson.__portalessOutput,
      deniedCapabilityAttempts: deniedAttempts,
      durationMs: Date.now() - start,
      provider: this.providerName,
    };
  }
}

function failure(
  provider: string,
  deniedAttempts: CapabilityId[],
  start: number,
  error: string,
): SandboxExecutionResult {
  return {
    success: false,
    error,
    deniedCapabilityAttempts: deniedAttempts,
    durationMs: Date.now() - start,
    provider,
  };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no se pudo leer el cuerpo de la respuesta>";
  }
}

async function withTimeout(promise: Promise<Response>, timeoutMs: number): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Response>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${timeoutMs}ms)`)), timeoutMs);
      promise.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
