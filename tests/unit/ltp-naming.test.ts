import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { checkTree, violations, fileClass, HASH_PINNED_SPEC_FILES } from '../../scripts/check-ltp-naming.mjs';

test('live docs, READMEs and site text enforce W1.7 naming rules outside explicit continuity/history/hash-pinned files', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  expect(checkTree(root)).toEqual([]);
  for (const path of ['README.md', 'AGENT.md', 'docs/glossary.md', 'src/pages/example.astro', 'packages/example/README.md']) {
    expect(violations(path, 'Local Trust Protocol (LTP)')).toEqual([]);
    expect(violations(path, 'Vera Trust Stack and Verared')).toEqual([]);
    expect(violations(path, 'Loyal Trust Protocol (LTP)')).not.toEqual([]);
    expect(violations(path, 'Loyola Trust Protocol (LTP)')).not.toEqual([]);
    expect(violations(path, 'LTP = Lunar Transfer Protocol')).not.toEqual([]);
    expect(violations(path, 'LTP (Logical Trust Protocol)')).not.toEqual([]);
    expect(violations(path, 'The LTP Stack defines layers.')).not.toEqual([]);
    expect(violations(path, 'Future Veranet federation.')).not.toEqual([]);
    expect(violations(path, 'Annex A adapts the Veranet Universal Scoring System.')).toEqual([]);
    expect(violations(path, '<!-- ltp-continuity:start -->\nFormerly Loyal Trust Protocol and LTP Stack.\n<!-- ltp-continuity:end -->')).toEqual([]);
    expect(violations(path, '<!-- ltp-history:start -->\nLoyola Trust Protocol\n<!-- ltp-history:end -->\nLoyal Trust Protocol')).not.toEqual([]);
    expect(violations(path, '<!-- ltp-continuity:start -->')).not.toEqual([]);
  }

  // Normative protocol docs (unpinned) enforce Witness Index and community attester.
  expect(violations('docs/protocol-apw/STARTER-KIT.md', 'Run a Witness Index and community attester.')).toEqual([]);
  expect(violations('docs/protocol-apw/STARTER-KIT.md', 'Run a Portaless Index.')).not.toEqual([]);
  expect(violations('docs/protocol-apw/STARTER-KIT.md', 'Identity of the Veracier.')).not.toEqual([]);
  // Product docs outside docs/protocol-apw/ may still use Portaless Index and Veracier.
  expect(violations('docs/veracier-onboarding.md', 'Portaless Index and Veracier UX.')).toEqual([]);

  expect(fileClass('docs/protocol-apw/APW-SPEC-v1.3_es.md')).toBe('history');
  expect(fileClass('docs/protocol-apw/APW-SPEC-v1.2.md')).toBe('history');
  expect(fileClass('docs/protocol-apw/APW-SPEC-v1.3.md')).toBe('hash-pinned');
  expect(fileClass('docs/protocol-apw/LTP-APPROVAL-RECORD.md')).toBe('hash-pinned');
  expect(HASH_PINNED_SPEC_FILES.size).toBe(19);
  expect(fileClass('docs/protocol-apw/vectors/ltp/v0.1/crypto-ledger.json')).toBe('protected-bytes');
  expect(violations('CHANGELOG.md', '## Unreleased\nLocal Trust Protocol\n## v0.0.10\nLoyal Trust Protocol')).toEqual([]);
  expect(violations('CHANGELOG.md', '## Unreleased\nLoyal Trust Protocol\n## v0.0.10')).not.toEqual([]);
});

test('the unique glossary expansion and unrelated RFC collision preserve authorship and old section URLs', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const glossary = read('docs/glossary.md');
  expect(glossary).toContain('| **LTP** | **Local Trust Protocol**');
  expect(glossary).toContain('| **Vera Trust Stack** |');
  expect(glossary).toContain('| **Verared** |');
  expect(glossary).toContain('| **Witness Index** |');
  expect(glossary).toContain('| **`community attester`** |');
  expect(glossary).toContain('RFC 5326');
  const spec = read('node_modules/@verared/spec/spec/APW-SPEC-v1.3.md');
  expect(spec).toContain('**Author**: Gerardo Loyola');
  expect(spec).toContain('Annex A adapts the Veranet Universal Scoring System, by the same author');
  expect(spec).toContain('id="6-reputation-based-read-governance--loyal-trust-protocol-v12--e-8-e-9"');
  expect(read('src/pages/trust/explicacion-svri.astro')).toContain('Local Trust Protocol');
});
