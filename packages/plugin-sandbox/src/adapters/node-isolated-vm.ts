import type { SandboxAdapter, SandboxExecutionInput, SandboxExecutionResult, CapabilityId } from "../types";

const MIN_SAFE_VERSIONS = { "6.x": "6.2.0", "7.x": "7.0.1" };
const DEFAULT_MEMORY_LIMIT_MB = 128;
const DEFAULT_TIMEOUT_MS = 5000;

export interface NodeIsolatedVmAdapterConfig {
  memoryLimitMb?: number; timeoutMs?: number; installedVersion: string; networkAllowlistOverride?: string[];
}

export class NodeIsolatedVmAdapter implements SandboxAdapter {
  readonly providerName = "node-isolated-vm";
  readonly supportsWasm = false;

  constructor(private config: NodeIsolatedVmAdapterConfig) { this.assertSafeVersion(config.installedVersion); }

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

    const isolate = new ivm.Isolate({ memoryLimit: this.config.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB });

    try {
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set("global", jail.derefInto());
      const grantedSet = input.granted;

      await jail.set("__portalessLog", (...args: unknown[]) => { console.log(`[plugin:${input.manifest.name}]`, ...args); });

      if (grantedSet.has("network:fetch")) {
        const allowedHosts = new Set(input.manifest.requestedCapabilities.find((c) => c.id === "network:fetch")?.allowedHosts ?? []);
        // { result: { promise: true } } es obligatorio: esta funcion es async,
        // y sin este flag isolated-vm intenta clonar el objeto Promise que
        // retorna de inmediato (antes de resolver) en vez de esperar su
        // resolucion y clonar el valor final. Sin esto falla con
        // "TypeError: #<Promise> could not be cloned." (ver GHSA-864f-rcv7-6rh4
        // y issues #234/#240/#430 del repo laverdet/isolated-vm).
        await jail.set(
          "__portalessFetch",
          async (urlStr: string, opts?: string) => {
            const parsed = new URL(urlStr);
            if (!allowedHosts.has(parsed.host)) { deniedAttempts.push("network:fetch"); throw new Error(`Host no autorizado: ${parsed.host}`); }
            const parsedOpts = opts ? JSON.parse(opts) : undefined;
            const res = await fetch(urlStr, parsedOpts);
            return await res.text();
          },
          { result: { promise: true } }
        );
      } else {
        await jail.set("__portalessFetch", () => { deniedAttempts.push("network:fetch"); throw new Error("Capacidad 'network:fetch' no concedida."); });
      }

      if (!grantedSet.has("content:read")) {
        await jail.set("__portalessReadContent", () => { deniedAttempts.push("content:read"); throw new Error("Capacidad 'content:read' no concedida."); });
      }
      if (!grantedSet.has("content:write")) {
        await jail.set("__portalessWriteContent", () => { deniedAttempts.push("content:write"); throw new Error("Capacidad 'content:write' no concedida."); });
      }

      await jail.set("__portalessPayload", JSON.stringify(input.payload ?? null));

      const wrappedCode = `
        const payload = JSON.parse(__portalessPayload);
        const console = { log: __portalessLog };
        const fetchAllowed = (url, opts) => __portalessFetch(url, opts ? JSON.stringify(opts) : undefined).then((t) => t);
        (async function(payload, console, fetchAllowed) {
          ${input.code}
        })(payload, console, fetchAllowed);
      `;

      const script = await isolate.compileScript(wrappedCode);
      const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const rawResult = await script.run(context, { timeout, copy: true, promise: true } as any);

      return { success: true, output: rawResult, deniedCapabilityAttempts: deniedAttempts, durationMs: Date.now() - start, provider: this.providerName };
    } catch (err) {
      return { success: false, error: (err as Error).message, deniedCapabilityAttempts: deniedAttempts, durationMs: Date.now() - start, provider: this.providerName };
    } finally {
      isolate.dispose();
    }
  }
}
