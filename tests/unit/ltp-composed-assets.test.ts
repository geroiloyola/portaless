import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const audit = 'docs/protocol-apw/tools/ab-audit.mjs';
test('composed static A/B data has preserved inherited assets and byte-for-byte handoffs without executing the trace', () => {
  const result = spawnSync(process.execPath, [audit], { encoding: 'utf8', timeout: 60_000 });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ candidateDigest: 'wNQ9gG2BPs8JO1wPsiPgoz265juDT-TCjuGMbTzSYXA', cases: 7, totalTargets: 369, pinnedAssets: 61,
    identicalHandoffs: 6, absentHandoffs: 1, signatureFacts: 35, negativeSignatureFacts: 1,
    semanticVerdictsExecuted: false, traceExecuted: false, networkConnections: 0, authorizationGranted: false });
});

test('a disconnected producer/consumer binding fails even after the outer frozen-asset checks have passed', () => {
  const result = spawnSync(process.execPath, [audit, '--disconnect-for-test'], { encoding: 'utf8', timeout: 20_000 });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('producer/consumer byte transfer');
});

test('agent entrypoints and the live ADR refer to the canonical register and contain no post-merge engine authorization', () => {
  for (const path of ['AGENT.md', 'AGENTS.md', 'docs/decisions/0003-public-and-governed-resource-contract.md', 'docs/architecture/resolution-chain-proposal.md']) {
    const text = readFileSync(new URL('../../'+path, import.meta.url), 'utf8');
    expect(text, path).toContain('LTP-GATES-AND-AUTHORIZATIONS.md');
    expect(text, path).not.toMatch(/After merge, the next phase is exclusively implementing/i);
    expect(text, path).not.toMatch(/programming is blocked until the documentary commit is merged/i);
    expect(text, path).not.toMatch(/Tras la fusión, la fase siguiente se limita al motor/i);
  }
});
