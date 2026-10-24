import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { checkTree, violations, fileClass } from '../../scripts/check-ltp-naming.mjs';

test('live docs, READMEs and site text use only Local Trust Protocol outside explicit continuity/history', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  expect(checkTree(root)).toEqual([]);
  for (const path of ['README.md', 'AGENT.md', 'docs/glossary.md', 'src/pages/example.astro', 'packages/example/README.md']) {
    expect(violations(path, 'Local Trust Protocol (LTP)')).toEqual([]);
    expect(violations(path, 'Loyal Trust Protocol (LTP)')).not.toEqual([]);
    expect(violations(path, 'Loyola Trust Protocol (LTP)')).not.toEqual([]);
    expect(violations(path, 'LTP = Lunar Transfer Protocol')).not.toEqual([]);
    expect(violations(path, 'LTP (Logical Trust Protocol)')).not.toEqual([]);
    expect(violations(path, '<!-- ltp-continuity:start -->\nFormerly Loyal Trust Protocol.\n<!-- ltp-continuity:end -->')).toEqual([]);
    expect(violations(path, '<!-- ltp-history:start -->\nLoyola Trust Protocol\n<!-- ltp-history:end -->\nLoyal Trust Protocol')).not.toEqual([]);
    expect(violations(path, '<!-- ltp-continuity:start -->')).not.toEqual([]);
  }
  expect(fileClass('docs/protocol-apw/APW-SPEC-v1.3_es.md')).toBe('history');
  expect(fileClass('docs/protocol-apw/APW-SPEC-v1.2.md')).toBe('history');
  expect(fileClass('docs/protocol-apw/vectors/ltp/v0.1/crypto-ledger.json')).toBe('protected-bytes');
  expect(violations('CHANGELOG.md', '## Unreleased\nLocal Trust Protocol\n## v0.0.10\nLoyal Trust Protocol')).toEqual([]);
  expect(violations('CHANGELOG.md', '## Unreleased\nLoyal Trust Protocol\n## v0.0.10')).not.toEqual([]);
});

test('the unique glossary expansion and unrelated RFC collision preserve authorship and old section URLs', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const glossary = read('docs/glossary.md');
  expect(glossary).toContain('| **LTP** | **Local Trust Protocol**');
  expect(glossary).toContain('RFC 5326');
  const spec = read('docs/protocol-apw/APW-SPEC-v1.3.md');
  expect(spec).toContain('**Author**: Gerardo Loyola');
  expect(spec).toContain('Annex A adapts the Veranet Universal Scoring System, by the same author');
  expect(spec).toContain('id="6-reputation-based-read-governance--loyal-trust-protocol-v12--e-8-e-9"');
  expect(read('src/pages/trust/explicacion-svri.astro')).toContain('Local Trust Protocol');
});
