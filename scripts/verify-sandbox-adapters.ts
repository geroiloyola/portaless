// scripts/verify-sandbox-adapters.ts — Phase 3 del roadmap: verificacion
// REAL de los adaptadores edge (Cloudflare Workers for Platforms y Deno
// Deploy) contra una cuenta real. Este script NO corre en CI (no hay
// credenciales ahi) y existe para convertir "unverified, per External
// section" en un solo comando ejecutable por el operador.
//
// Uso:
//   node node_modules/tsx/dist/cli.mjs scripts/verify-sandbox-adapters.ts
//
// Credenciales (cada proveedor es opcional; sin ellas se omite con aviso):
//   Cloudflare:
//     PORTALESS_CLOUDFLARE_ACCOUNT_ID, PORTALESS_CLOUDFLARE_API_TOKEN,
//     PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE,
//     PORTALESS_CLOUDFLARE_DISPATCHER_URL,
//     PORTALESS_CLOUDFLARE_DISPATCHER_TOKEN (dispatcher fail-closed)
//   Deno Deploy:
//     PORTALESS_DENO_PROJECT_ID, PORTALESS_DENO_API_TOKEN
//
// Plugin de prueba: eco trivial (sin capacidades, sin red) — verifica el
// canal upload -> invoke -> output, no el sandbox completo. Exit code 0
// si todo lo configurado pasa (o no hay nada configurado), 1 si algo
// falla de verdad.

import {
  CloudflareWorkersForPlatformsAdapter,
  DenoDeployAdapter,
} from "../packages/plugin-sandbox/src/index";
import type { SandboxExecutionInput, GrantedCapabilities } from "../packages/plugin-sandbox/src/types";

const TEST_PLUGIN_CODE = `
globalThis.__portalessPluginEntry = async (payload) => ({ pong: true, echo: payload ?? null });
`;

function testInput(payload: unknown): SandboxExecutionInput {
  return {
    manifest: {
      name: "portaless-verify-adapter",
      version: "0.0.1",
      // Campos minimos que validateManifest exige (no pasamos por el
      // validador aqui: el objetivo es el canal, no el manifest).
    } as SandboxExecutionInput["manifest"],
    granted: new Set() as GrantedCapabilities,
    code: TEST_PLUGIN_CODE,
    payload,
  };
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

async function verifyCloudflare(): Promise<"skipped" | "ok" | "failed"> {
  const accountId = env("PORTALESS_CLOUDFLARE_ACCOUNT_ID");
  const apiToken = env("PORTALESS_CLOUDFLARE_API_TOKEN");
  const dispatchNamespace = env("PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE");
  const dispatcherUrl = env("PORTALESS_CLOUDFLARE_DISPATCHER_URL");
  const dispatcherToken = env("PORTALESS_CLOUDFLARE_DISPATCHER_TOKEN");

  if (!accountId || !apiToken || !dispatchNamespace || !dispatcherUrl) {
    console.log("[cloudflare] OMITIDO — faltan credenciales.");
    console.log("[cloudflare]   PORTALESS_CLOUDFLARE_ACCOUNT_ID, PORTALESS_CLOUDFLARE_API_TOKEN,");
    console.log("[cloudflare]   PORTALESS_CLOUDFLARE_DISPATCH_NAMESPACE, PORTALESS_CLOUDFLARE_DISPATCHER_URL");
    console.log("[cloudflare]   (ver infra/cloudflare/dispatcher/README.md para desplegar el dispatcher)");
    return "skipped";
  }
  if (!dispatcherToken) {
    console.log("[cloudflare] AVISO: PORTALESS_CLOUDFLARE_DISPATCHER_TOKEN ausente — el dispatcher desplegado es fail-closed y rechazara la invocacion con 401.");
  }

  const adapter = new CloudflareWorkersForPlatformsAdapter({
    accountId,
    dispatchNamespace,
    apiToken,
    dispatcherUrl,
    dispatcherToken,
  });

  console.log(`[cloudflare] subiendo e invocando en namespace "${dispatchNamespace}"...`);
  const result = await adapter.execute(testInput({ ts: Date.now() }));
  if (!result.success) {
    console.error(`[cloudflare] FALLÓ: ${result.error}`);
    return "failed";
  }
  const output = result.output as { pong?: boolean } | null;
  if (!output || output.pong !== true) {
    console.error(`[cloudflare] FALLÓ: output inesperado: ${JSON.stringify(result.output)}`);
    return "failed";
  }
  console.log(`[cloudflare] OK — upload + invoke en ${result.durationMs}ms, output=${JSON.stringify(result.output)}`);
  return "ok";
}

async function verifyDeno(): Promise<"skipped" | "ok" | "failed"> {
  const projectId = env("PORTALESS_DENO_PROJECT_ID");
  const apiToken = env("PORTALESS_DENO_API_TOKEN");

  if (!projectId || !apiToken) {
    console.log("[deno] OMITIDO — faltan credenciales.");
    console.log("[deno]   PORTALESS_DENO_PROJECT_ID, PORTALESS_DENO_API_TOKEN");
    console.log("[deno]   (https://dash.deno.com -> project settings)");
    return "skipped";
  }

  const adapter = new DenoDeployAdapter({ projectId, apiToken });
  console.log(`[deno] subiendo e invocando en proyecto "${projectId}"...`);
  const result = await adapter.execute(testInput({ ts: Date.now() }));
  if (!result.success) {
    console.error(`[deno] FALLÓ: ${result.error}`);
    return "failed";
  }
  const output = result.output as { pong?: boolean } | null;
  if (!output || output.pong !== true) {
    console.error(`[deno] FALLÓ: output inesperado: ${JSON.stringify(result.output)}`);
    return "failed";
  }
  console.log(`[deno] OK — upload + invoke en ${result.durationMs}ms, output=${JSON.stringify(result.output)}`);
  return "ok";
}

async function main(): Promise<void> {
  console.log("verify-sandbox-adapters: verificacion real de adaptadores edge (Phase 3).\n");
  const cf = await verifyCloudflare();
  console.log("");
  const deno = await verifyDeno();

  const statuses = [cf, deno];
  if (statuses.includes("failed")) {
    console.error("\nResultado: FALLÓ al menos un proveedor configurado — revisa los errores arriba.");
    process.exit(1);
  }
  const verified = statuses.filter((s) => s === "ok").length;
  if (verified === 0) {
    console.log("\nResultado: nada verificado (no hay credenciales configuradas).");
    console.log("Este script existe para que el operador verifique con SU cuenta; sin credenciales no hay nada que probar aqui.");
    process.exit(0);
  }
  console.log(`\nResultado: ${verified} proveedor(es) verificado(s) contra la API real.`);
}

main().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
