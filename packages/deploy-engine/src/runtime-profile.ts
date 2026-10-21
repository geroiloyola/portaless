// Minimal private-node runtime contract (C37/C38). These values are shared by
// Docker Compose profiles, the Node runtime and resource tests.

export const MINIMAL_RUNTIME_PROFILE = {
  name: "portaless-private-node",
  maxConcurrentRequests: 64,
  dockerMemoryLimit: "2g",
  dockerCpuLimit: 1,
  diskBudgetBytes: 20 * 1024 * 1024 * 1024,
  ramBudgetBytes: 2 * 1024 * 1024 * 1024,
  requiredRuntimePathsAbsent: [".astro", "docs", "src/content/pages", "src/content/posts"],
} as const;

export function resolveMaxConcurrentRequests(raw: unknown): number {
  const value = Number(raw ?? MINIMAL_RUNTIME_PROFILE.maxConcurrentRequests);
  if (!Number.isInteger(value) || value < 1 || value > 1024) {
    throw new Error("PORTALESS_MAX_CONCURRENT_REQUESTS must be an integer between 1 and 1024");
  }
  return value;
}

export function validatePrivateNetworkProfile(input: { publishedPorts: number; internalNetwork: boolean; tailscaleOptional: boolean }): string[] {
  const errors: string[] = [];
  if (input.publishedPorts !== 0) errors.push("private profile must not publish app ports");
  if (!input.internalNetwork) errors.push("private profile must use an internal network");
  if (!input.tailscaleOptional) errors.push("tailscale must be an optional profile, not the default access path");
  return errors;
}
