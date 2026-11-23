import test from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, selectFiles, safeText, guidancePaths, validateFindings, formatReport, reviewMarker } from '../src/core.ts';

const file = { filename: 'src/ui/button.tsx', status: 'modified', patch: '@@ -1,2 +1,3 @@\n const label = "Open";\n-old\n+new\n+other' };
const finding = { path: file.filename, line: 2, severity: 'medium', confidence: 'high', rule: 'Accessibility', evidence: 'The label is absent.', recommendation: 'Provide a visible label.', verification: 'Inspect the accessible name.' };

test('tracks added lines and nested guidance', () => {
  assert.deepEqual([...addedLines(file.patch)], [2, 3]);
  assert.deepEqual(guidancePaths([file]), ['AGENTS.md', 'src/AGENTS.md', 'src/ui/AGENTS.md']);
});

test('omits sensitive and oversized files', () => {
  const result = selectFiles([file, { filename: '.env', status: 'added', patch: '+fixture' }, { filename: 'large.txt', status: 'added', patch: 'x'.repeat(1000) }], 500);
  assert.deepEqual(result.files, [file]);
  assert.deepEqual(result.omitted, ['.env', 'large.txt']);
  assert.equal(safeText('password: synthetic-fixture-value'), '[REDACTED]');
});

test('validates references and deduplicates findings', () => {
  assert.deepEqual(validateFindings([finding, finding, { ...finding, line: 1 }, { ...finding, path: 'unknown' }, { ...finding, severity: 'invalid' }], [file]), [finding]);
});

test('allows bounded UI suggestions and drops unchanged or unsafe replacements', () => {
  assert.equal(validateFindings([{ ...finding, suggestion: 'replacement' }], [file])[0].suggestion, 'replacement');
  assert.equal(validateFindings([{ ...finding, suggestion: 'new' }], [file])[0].suggestion, undefined);
  assert.equal(validateFindings([{ ...finding, suggestion: '```bad' }], [file])[0].suggestion, undefined);
  assert.equal(validateFindings([{ ...finding, rule: 'Security', suggestion: 'replacement' }], [file])[0].suggestion, undefined);
});

test('formats non-blocking reports with stable markers', () => {
  const context = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: [file], omitted: [], guidance: {}, checks: [] };
  const report = formatReport(context, []);
  assert.match(report, /not an approval/);
  assert.ok(report.startsWith(reviewMarker(context)));
  assert.notEqual(reviewMarker(context), reviewMarker({ ...context, head: 'b'.repeat(40) }));
});
