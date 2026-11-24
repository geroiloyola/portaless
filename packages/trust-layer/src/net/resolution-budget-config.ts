// Pure ResolutionBudgetConfigStore port, validator, and InMemory implementation (L2).
// SQLite/D1 adapters live in `@portaless/trust-storage-adapters` (Node-L0).

export interface ResolutionBudgetConfiguration {
  version: 1;
  windowMs: number;
  client: { attempts: number; bytes: number };
  origin: { attempts: number; bytes: number };
  maxBuckets: number;
  maxConcurrentTotal: number;
  maxConcurrentPerClient: number;
  maxConcurrentPerOrigin: number;
}

export interface ResolutionBudgetConfigRecord {
  config: ResolutionBudgetConfiguration;
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

export const INVALID_RESOLUTION_BUDGET_CONFIG = "invalid_resolution_budget_config";
export const RESOLUTION_BUDGET_CONFIG_CONFLICT = "resolution_budget_config_conflict";

function int(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

export function validateResolutionBudgetConfiguration(
  value: unknown,
): value is ResolutionBudgetConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, any>;
  const keys = [
    "version",
    "windowMs",
    "client",
    "origin",
    "maxBuckets",
    "maxConcurrentTotal",
    "maxConcurrentPerClient",
    "maxConcurrentPerOrigin",
  ];
  if (Object.keys(config).some((key) => !keys.includes(key)) || keys.some((key) => !(key in config))) {
    return false;
  }
  if (
    config.version !== 1 ||
    !int(config.windowMs, 1000, 3_600_000) ||
    !int(config.maxBuckets, 2, 4096) ||
    !int(config.maxConcurrentTotal, 1, 64) ||
    !int(config.maxConcurrentPerClient, 1, 64) ||
    !int(config.maxConcurrentPerOrigin, 1, 64)
  ) {
    return false;
  }
  for (const scope of [config.client, config.origin]) {
    if (
      !scope ||
      typeof scope !== "object" ||
      Array.isArray(scope) ||
      Object.keys(scope).some((key) => key !== "attempts" && key !== "bytes") ||
      !int(scope.attempts, 1, 100_000) ||
      !int(scope.bytes, 1, 64 * 1024 * 1024)
    ) {
      return false;
    }
  }
  return true;
}

function cleanConfig(config: ResolutionBudgetConfiguration): ResolutionBudgetConfiguration {
  return JSON.parse(JSON.stringify(config));
}

export interface ResolutionBudgetConfigStore {
  read(): Promise<ResolutionBudgetConfigRecord | null>;
  compareAndSet(
    expectedRevision: number | null,
    config: unknown,
    updatedBy: string,
  ): Promise<ResolutionBudgetConfigRecord>;
  close?(): void;
}

export class InMemoryResolutionBudgetConfigStore implements ResolutionBudgetConfigStore {
  private current: ResolutionBudgetConfigRecord | null = null;

  async read(): Promise<ResolutionBudgetConfigRecord | null> {
    if (!this.current) return null;
    return {
      ...this.current,
      config: cleanConfig(this.current.config),
    };
  }

  async compareAndSet(
    expectedRevision: number | null,
    value: unknown,
    updatedBy: string,
  ): Promise<ResolutionBudgetConfigRecord> {
    if (!validateResolutionBudgetConfiguration(value)) throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    if (expectedRevision !== null && !int(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
      throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    }
    if (typeof updatedBy !== "string" || !updatedBy.trim() || updatedBy.length > 128) {
      throw new Error(INVALID_RESOLUTION_BUDGET_CONFIG);
    }
    if (expectedRevision === null) {
      if (this.current !== null) throw new Error(RESOLUTION_BUDGET_CONFIG_CONFLICT);
    } else if (!this.current || this.current.revision !== expectedRevision) {
      throw new Error(RESOLUTION_BUDGET_CONFIG_CONFLICT);
    }
    const next: ResolutionBudgetConfigRecord = {
      config: cleanConfig(value),
      revision: expectedRevision === null ? 1 : expectedRevision + 1,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    this.current = next;
    return { ...next, config: cleanConfig(next.config) };
  }
}
