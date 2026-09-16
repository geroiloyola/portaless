// Adaptador para Deno Deploy, alternativa a Cloudflare basada en el mismo
// principio de isolates V8 por tenant, pero con su propio runtime (Deno)
// y sus propios permisos nativos (--allow-net, --allow-read, etc.), que
// mapean de forma natural al modelo de capacidades de Portaless.
//
// v0.0.9.1: integracion real implementada siguiendo la API REST publica
// de Deno Deploy (https://docs.deno.com/deploy/api/rest/deployments/).
// IMPORTANTE -- no se pudo verificar end-to-end contra una cuenta real de
// Deno Deploy en el momento de escribir esto (sin credenciales de prueba
// disponibles). La logica de construccion de requests, mapeo de
// capacidades y parsing de respuestas esta cubierta por tests con
// `fetch` mockeado (ver tests/e2e/sandbox-deno-deploy-adapter.test.ts),
// pero el primer uso real contra la API de Deno Deploy debe tratarse
// como una integracion nueva sin confirmar -- revisar con cuidado
// cualquier diferencia de formato de respuesta real vs. lo documentado
// aqui antes de confiar en produccion.

import type {
  SandboxAdapter,
  SandboxExecutionInput,
  SandboxExecutionResult,
  CapabilityId,
  CapabilityHostBridge,
} from "../types";

export interface DenoDeployAdapterConfig {
  projectId: string;
  apiToken: string;
  /**
   * Base URL de la API REST de Deno Deploy. Parametrizable para poder
   * apuntar a un servidor de pruebas/mock en los tests -- en produccion
   * se deja el default oficial.
   */
  apiBaseUrl?: string;
  /**
   * Callback opcional invocado ANTES de hacer el fetch de invocacion del
   * plugin (paso 3) -- permite a los tests o al caller inyectar un
   * `fetch` distinto para la invocacion vs. para las llamadas de gestion
   * de la API de Deno Deploy. Si no se provee, se usa el `fetch` global
   * para todo.
   */
  fetchImpl?: typeof fetch;
  /**
   * Tiempo maximo de espera (ms) para cada llamada HTTP individual
   * (creacion de deployment e invocacion). Default: 15000.
   */
  timeoutMs?: number;
}

const DEFAULT_API_BASE_URL = "https://api.deno.com/v1";
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Las 9 capacidades no-red no tienen equivalente nativo en Deno Deploy
 * (no hay bindings de storage/email/commerce como en un runtime propio).
 * Se resuelven via un bridge HTTP: el codigo bootstrap que se sube como
 * deployment expone un helper `capabilities.xxx(args)` que hace un
 * fetch() al endpoint interno de Portaless declarado en
 * `portalessBridgeUrl`, autenticado con `portalessBridgeToken`
 * (token de corta duracion, generado por request, NUNCA reusado entre
 * ejecuciones). Ese endpoint interno es responsabilidad del caller de
 * este adaptador (no de este archivo) -- exactamente el mismo principio
 * que hostBridge en SandboxExecutionInput, pero expuesto sobre HTTP en
 * vez de invocado in-process porque el codigo corre fuera de este
 * proceso Node.
 */
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

/**
 * Genera el codigo bootstrap que se sube como entrypoint de la
 * deployment. Envuelve `pluginCode` (el codigo del plugin, se asume una
 * funcion `export default async function(payload, ctx) { ... }` o
 * equivalente -- ver nota de contrato abajo) en un handler HTTP nativo de
 * Deno Deploy (`Deno.serve`), inyectando `fetchAllowed` y `capabilities`
 * de la misma forma conceptual que wrappedCode en node-isolated-vm.ts,
 * pero sobre HTTP en vez de un jail de isolated-vm.
 *
 * Contrato asumido del plugin (documentado aqui porque no hay todavia un
 * consumidor real que lo excluya): `input.code` debe exportar por
 * default una funcion async que reciba `(payload, { fetchAllowed,
 * capabilities, console })` y retorne el resultado serializable a JSON.
 * Esto es analogo al `executableBody` de node-isolated-vm.ts pero
 * explicito via un modulo ES en vez de la heuristica de insercion de
 * `return` (Deno Deploy si soporta imports de modulos ES normales, asi
 * que no hace falta la misma heuristica).
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
  const capabilityNames = NON_NETWORK_CAPABILITIES.map((c) => c.jsName);

  return `
// --- Bootstrap generado por Portaless (DenoDeployAdapter) ---
// No editar a mano: se regenera en cada execute(). Ver
// packages/plugin-sandbox/src/adapters/deno-deploy.ts::buildBootstrapCode.

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

Deno.serve(async (req) => {
  try {
    const payload = req.method === "POST" ? await req.json() : null;
    if (typeof __portalessPluginEntry !== "function") {
      return new Response(JSON.stringify({ __portalessError: "El plugin no exporto __portalessPluginEntry (ver contrato en deno-deploy.ts)." }), { status: 500 });
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
});
`;
}

export class DenoDeployAdapter implements SandboxAdapter {
  readonly providerName = "deno-deploy";
  readonly supportsWasm = true;

  constructor(private config: DenoDeployAdapterConfig) {}

  async isAvailable(): Promise<boolean> {
    // Solo valida presencia de configuracion minima -- NO hace una
    // llamada real a la API de Deno Deploy para confirmar que el token
    // es valido. Un token invalido o expirado solo se descubre en
    // execute(), donde la respuesta HTTP se propaga como error explicito.
    return Boolean(this.config.projectId && this.config.apiToken);
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const apiBaseUrl = this.config.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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

    // Token de corta duracion para el bridge HTTP -- generado por
    // invocacion, nunca reusado. La verificacion real de este token la
    // hace el endpoint interno de Portaless (fuera de este adaptador);
    // aqui solo se genera y se inyecta en el bootstrap subido.
    const bridgeToken = `pless_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    const bootstrapCode = buildBootstrapCode({
      pluginCode: input.code,
      allowedHosts,
      bridgeUrl: input.bridgeUrl ?? process.env.PORTALESS_CAPABILITY_BRIDGE_URL,
      bridgeToken,
      grantedNonNetwork,
    });

    // Paso 1: crear una deployment nueva. Ver
    // https://docs.deno.com/deploy/api/rest/deployments/ -- el body
    // exacto puede variar segun version de API; este es el shape
    // documentado publicamente al momento de escribir esto.
    let deploymentResponse: Response;
    try {
      deploymentResponse = await withTimeout(
        fetchImpl(`${apiBaseUrl}/projects/${this.config.projectId}/deployments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.config.apiToken}`,
          },
          body: JSON.stringify({
            entryPointUrl: "main.ts",
            assets: {
              "main.ts": { kind: "file", content: bootstrapCode },
            },
            envVars: {},
          }),
        }),
        timeoutMs,
      );
    } catch (err) {
      return failure(this.providerName, deniedAttempts, start, `No se pudo crear la deployment en Deno Deploy: ${describeError(err)}`);
    }

    if (!deploymentResponse.ok) {
      const bodyText = await safeReadText(deploymentResponse);
      return failure(
        this.providerName,
        deniedAttempts,
        start,
        `Deno Deploy respondio ${deploymentResponse.status} al crear la deployment: ${bodyText}`,
      );
    }

    let deploymentJson: { id?: string; domains?: string[] };
    try {
      deploymentJson = await deploymentResponse.json();
    } catch (err) {
      return failure(this.providerName, deniedAttempts, start, `Respuesta de creacion de deployment no es JSON valido: ${describeError(err)}`);
    }

    // Paso 3: invocar la deployment recien creada. El dominio exacto
    // devuelto por la API puede venir en `domains` (lista) o requerir
    // construirse a partir del `id` -- se intenta `domains[0]` primero y
    // se cae al patron `{id}.deno.dev` documentado si no viene.
    const deploymentUrl =
      deploymentJson.domains?.[0] != null
        ? `https://${deploymentJson.domains[0]}`
        : deploymentJson.id != null
          ? `https://${deploymentJson.id}.deno.dev`
          : undefined;

    if (!deploymentUrl) {
      return failure(
        this.providerName,
        deniedAttempts,
        start,
        "La respuesta de Deno Deploy no incluyo ni 'domains' ni 'id' -- no se puede construir la URL de invocacion.",
      );
    }

    let invokeResponse: Response;
    try {
      invokeResponse = await withTimeout(
        fetchImpl(deploymentUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.payload ?? null),
        }),
        timeoutMs,
      );
    } catch (err) {
      return failure(this.providerName, deniedAttempts, start, `No se pudo invocar la deployment: ${describeError(err)}`);
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
        invokeJson.__portalessError ?? `Deno Deploy respondio ${invokeResponse.status} al invocar el plugin.`,
      );
    }

    // NOTA -- pendiente real, no cubierto en este PR: limpieza de
    // deployments viejas. Cada execute() de este adaptador crea una
    // deployment NUEVA (ver paso 5 del TODO original) -- en produccion
    // hay que decidir entre reusar la misma deployment para invocaciones
    // repetidas del mismo plugin/version, o llamar al endpoint de borrado
    // de deployments antiguas para no acumular basura en el proyecto.
    // Tampoco hay mapeo de `input.manifest.limits` (Deno Deploy no
    // permite configurar CPU/memoria por deployment via API publica).
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
