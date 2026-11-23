import test from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, selectFiles, safeText, guidancePaths, validateFindings, formatReport, formatReviewBody, inlineComment, reviewMarker, reviewDecision, checksPassed, type ReviewContext, type Finding } from '../src/core.ts';

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
  assert.deepEqual(selectFiles([{ ...file, additions: 100, deletions: 1 }]).omitted, [file.filename]);
  assert.equal(selectFiles([{ ...file, patch: `--- a/file\n+++ b/file\n${file.patch}`, additions: 2, deletions: 1 }]).files.length, 1);
  assert.deepEqual(selectFiles([{ ...file, patch: '@@ -1 +1,2 @@\n-old\n+new', additions: 1, deletions: 1 }]).omitted, [file.filename]);
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
  assert.match(formatReport(context, [], false), /could not be validated against the changed lines/);
});

test('formal outcomes fail closed without complete passing checks and validated coverage', () => {
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: [file], omitted: [], guidance: {}, checks: [{ name: 'CI', status: 'completed', conclusion: 'success' }] };
  assert.equal(reviewDecision(context, [], true), 'APPROVE');
  assert.equal(reviewDecision({ ...context, checks: [] }, [], true), 'COMMENT');
  assert.equal(reviewDecision({ ...context, omitted: ['large'] }, [], true), 'COMMENT');
  assert.equal(reviewDecision(context, [], false), 'COMMENT');
  assert.equal(reviewDecision(context, [finding as Finding], true), 'REQUEST_CHANGES');
  assert.equal(reviewDecision(context, [{ ...finding, severity: 'low' } as Finding], true), 'COMMENT');
});

test('skipped conditional jobs require a passing aggregate verify check', () => {
  const skipped = { name: 'quality', status: 'completed', conclusion: 'skipped' };
  const verify = { name: 'verify', status: 'completed', conclusion: 'success' };
  assert.equal(checksPassed([skipped, verify]), true);
  assert.equal(checksPassed([skipped]), false);
  assert.equal(checksPassed([skipped, { ...verify, conclusion: 'failure' }]), false);
});

test('review output is concise without CI summaries or typographic dashes', () => {
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: [file], omitted: [], guidance: {}, checks: [{ name: 'CI', status: 'completed', conclusion: 'success' }] };
  const example = { ...finding, rule: 'Label — accessibility', evidence: 'Missing — label' } as Finding;
  const report = formatReport(context, [example]);
  assert.doesNotMatch(report, /CI evidence|CI: success|[\u2013\u2014\u2015]/);
  assert.doesNotMatch(inlineComment(context, example), /[\u2013\u2014\u2015]|Verify:/);
  const approved = formatReviewBody('APPROVE', '<!-- marker -->', report);
  assert.match(approved, /@qtaghdi/);
  assert.equal(formatReviewBody('APPROVE', '<!-- marker -->', report, { id: 135234546, login: 'qtaghdi' }), '<!-- marker -->\nApproved.');
  assert.match(formatReviewBody('APPROVE', '<!-- marker -->', report, { id: 99, login: 'contributor' }), /@qtaghdi/);
  assert.doesNotMatch(approved, /Label|CI|Findings/);
  assert.match(formatReviewBody('REQUEST_CHANGES', '<!-- marker -->', report), /Please address/);
});

test('renders English first and Korean translation in a collapsed section', () => {
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: [file], omitted: [], guidance: {}, checks: [] };
  const bilingual = { ...finding, korean: { rule: '접근성', evidence: '레이블이 없습니다.', recommendation: '레이블을 추가하세요.', verification: '접근 가능한 이름을 확인하세요.' } };
  const valid = validateFindings([bilingual], [file])[0];
  assert.deepEqual(valid.korean, bilingual.korean);
  for (const output of [inlineComment(context, valid), formatReport(context, [valid])]) {
    assert.ok(output.indexOf('Accessibility') < output.indexOf('<details>'));
    assert.match(output, /<summary>한국어 \(Korean\)<\/summary>/);
    assert.match(output, /레이블을 추가하세요/);
    assert.match(output, /<\/details>/);
    assert.doesNotMatch(output, /<details open/);
  }
  assert.doesNotMatch(formatReviewBody('APPROVE', '<!-- marker -->', formatReport(context, [valid])), /<details>/);
  assert.equal(validateFindings([{ ...bilingual, korean: { ...bilingual.korean, evidence: 'password: synthetic-fixture-value' } }], [file])[0].korean, undefined);
});
