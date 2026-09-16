import type { SandboxAdapter, SandboxExecutionInput, SandboxExecutionResult, CapabilityId, CapabilityHostBridge } from "../types";

// v0.0.9.6 (PR #18): CapabilityHostBridge en ../types ya declara
// formalmente contentRead/contentWrite (mismo shape que mediaRead/
// mediaWrite) -- se elimina el tipo local extendido que este archivo
// usaba como workaround temporal desde v0.0.9.4, mientras esa interfaz
// no podia leerse completa por un bug del conector de GitHub. Ya no
// hace falta: se importa CapabilityHostBridge directo desde ../types.

interface CapabilityBridgeSpec {
  capability: CapabilityId;
  globalName: string;
  invokeHost: (bridge: CapabilityHostBridge, pluginName: string, argsJson: string) => Promise<unknown>;
}

const NOT_CONFIGURED = (cap: CapabilityId) =>
  new Error(`Capacidad '${cap}' concedida, pero tiene un handler no configurado (hostBridge) todavia para ella.`);

function insertReturnOnLastStatement(code: string): string {
  const lines = code.split("\n");
  let idx = lines.length - 1;
  const isSkippable = (trimmed: string) => trimmed === "" || /^\}+[;)]*$/.test(trimmed);
  while (idx >= 0 && isSkippable(lines[idx].trim())) idx--;
  if (idx < 0) return code;

  const line = lines[idx];
  const trimmedLine = line.trimStart();
  const blockedPrefixes = [
    "return", "if", "for", "while", "const", "let", "var", "function",
    "class", "throw", "}", "//", "import", "export", "switch", "try",
    "catch", "do ",
  ];
  const isBlocked = blockedPrefixes.some((p) => trimmedLine.startsWith(p));
  if (isBlocked || trimmedLine === "") return code;

  const indent = line.slice(0, line.length - trimmedLine.length);
  const withoutTrailingSemicolon = trimmedLine.replace(/;\s*$/, "");
  const rewrittenLines = lines.slice();
  rewrittenLines[idx] = `${indent}return (${withoutTrailingSemicolon});`;
  return rewrittenLines.join("\n");
}

async function resolveExecutableBody(
  isolate: import("isolated-vm").Isolate,
  originalCode: string
): Promise<string> {
  const withReturn = insertReturnOnLastStatement(originalCode);
  if (withReturn === originalCode) return originalCode;
  try {
    const probeSrc = `(async function(payload, console, fetchAllowed, capabilities) {\n${withReturn}\n});`;
    await isolate.compileScript(probeSrc);
    return withReturn;
  } catch {
    return originalCode;
  }
}

const CAPABILITY_BRIDGES: CapabilityBridgeSpec[] = [
  {
    capability: "content:read",
    globalName: "__portalessReadContent",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.contentRead) throw NOT_CONFIGURED("content:read");
      return JSON.stringify(await bridge.contentRead(JSON.parse(argsJson)));
    },
  },
  {
    capability: "content:write",
    globalName: "__portalessWriteContent",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.contentWrite) throw NOT_CONFIGURED("content:write");
      return JSON.stringify(await bridge.contentWrite(JSON.parse(argsJson)));
    },
  },
  {
    capability: "media:read",
    globalName: "__portalessMediaRead",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.mediaRead) throw NOT_CONFIGURED("media:read");
      return JSON.stringify(await bridge.mediaRead(JSON.parse(argsJson)));
    },
  },
  {
    capability: "media:write",
    globalName: "__portalessMediaWrite",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.mediaWrite) throw NOT_CONFIGURED("media:write");
      return JSON.stringify(await bridge.mediaWrite(JSON.parse(argsJson)));
    },
  },
  {
    capability: "email:send",
    globalName: "__portalessEmailSend",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.emailSend) throw NOT_CONFIGURED("email:send");
      return JSON.stringify(await bridge.emailSend(JSON.parse(argsJson)));
    },
  },
  {
    capability: "commerce:read",
    globalName: "__portalessCommerceRead",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.commerceRead) throw NOT_CONFIGURED("commerce:read");
      return JSON.stringify(await bridge.commerceRead(JSON.parse(argsJson)));
    },
  },
  {
    capability: "commerce:checkout",
    globalName: "__portalessCommerceCheckout",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.commerceCheckout) throw NOT_CONFIGURED("commerce:checkout");
      return JSON.stringify(await bridge.commerceCheckout(JSON.parse(argsJson)));
    },
  },
  {
    capability: "storage:read",
    globalName: "__portalessStorageRead",
    invokeHost: async (bridge, plugin, argsJson) => {
      if (!bridge.storageRead) throw NOT_CONFIGURED("storage:read");
      return JSON.stringify(await bridge.storageRead(plugin, JSON.parse(argsJson)));
    },
  },
  {
    capability: "storage:write",
    globalName: "__portalessStorageWrite",
    invokeHost: async (bridge, plugin, argsJson) => {
      if (!bridge.storageWrite) throw NOT_CONFIGURED("storage:write");
      return JSON.stringify(await bridge.storageWrite(plugin, JSON.parse(argsJson)));
    },
  },
  {
    capability: "agent:identify",
    globalName: "__portalessAgentIdentify",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.agentIdentify) throw NOT_CONFIGURED("agent:identify");
      return JSON.stringify(await bridge.agentIdentify(JSON.parse(argsJson)));
    },
  },
  {
    capability: "site:admin",
    globalName: "__portalessSiteAdmin",
    invokeHost: async (bridge, _plugin, argsJson) => {
      if (!bridge.siteAdmin) throw NOT_CONFIGURED("site:admin");
      return JSON.stringify(await bridge.siteAdmin(JSON.parse(argsJson)));
    },
  },
];

const MIN_SAFE_VERSIONS = { "6.x": "6.2.0", "7.x": "7.0.1" };
const DEFAULT_MEMORY_LIMIT_MB = 128;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_POOL_MAX_ISOLATES = 4;

export interface NodeIsolatedVmAdapterConfig {
  memoryLimitMb?: number;
  timeoutMs?: number;
  installedVersion: string;
  networkAllowlistOverride?: string[];
  poolMaxIsolates?: number;
}

class IsolateVmPool {
  private idle: import("isolated-vm").Isolate[] = [];
  private liveCount = 0;

  constructor(
    private readonly ivmModule: typeof import("isolated-vm"),
    private readonly memoryLimitMb: number,
    private readonly maxIsolates: number
  ) {}

  get stats() {
    return { idle: this.idle.length, live: this.liveCount, max: this.maxIsolates };
  }

  async acquire(): Promise<import("isolated-vm").Isolate> {
    while (this.idle.length > 0) {
      const candidate = this.idle.pop()!;
      if (!candidate.isDisposed) return candidate;
      this.liveCount--;
    }
    if (this.liveCount < this.maxIsolates) {
      this.liveCount++;
      return new this.ivmModule.Isolate({ memoryLimit: this.memoryLimitMb });
    }
    return new this.ivmModule.Isolate({ memoryLimit: this.memoryLimitMb });
  }

  release(isolate: import("isolated-vm").Isolate): void {
    if (isolate.isDisposed) {
      this.liveCount = Math.max(0, this.liveCount - 1);
      return;
    }
    if (this.idle.length < this.maxIsolates) {
      this.idle.push(isolate);
    } else {
      this.liveCount = Math.max(0, this.liveCount - 1);
      isolate.dispose();
    }
  }

  disposeAll(): void {
    for (const isolate of this.idle) {
      if (!isolate.isDisposed) isolate.dispose();
    }
    this.idle = [];
    this.liveCount = 0;
  }
}

export class NodeIsolatedVmAdapter implements SandboxAdapter {
  readonly providerName = "node-isolated-vm";
  readonly supportsWasm = false;

  private pool: IsolateVmPool | null = null;

  constructor(private config: NodeIsolatedVmAdapterConfig) { this.assertSafeVersion(config.installedVersion); }

  private async getOrCreatePool(ivm: typeof import("isolated-vm")): Promise<IsolateVmPool | null> {
    const maxIsolates = this.config.poolMaxIsolates;
    if (!maxIsolates || maxIsolates <= 0) return null;
    if (!this.pool) {
      this.pool = new IsolateVmPool(ivm, this.config.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB, maxIsolates);
    }
    return this.pool;
  }

  get poolStats(): { idle: number; live: number; max: number } | null {
    return this.pool?.stats ?? null;
  }

  disposePool(): void {
    this.pool?.disposeAll();
    this.pool = null;
  }

  private assertSafeVersion(version: string): void {
    const [major] = version.split(".").map(Number);
    const minSafe = major === 6 ? MIN_SAFE_VERSIONS["6.x"] : major === 7 ? MIN_SAFE_VERSIONS["7.x"] : null;
    if (!minSafe || this.isOlderThan(version, minSafe)) {
      throw new Error(`isolated-vm@${version} es vulnerable a GHSA-864f-rcv7-6rh4 (RCE). Actualiza a ${minSafe ?? "6.2.0 o 7.0.1"}.`);
    }
  }

  private isOlderThan(a: string, b: string): boolean {
    const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0); }
    return false;
  }

  async isAvailable(): Promise<boolean> {
    try { await import("isolated-vm"); return true; } catch { return false; }
  }

  async execute(input: SandboxExecutionInput): Promise<SandboxExecutionResult> {
    const start = Date.now();
    const deniedAttempts: CapabilityId[] = [];
    let ivm: typeof import("isolated-vm");
    try { ivm = await import("isolated-vm"); }
    catch (err) {
      return { success: false, error: `isolated-vm no instalado: ${(err as Error).message}`, deniedCapabilityAttempts: deniedAttempts, durationMs: Date.now() - start, provider: this.providerName };
    }

    const pool = await this.getOrCreatePool(ivm);
    const isolate = pool ? await pool.acquire() : new ivm.Isolate({ memoryLimit: this.config.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB });

    const pendingFetchCalls: Promise<unknown>[] = [];

    let context: import("isolated-vm").Context | undefined;
    try {
      context = await isolate.createContext();
      const jail = context.global;
      await jail.set("global", jail.derefInto());
      const grantedSet = input.granted;

      await jail.set("__portalessLog", (...args: unknown[]) => { console.log(`[plugin:${input.manifest.name}]`, ...args); });

      if (grantedSet.has("network:fetch")) {
        const allowedHosts = new Set(input.manifest.requestedCapabilities.find((c) => c.id === "network:fetch")?.allowedHosts ?? []);
        const fetchRef = new ivm.Reference((urlStr: string, opts?: string) => {
          const call = (async () => {
            const parsed = new URL(urlStr);
            if (!allowedHosts.has(parsed.host)) { deniedAttempts.push("network:fetch"); throw new Error(`Host no autorizado: ${parsed.host}`); }
            const parsedOpts = opts ? JSON.parse(opts) : undefined;
            const res = await fetch(urlStr, parsedOpts);
            return await res.text();
          })();
          pendingFetchCalls.push(call.catch(() => undefined));
          return call;
        });
        await jail.set("__portalessFetchRef", fetchRef);
      } else {
        await jail.set("__portalessFetchRef", undefined);
        await jail.set("__portalessFetch", () => { deniedAttempts.push("network:fetch"); throw new Error("Capacidad 'network:fetch' no concedida."); });
      }

      const hostBridge = input.hostBridge ?? {};
      for (const spec of CAPABILITY_BRIDGES) {
        if (grantedSet.has(spec.capability)) {
          const ref = new ivm.Reference((argsJson?: string) => {
            const call = spec.invokeHost(hostBridge, input.manifest.name, argsJson ?? "null");
            pendingFetchCalls.push(call.catch(() => undefined));
            return call;
          });
          await jail.set(`${spec.globalName}Ref`, ref);
        } else {
          await jail.set(`${spec.globalName}Ref`, undefined);
          await jail.set(spec.globalName, () => {
            deniedAttempts.push(spec.capability);
            throw new Error(`Capacidad '${spec.capability}' no concedida.`);
          });
        }
      }

      await jail.set("__portalessPayload", JSON.stringify(input.payload ?? null));

      const executableBody = await resolveExecutableBody(isolate, input.code);

      const bridgeApplyOpts = { arguments: { copy: true }, result: { promise: true, copy: true } };
      const wrappedCode = `
        const payload = JSON.parse(__portalessPayload);
        const console = { log: __portalessLog };
        const fetchAllowed = (url, opts) => __portalessFetchRef
          ? __portalessFetchRef.apply(undefined, [url, opts ? JSON.stringify(opts) : undefined], ${JSON.stringify(bridgeApplyOpts)})
          : __portalessFetch(url, opts);
        function invokeBridge(ref, fallback, args) {
          const argsJson = JSON.stringify(args ?? null);
          if (ref) return ref.apply(undefined, [argsJson], ${JSON.stringify(bridgeApplyOpts)}).then((r) => JSON.parse(r));
          return Promise.resolve().then(() => fallback(argsJson));
        }
        const capabilities = {
          readContent: (args) => invokeBridge(__portalessReadContentRef, typeof __portalessReadContent === "function" ? __portalessReadContent : undefined, args),
          writeContent: (args) => invokeBridge(__portalessWriteContentRef, typeof __portalessWriteContent === "function" ? __portalessWriteContent : undefined, args),
          mediaRead: (args) => invokeBridge(__portalessMediaReadRef, typeof __portalessMediaRead === "function" ? __portalessMediaRead : undefined, args),
          mediaWrite: (args) => invokeBridge(__portalessMediaWriteRef, typeof __portalessMediaWrite === "function" ? __portalessMediaWrite : undefined, args),
          emailSend: (args) => invokeBridge(__portalessEmailSendRef, typeof __portalessEmailSend === "function" ? __portalessEmailSend : undefined, args),
          commerceRead: (args) => invokeBridge(__portalessCommerceReadRef, typeof __portalessCommerceRead === "function" ? __portalessCommerceRead : undefined, args),
          commerceCheckout: (args) => invokeBridge(__portalessCommerceCheckoutRef, typeof __portalessCommerceCheckout === "function" ? __portalessCommerceCheckout : undefined, args),
          storageRead: (args) => invokeBridge(__portalessStorageReadRef, typeof __portalessStorageRead === "function" ? __portalessStorageRead : undefined, args),
          storageWrite: (args) => invokeBridge(__portalessStorageWriteRef, typeof __portalessStorageWrite === "function" ? __portalessStorageWrite : undefined, args),
          agentIdentify: (args) => invokeBridge(__portalessAgentIdentifyRef, typeof __portalessAgentIdentify === "function" ? __portalessAgentIdentify : undefined, args),
          siteAdmin: (args) => invokeBridge(__portalessSiteAdminRef, typeof __portalessSiteAdmin === "function" ? __portalessSiteAdmin : undefined, args),
        };
        globalThis.__portalessResultPromise = (async function(payload, console, fetchAllowed, capabilities) {
          ${executableBody}
        })(payload, console, fetchAllowed, capabilities);
        globalThis.__portalessResultPromise;
      `;

      const script = await isolate.compileScript(wrappedCode);
      const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const rawResult = await script.run(context, { timeout, copy: true, promise: true } as any);

      await Promise.allSettled(pendingFetchCalls);

      return { success: true, output: rawResult, deniedCapabilityAttempts: deniedAttempts, durationMs: Date.now() - start, provider: this.providerName };
    } catch (err) {
      await Promise.allSettled(pendingFetchCalls);
      return { success: false, error: (err as Error).message, deniedCapabilityAttempts: deniedAttempts, durationMs: Date.now() - start, provider: this.providerName };
    } finally {
      try { context?.release(); } catch { /* ya liberado o nunca creado */ }

      if (pool) {
        pool.release(isolate);
      } else {
        isolate.dispose();
      }
    }
  }
}