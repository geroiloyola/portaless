// Proveedores de pay-per-crawl intercambiables. Portaless no toca el dinero
// (APW-SPEC 9): cada proveedor delega el cobro en una infraestructura externa
// (Cloudflare hoy; github-pay-per-crawl o uno propio de Portaless mas adelante).
//
// Regla de activacion: un proveedor solo cobra si (1) el manifiesto publico
// declara settlement_provider con su id y (2) existe una activacion en la base
// creada tras verifyActivation() exitoso. El manifiesto solo anuncia; la
// autoridad es la activacion verificada (ver resolve.ts).

import type { PolicyRule } from "../../policy/manifest-schema";

export interface CredentialSpec {
  key: string;
  label: string;
  secret: boolean;
  help?: string;
}

export type ProviderCredentials = Record<string, string>;

export interface ActivationCheck {
  ok: boolean;
  reason?: string;
  /** Datos no secretos para mostrar en la UI (ej. zone_name). */
  metadata?: Record<string, string>;
}

export interface VerifyContext {
  siteHost: string;
  fetch?: typeof fetch;
}

export interface ChargeContext {
  request: Request;
  rule: PolicyRule;
  next: () => Promise<Response>;
}

export interface PayPerCrawlProvider {
  id: string;
  displayName: string;
  credentials: CredentialSpec[];
  verifyActivation(creds: ProviderCredentials, ctx: VerifyContext): Promise<ActivationCheck>;
  /** null = el proveedor no aplica a esta request: el middleware responde 402 not_available. */
  handleCharge(ctx: ChargeContext): Promise<Response | null>;
}
