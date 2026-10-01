// Activacion y desactivacion de proveedores pay-per-crawl. Unico camino que
// escribe la activacion y el grant billing:pay-per-crawl: los dos se escriben
// juntos o ninguno. Sin credenciales verificadas no se activa ni el permiso
// ni el proveedor.
//
// El dominio del sitio sale de la identidad APW (site_identity.domain): en
// Portaless el dominio lo define Protocol APW. Sin identidad APW no se activa.

import { encryptToken } from "../../../../deploy-engine/src/token-crypto";
import type { PermissionStore } from "../../../../permissions/src/permission-store";
import type { SettlementActivationStore } from "./activation-store";
import { getPayPerCrawlProvider } from "./resolve";
import type { ProviderCredentials } from "./types";

export const BILLING_CAPABILITY = "billing:pay-per-crawl";
export const SETTLEMENT_SUBJECT_TYPE = "settlement-provider";

export function isSettlementGrant(subjectType: unknown, capabilityId: unknown): boolean {
  return subjectType === SETTLEMENT_SUBJECT_TYPE || (typeof capabilityId === "string" && capabilityId.startsWith("billing:"));
}

export function hostFromApwDomain(domain: unknown): string | null {
  if (typeof domain !== "string" || !domain.trim()) return null;
  const raw = domain.trim();
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export interface ActivationDeps {
  activationStore: SettlementActivationStore;
  permissionStore: PermissionStore;
  encryptionKey: string | undefined;
  siteHost: string | null;
  fetch?: typeof fetch;
  now?: () => Date;
}

export type ActivationOutcome =
  | { ok: true; providerId: string; metadata: Record<string, string> }
  | { ok: false; status: number; error: string; reason?: string };

export async function activateProvider(
  providerId: string,
  credentials: ProviderCredentials,
  actor: string,
  deps: ActivationDeps
): Promise<ActivationOutcome> {
  const provider = getPayPerCrawlProvider(providerId);
  if (!provider) return { ok: false, status: 404, error: "unknown_provider" };
  if (!deps.siteHost) return { ok: false, status: 409, error: "site_identity_required" };
  if (!deps.encryptionKey || deps.encryptionKey.length < 32) {
    return { ok: false, status: 503, error: "encryption_key_missing" };
  }

  const check = await provider.verifyActivation(credentials, { siteHost: deps.siteHost, fetch: deps.fetch });
  if (!check.ok) return { ok: false, status: 400, error: "verification_failed", reason: check.reason };

  const credentialEnc = await encryptToken(JSON.stringify(credentials), deps.encryptionKey);
  const metadata = check.metadata ?? {};
  await deps.activationStore.save({
    providerId: provider.id,
    credentialEnc,
    metadata,
    verifiedAt: (deps.now?.() ?? new Date()).toISOString(),
    activatedBy: actor,
  });

  try {
    await deps.permissionStore.setGrant({
      subject: { type: SETTLEMENT_SUBJECT_TYPE, id: provider.id, displayName: provider.displayName },
      capabilityId: BILLING_CAPABILITY,
      granted: true,
      grantedBy: actor,
    });
  } catch {
    await deps.activationStore.delete(provider.id);
    return { ok: false, status: 500, error: "grant_write_failed" };
  }

  return { ok: true, providerId: provider.id, metadata };
}

export async function deactivateProvider(
  providerId: string,
  actor: string,
  deps: Pick<ActivationDeps, "activationStore" | "permissionStore">
): Promise<ActivationOutcome> {
  const provider = getPayPerCrawlProvider(providerId);
  if (!provider) return { ok: false, status: 404, error: "unknown_provider" };
  // Primero la activacion: es lo que el middleware consulta para cobrar.
  await deps.activationStore.delete(provider.id);
  await deps.permissionStore.setGrant({
    subject: { type: SETTLEMENT_SUBJECT_TYPE, id: provider.id, displayName: provider.displayName },
    capabilityId: BILLING_CAPABILITY,
    granted: false,
    grantedBy: actor,
  });
  return { ok: true, providerId: provider.id, metadata: {} };
}
