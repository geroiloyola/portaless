/**
 * Politicas de lectura (LTP v1.2, 6.5) y niveles de visibilidad (Anexo A.6).
 * Falla cerrado: un predicado desconocido o un historial no resoluble aplica on_fail.
 */
import { scoreOf, type DimensionScore } from './scoring';

export const PUBLIC_DIMENSIONS = ['W-01', 'W-04', 'W-06', 'W-07', 'W-09'] as const;
export const GOVERNED_DIMENSIONS = ['W-02', 'W-03', 'W-05', 'W-08', 'W-10', 'R-01', 'R-02', 'R-03', 'R-04', 'R-05'] as const;
const KNOWN = new Set<string>([...PUBLIC_DIMENSIONS, ...GOVERNED_DIMENSIONS]);
const RESOURCES = ['/trust/*', '/trust/:siteId', '/trust/:siteId/attestations'];

export type OnFail = '401' | '403' | '402';

export interface DimensionPredicate { min: number; min_weight: number }

export interface ReadPolicy {
  resource: '/trust/*' | '/trust/:siteId' | '/trust/:siteId/attestations';
  action: 'read';
  require: { identity: 'apw_verified'; [dimension: string]: DimensionPredicate | 'apw_verified' };
  on_fail: OnFail;
}

export const DEFAULT_GOVERNED_POLICY: ReadPolicy = {
  resource: '/trust/*',
  action: 'read',
  require: {
    identity: 'apw_verified',
    'R-01': { min: 5.0, min_weight: 2.0 },
    'R-05': { min: 5.0, min_weight: 2.0 },
  },
  on_fail: '403',
};

export type ReaderState =
  | { kind: 'anonymous' }
  | { kind: 'wba_only'; signatureAgent: string }
  | { kind: 'apw_unresolvable'; did: string; reason: string }
  | { kind: 'apw_verified'; did: string; scores: ReadonlyMap<string, DimensionScore> };

export type PolicyDecision =
  | { allow: true }
  | { allow: false; status: OnFail; reason: string; failed: string[] };

export function validatePolicy(p: ReadPolicy): string[] {
  const errors: string[] = [];
  if (p.action !== 'read') errors.push('action debe ser read');
  if (!RESOURCES.includes(p.resource)) errors.push('recurso no gobernable en MVP');
  if (!['401', '403', '402'].includes(p.on_fail)) errors.push('on_fail invalido');
  if (p.require?.identity !== 'apw_verified') errors.push('require.identity debe ser apw_verified');
  for (const [k, v] of Object.entries(p.require ?? {})) {
    if (k === 'identity') continue;
    if (!KNOWN.has(k)) { errors.push(`dimension desconocida: ${k}`); continue; }
    if (typeof v !== 'object' || v === null) { errors.push(`${k}: predicado invalido`); continue; }
    const { min, min_weight } = v as DimensionPredicate;
    if (!(Number.isFinite(min) && min >= 1 && min <= 7)) errors.push(`${k}.min fuera de 1..7`);
    if (!(Number.isFinite(min_weight) && min_weight >= 0)) errors.push(`${k}.min_weight invalido`);
  }
  return errors;
}

export function evaluatePolicy(policy: ReadPolicy, reader: ReaderState): PolicyDecision {
  const errors = validatePolicy(policy);
  if (errors.length) return { allow: false, status: '403', reason: 'policy_invalid', failed: errors };

  if (reader.kind === 'anonymous') return { allow: false, status: '401', reason: 'web_bot_auth_required', failed: ['identity'] };
  if (reader.kind === 'wba_only') return { allow: false, status: policy.on_fail, reason: 'apw_identity_required', failed: ['identity'] };
  if (reader.kind === 'apw_unresolvable') return { allow: false, status: policy.on_fail, reason: 'history_unresolvable', failed: ['identity'] };

  const failed: string[] = [];
  for (const [k, v] of Object.entries(policy.require)) {
    if (k === 'identity') continue;
    const { min, min_weight } = v as DimensionPredicate;
    const s = scoreOf(reader.scores, k);
    if (s.score < min || s.weightSum < min_weight) failed.push(k);
  }
  return failed.length ? { allow: false, status: policy.on_fail, reason: 'reputation_insufficient', failed } : { allow: true };
}

/** A.6: el nivel publico nunca se oculta; los agregados de todas las dimensiones son publicos. */
export function projectTrustView(
  scores: ReadonlyMap<string, DimensionScore>,
  governedAllowed: boolean,
  publicOverrides: ReadonlyArray<string> = [],
) {
  const visible = new Set<string>([...PUBLIC_DIMENSIONS, ...publicOverrides.filter((d) => KNOWN.has(d))]);
  const aggregates: Record<string, { score: number; count: number; weightSum: number }> = {};
  const dimensions: Record<string, DimensionScore> = {};
  for (const [d, s] of scores) {
    aggregates[d] = { score: s.score, count: s.count, weightSum: s.weightSum };
    if (governedAllowed || visible.has(d)) dimensions[d] = s;
  }
  return { aggregates, dimensions, governed: governedAllowed ? 'granted' : 'withheld' } as const;
}
