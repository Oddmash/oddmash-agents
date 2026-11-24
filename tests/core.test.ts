import test from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, selectFiles, safeText, guidancePaths, validateFindings, formatReport, formatReviewBody, inlineComment, reviewMarker, reviewDecision, reviewFollowUp, reviewOutcome, checksPassed, type ReviewContext, type Finding } from '../src/core.ts';

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
  assert.equal(reviewDecision(context, [finding as Finding], true), 'COMMENT');
  const proven = { ...finding, blockingEvidence: { excerpt: 'new', impact: 'The control cannot be named.', requirement: 'A button requires an accessible name.' } } as Finding;
  assert.equal(reviewDecision(context, [proven], true), 'REQUEST_CHANGES');
  assert.equal(reviewDecision(context, [{ ...proven, blockingEvidence: { ...proven.blockingEvidence!, excerpt: 'not in diff' } }], true), 'COMMENT');
  assert.equal(reviewDecision(context, [{ ...proven, confidence: 'medium' }], true), 'COMMENT');
  assert.match(inlineComment(context, proven), /BLOCKING/);
  assert.match(inlineComment(context, finding as Finding), /ADVISORY/);
  assert.equal(reviewDecision(context, [{ ...finding, severity: 'low' } as Finding], true), 'COMMENT');
});

test('separates advisory findings, coverage gaps and approval without weakening review gates', () => {
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: [file], omitted: [], guidance: {}, checks: [{ name: 'CI', status: 'completed', conclusion: 'success' }] };
  const advisory = finding as Finding;
  const followUp = reviewFollowUp(context, [advisory], true);
  assert.equal(reviewDecision(context, [advisory], true), 'COMMENT');
  assert.equal(reviewOutcome('COMMENT', followUp).label, 'review: follow-up');
  const body = formatReviewBody('COMMENT', '<!-- marker -->', formatReport(context, [advisory]), undefined, followUp);
  assert.match(body, /Advisory findings: investigate/);
  assert.doesNotMatch(body, /Maintainer review required/);
  assert.match(body, /Consider:/);
  const incomplete = reviewFollowUp({ ...context, omitted: ['image'] }, [advisory], true);
  assert.equal(reviewOutcome('COMMENT', incomplete).label, 'review: needs human');
  assert.match(formatReviewBody('COMMENT', 'marker', 'report', undefined, incomplete), /Manual coverage check required/);
  assert.equal(reviewOutcome('COMMENT', reviewFollowUp(context, [], false)).label, 'review: needs human');
  assert.equal(reviewOutcome('COMMENT', reviewFollowUp(context, [], true)).title, 'Review approval pending checks');
  assert.equal(reviewOutcome('REQUEST_CHANGES', incomplete).label, 'review: changes requested');
  assert.equal(reviewOutcome('APPROVE', followUp).label, 'review: approved');
});

test('inline-first reporting preserves code and does not repeat confirmed inline findings', () => {
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: [file], omitted: ['asset'], guidance: {}, checks: [] };
  const example = { ...finding, evidence: 'Use `items.some(x => x > 0)` and `count < 2`.', verification: 'Run the empty-array test.' } as Finding;
  const inline = inlineComment(context, example);
  assert.match(inline, /x => x > 0/);
  assert.match(inline, /count < 2/);
  assert.match(inline, /Verify: Run the empty-array test/);
  const summary = formatReport(context, [example], true, [], true);
  assert.match(summary, /0 blocking, 1 advisory/);
  assert.doesNotMatch(summary, /items\.some|Run the empty-array test/);
  assert.match(summary, /Manual review coverage/);
  assert.match(formatReport(context, [example]), /items\.some/);
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
  assert.doesNotMatch(inlineComment(context, example), /[\u2013\u2014\u2015]/);
  const approved = formatReviewBody('APPROVE', '<!-- marker -->', report);
  assert.match(approved, /@qtaghdi/);
  assert.equal(formatReviewBody('APPROVE', '<!-- marker -->', report, { id: 135234546, login: 'qtaghdi' }), '<!-- marker -->\nApproved.');
  assert.match(formatReviewBody('APPROVE', '<!-- marker -->', report, { id: 99, login: 'contributor' }), /@qtaghdi/);
  assert.doesNotMatch(approved, /Label|CI|Findings/);
  assert.match(formatReviewBody('REQUEST_CHANGES', '<!-- marker -->', report), /Please address/);
});

test('manual review identifies omitted public files, reasons, and verification actions without exposing protected details', () => {
  const selected = selectFiles([
    file,
    { filename: 'docs/assets/demo.png', status: 'modified' },
    { filename: 'docs/assets/demo-dark.jpg', status: 'modified' },
    { filename: 'src/renamed.ts', status: 'renamed' },
    { ...file, filename: 'src/incomplete.ts', additions: 100 },
    { filename: 'secrets/fixture-secret.pem', status: 'added', patch: '+fixture' },
    { ...file, filename: 'src/fixture-sensitive.ts', patch: '@@ -1 +1 @@\n-old\n+password: synthetic-fixture-value' }
  ]);
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: selected.files, omitted: selected.omitted, guidance: {}, checks: [] };
  const report = formatReport(context, [], true, selected.omissionDetails);
  assert.match(report, /`docs\/assets\/demo.png`, `docs\/assets\/demo-dark.jpg`: Image has no text diff/);
  assert.match(report, /compare before\/after captures/);
  assert.match(report, /`src\/renamed.ts`: GitHub did not provide a text diff/);
  assert.match(report, /`src\/incomplete.ts`: GitHub diff is incomplete/);
  assert.match(report, /Protected path excluded/);
  assert.match(report, /Potentially sensitive content excluded/);
  assert.match(report, /수동 검토 범위/);
  assert.match(report, /이전·이후 캡처의 레이아웃/);
  assert.doesNotMatch(report, /fixture-secret|fixture-sensitive|synthetic-fixture-value/);
  assert.equal(reviewDecision(context, [], true), 'COMMENT');
  const privateSelection = selectFiles([{ filename: 'docs/assets/private-fixture.png', status: 'modified' }, { ...file, filename: 'config/private-fixture.ts' }], 45_000, true);
  assert.ok(privateSelection.omissionDetails.every(item => !item.path));
  const privateReport = formatReport({ ...context, files: [], omitted: privateSelection.omitted }, [], true, privateSelection.omissionDetails);
  assert.doesNotMatch(privateReport, /private-fixture/);
  assert.match(privateReport, /inspect the complete diff/i);
});

test('manual review summarizes bounded file counts and explains coverage limits', () => {
  const budget = selectFiles([file], 0);
  assert.equal(budget.omissionDetails[0].reason, 'budget');
  const many = selectFiles(Array.from({ length: 55 }, (_, index) => ({ ...file, filename: `src/file-${index}.ts` })));
  assert.equal(many.files.length, 40);
  assert.equal(many.omissionDetails.length, 15);
  assert.ok(many.omissionDetails.every(item => item.reason === 'file-limit'));
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: many.files, omitted: many.omitted, guidance: {}, checks: [] };
  const report = formatReport(context, [], true, [...many.omissionDetails, { reason: 'pagination', count: 5 }]);
  assert.match(report, /`src\/file-51.ts` \(3 unlisted\): Review file limit reached/);
  assert.doesNotMatch(report, /src\/file-52.ts/);
  assert.match(report, /\(5 unlisted\): Files beyond the fetched page/);
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


test('distinguishes unavailable generated lockfile diffs without changing review coverage requirements', () => {
  const selected = selectFiles([{ filename: 'pnpm-lock.yaml', status: 'modified' }, { filename: 'package-lock.json', status: 'removed' }, { filename: 'src/unknown.ts', status: 'modified' }], 45000, true);
  assert.deepEqual(selected.omissionDetails.map(item => item.reason), ['lockfile', 'lockfile', 'missing-patch']);
  assert.ok(selected.omissionDetails.every(item => !item.path));
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: selected.files, omitted: selected.omitted, guidance: {}, checks: [] };
  const report = formatReport(context, [], true, selected.omissionDetails);
  assert.match(report, /Generated dependency lockfile/);
  assert.match(report, /passing CI alone does not establish full diff coverage/);
  assert.doesNotMatch(report, /pnpm-lock|package-lock|src\/unknown/);
  assert.equal(reviewDecision(context, [], true), 'COMMENT');
});
