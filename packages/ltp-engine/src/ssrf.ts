import {
  BLOCKED_IPV4_RANGE_COUNT,
  BLOCKED_IPV6_RANGE_COUNT,
  PinningError,
  isBlockedHostname as netIsBlockedHostname,
  isBlockedIp as netIsBlockedIp,
  resolvePinnedAddress as netResolvePinnedAddress,
  type ResolveHook,
  type ResolvedAddress,
} from "@portaless/net";
import { LtpFailure } from "./budget";

export { BLOCKED_IPV4_RANGE_COUNT, BLOCKED_IPV6_RANGE_COUNT };
export type { ResolveHook, ResolvedAddress };

export function isBlockedIp(address: string): boolean {
  return netIsBlockedIp(address);
}

export function isBlockedHostname(hostname: string): boolean {
  return netIsBlockedHostname(hostname);
}

/** Validates scheme/credentials/fragment/port before any DNS or socket work. */
export function assertSafeEndpointUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LtpFailure("unsupported_profile", "invalid endpoint URL");
  }
  if (url.protocol !== "https:") throw new LtpFailure("ssrf_blocked", "https_required");
  if (url.username || url.password) throw new LtpFailure("ssrf_blocked", "userinfo_not_allowed");
  if (url.hash) throw new LtpFailure("ssrf_blocked", "fragment_not_allowed");
  if (!url.hostname || isBlockedHostname(url.hostname)) {
    throw new LtpFailure("ssrf_blocked", "blocked_endpoint_host");
  }
  return url;
}

/**
 * Resolves once, rejects if ANY answer is in a blocked range, then returns the
 * exact address the socket must use (anti-DNS-rebinding).
 */
export async function resolvePinnedAddress(
  hostname: string,
  resolver?: ResolveHook,
  signal?: AbortSignal,
): Promise<ResolvedAddress> {
  try {
    return await netResolvePinnedAddress(hostname, resolver, signal);
  } catch (error) {
    if (error instanceof PinningError) {
      throw new LtpFailure(error.code, error.message);
    }
    throw new LtpFailure("service_unavailable", "dns_resolution_failed");
  }
}
