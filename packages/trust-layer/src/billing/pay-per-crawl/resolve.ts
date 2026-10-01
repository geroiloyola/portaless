// Registro de proveedores y decision de cobro para el middleware.
// Cobra solo si el manifiesto declara settlement_provider Y hay activacion
// verificada en la base para ese mismo proveedor.

import type { ContentPolicyManifest, PolicyRule } from "../../policy/manifest-schema";
import type { PayPerCrawlProvider } from "./types";
import { CloudflarePayPerCrawlProvider } from "./cloudflare";
import type { SettlementActivationStore } from "./activation-store";

const PROVIDERS: PayPerCrawlProvider[] = [new CloudflarePayPerCrawlProvider()];

export function listPayPerCrawlProviders(): PayPerCrawlProvider[] {
  return [...PROVIDERS];
}

export function getPayPerCrawlProvider(id: string | undefined | null): PayPerCrawlProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export interface ResolveChargeInput {
  policy: ContentPolicyManifest;
  rule: PolicyRule;
  request: Request;
  next: () => Promise<Response>;
  store: SettlementActivationStore;
}

export interface ResolveChargeResult {
  providerId: string;
  response: Response;
}

export async function resolvePayPerCrawl(input: ResolveChargeInput): Promise<ResolveChargeResult | null> {
  const provider = getPayPerCrawlProvider(input.policy.settlement_provider);
  if (!provider) return null;
  const activation = await input.store.get(provider.id);
  if (!activation) return null;
  const response = await provider.handleCharge({ request: input.request, rule: input.rule, next: input.next });
  return response ? { providerId: provider.id, response } : null;
}
