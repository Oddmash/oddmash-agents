import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateAdvisoryFindings } from '../src/finding-consolidation.ts';
import { inlineComment, formatReport, reviewDecision, type Finding, type ReviewContext } from '../src/core.ts';

const example = 'import { mountLegacy } from "https://example.test/pkg";';
const files = ['README.md', 'docs/guide.md', 'site/examples.tsx'].map((filename, index) => ({
  filename, status: 'modified', patch: '@@ -1 +1 @@\n-old\n+' + (index === 2 ? 'const sample = `' + example + '`;' : example)
}));
const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files, omitted: [], guidance: {}, checks: [{ name: 'CI', status: 'completed', conclusion: 'success' }] };
const findings: Finding[] = files.map(file => ({
  path: file.filename, line: 1, severity: 'medium', confidence: 'high',
  rule: 'Verify the public API example import',
  evidence: 'The standalone example uses a public export that requires verification.',
  recommendation: 'Verify the public export in the published package.',
  verification: 'Check the example against the published package.'
}));

test('groups repeated cross-file advice with every location retained', () => {
  const grouped = consolidateAdvisoryFindings(context, findings);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].relatedLocations, files.slice(1).map(file => ({ path: file.filename, line: 1 })));
  assert.equal(findings[0].relatedLocations, undefined);
  const comment = inlineComment(context, grouped[0]);
  assert.match(comment, /oddmash-grouped-finding/);
  assert.match(comment, /docs\/guide.md/);
  assert.match(comment, /site\/examples.tsx/);
  assert.match(formatReport(context, grouped), /docs\/guide.md/);
  assert.equal(reviewDecision(context, grouped, true), 'COMMENT');
});

test('does not consolidate blockers, suggestions or distinct source evidence', () => {
  for (const changed of [
    { ...findings[1], suggestion: 'replacement' },
    { ...findings[1], side: 'LEFT' as const },
    { ...findings[1], blockingEvidence: { excerpt: example, impact: 'Example fails.', requirement: 'Example must run.' } }
  ]) {
    assert.equal(consolidateAdvisoryFindings(context, [findings[0], changed]).length, 2);
  }
  const distinct = { ...context, files: [files[0], { ...files[1], patch: files[1].patch.replace('mountLegacy', 'mountOther') }] };
  assert.equal(consolidateAdvisoryFindings(distinct, findings.slice(0, 2)).length, 2);
  assert.equal(consolidateAdvisoryFindings(context, [findings[0], { ...findings[0] }]).length, 2);
});
