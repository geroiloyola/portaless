// C39 budget evaluation. Measurements are produced by scripts/resource-budget.mjs;
// this pure function keeps the acceptance rule testable without a long fixture.

export interface ResourceMeasurements {
  rssBytes: number;
  databaseBytes: number;
  backupBytes: number;
}

export interface ResourceBudget {
  rssBytes: number;
  diskBytes: number;
}

export const REFERENCE_RESOURCE_BUDGET: ResourceBudget = {
  rssBytes: 2 * 1024 * 1024 * 1024,
  diskBytes: 20 * 1024 * 1024 * 1024,
};

export function evaluateResourceBudget(
  measurements: ResourceMeasurements,
  budget: ResourceBudget = REFERENCE_RESOURCE_BUDGET,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!Number.isFinite(measurements.rssBytes) || measurements.rssBytes < 0) violations.push("invalid_rss");
  else if (measurements.rssBytes > budget.rssBytes) violations.push("ram_budget_exceeded");
  if (!Number.isFinite(measurements.databaseBytes) || measurements.databaseBytes < 0) violations.push("invalid_database_size");
  else if (measurements.databaseBytes > budget.diskBytes) violations.push("database_disk_budget_exceeded");
  if (!Number.isFinite(measurements.backupBytes) || measurements.backupBytes < 0) violations.push("invalid_backup_size");
  else if (measurements.backupBytes > budget.diskBytes) violations.push("backup_disk_budget_exceeded");
  return { ok: violations.length === 0, violations };
}
