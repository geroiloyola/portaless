import { describe, expect, it } from 'vitest';
import {
  bayesianScore, calibrateJudges, issuerWeight, judgeFromDeviation, readerConductToDimension,
  scoreSubject, toValue, type ScoredAttestation,
} from './scoring';
import { DEFAULT_GOVERNED_POLICY, evaluatePolicy, projectTrustView } from './policy';

const rep = (n: number, weight: number, value: number) => Array.from({ length: n }, () => ({ weight, value }));

describe('Anexo A.4.2 peso del emisor', () => {
  it('vectores', () => {
    expect(issuerWeight(4)).toBeCloseTo(0.25, 10);
    expect(issuerWeight(6.7)).toBeCloseTo(0.9025, 10);
    expect(issuerWeight(1)).toBe(0);
    expect(issuerWeight(6.7) / issuerWeight(4)).toBeCloseTo(3.61, 10);
  });
  it('J por desviacion', () => {
    expect(judgeFromDeviation(null)).toBe(4);
    expect(judgeFromDeviation(0)).toBe(7);
    expect(judgeFromDeviation(2)).toBe(4);
    expect(judgeFromDeviation(10)).toBe(1);
  });
});

describe('Anexo A.4.4 ejemplos (ERRATA E-6)', () => {
  it('sitio A: 10 x 7.0 con J=6 da 6.095; ataque de J=4 con 1.0 da 5.970', () => {
    const base = rep(10, issuerWeight(6), 7);
    expect(bayesianScore(base).score).toBeCloseTo(6.0950, 3);
    expect(bayesianScore([...base, { weight: issuerWeight(4), value: 1 }]).score).toBeCloseTo(5.9700, 3);
  });
  it('sitio B: 10 x 4.0 con J=5; J=6.7 con 3.0 -> 3.89, con 1.0 -> 3.68', () => {
    const base = rep(10, issuerWeight(5), 4);
    expect(bayesianScore(base).score).toBeCloseTo(4, 10);
    expect(bayesianScore([...base, { weight: issuerWeight(6.7), value: 3 }]).score).toBeCloseTo(3.8919, 3);
    expect(bayesianScore([...base, { weight: issuerWeight(6.7), value: 1 }]).score).toBeCloseTo(3.6756, 3);
  });
  it('sin atestaciones = neutral 4.0', () => {
    expect(bayesianScore([]).score).toBe(4);
  });
});

describe('A.4.1 valores', () => {
  it('mapea booleanas y community', () => {
    expect(toValue(true, 'boolean')).toBe(7);
    expect(toValue(false, 'boolean')).toBe(1);
    expect(toValue(1, 'community')).toBe(1);
    expect(toValue(3, 'community')).toBe(4);
    expect(toValue(5, 'community')).toBe(7);
    expect(() => toValue(6, 'community')).toThrow();
  });
  it('reader_conduct negativas', () => {
    expect(readerConductToDimension('policy_violation', true)).toEqual({ dimension: 'R-01', value: 1 });
    expect(readerConductToDimension('redistribution', true)).toEqual({ dimension: 'R-04', value: 1 });
    expect(readerConductToDimension('respected_policy', true)).toEqual({ dimension: 'R-01', value: 7 });
    expect(() => readerConductToDimension('x', true)).toThrow();
  });
});

describe('R-05 calibracion leave-one-out (ERRATA E-7)', () => {
  const att: ScoredAttestation[] = [];
  let id = 0;
  const add = (iss: string, sub: string, value: number) =>
    att.push({ id: String(id++), iss, sub, src: 'agent', dimension: 'W-10', value });
  for (const sub of ['s1', 's2', 's3', 's4']) {
    for (const iss of ['h1', 'h2', 'h3', 'h4']) add(iss, sub, 6.5);
    add('attacker', sub, 1);
  }
  const judges = calibrateJudges(att);
  it('el atacante pierde peso y los honestos lo ganan', () => {
    expect(judges.get('attacker')!).toBeLessThan(judges.get('h1')!);
    expect(issuerWeight(judges.get('attacker')!)).toBeLessThan(0.25);
    expect(judges.get('h1')!).toBeGreaterThan(6);
    expect(judges.get('attacker')!).toBeLessThan(2);
  });
  it('self nunca alimenta R-05 propio y pesa 0.25', () => {
    const withSelf: ScoredAttestation[] = [...att, { id: 'self', iss: 's1', sub: 's1', src: 'self', dimension: 'W-03', value: 7 }];
    const j = calibrateJudges(withSelf);
    expect(j.has('s1')).toBe(false);
    const s = scoreSubject('s1', withSelf, j).get('W-03')!;
    expect(s.weightSum).toBeCloseTo(0.25, 10);
  });
});

describe('6.5 / A.6 politica por defecto', () => {
  const strong = new Map([
    ['R-01', { dimension: 'R-01', score: 5.6, count: 8, weightSum: 3 }],
    ['R-05', { dimension: 'R-05', score: 5.2, count: 6, weightSum: 6 }],
  ]);
  it('anonimo -> 401; WBA sin APW -> on_fail; no resoluble -> on_fail (nunca abre)', () => {
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, { kind: 'anonymous' })).toMatchObject({ allow: false, status: '401' });
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, { kind: 'wba_only', signatureAgent: 'https://x.example' })).toMatchObject({ allow: false, status: '403' });
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, { kind: 'apw_unresolvable', did: 'did:apw:x.example', reason: 'timeout' })).toMatchObject({ allow: false, status: '403' });
  });
  it('lector nuevo (todo 4.0) es rechazado', () => {
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, { kind: 'apw_verified', did: 'did:apw:n.example', scores: new Map() }))
      .toMatchObject({ allow: false, failed: ['R-01', 'R-05'] });
  });
  it('lector con reputacion y peso suficiente pasa', () => {
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, { kind: 'apw_verified', did: 'did:apw:i.example', scores: strong })).toEqual({ allow: true });
  });
  it('puntaje alto con poco peso no alcanza', () => {
    const thin = new Map(strong);
    thin.set('R-01', { dimension: 'R-01', score: 6.5, count: 1, weightSum: 0.5 });
    expect(evaluatePolicy(DEFAULT_GOVERNED_POLICY, { kind: 'apw_verified', did: 'did:apw:i.example', scores: thin }))
      .toMatchObject({ allow: false, failed: ['R-01'] });
  });
  it('nivel publico nunca se oculta; agregados siempre visibles', () => {
    const site = new Map([
      ['W-01', { dimension: 'W-01', score: 6, count: 3, weightSum: 2 }],
      ['W-10', { dimension: 'W-10', score: 5, count: 4, weightSum: 1 }],
    ]);
    const v = projectTrustView(site, false);
    expect(Object.keys(v.dimensions)).toEqual(['W-01']);
    expect(Object.keys(v.aggregates).sort()).toEqual(['W-01', 'W-10']);
    expect(Object.keys(projectTrustView(site, true).dimensions).sort()).toEqual(['W-01', 'W-10']);
  });
});
