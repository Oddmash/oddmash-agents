import test from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, selectFiles, safeText, guidancePaths, validateFindings, formatReport, formatReviewBody, publicationFollowUp, inlineComment, reviewMarker, reviewDecision, reviewFollowUp, reviewOutcome, checksPassed, type ReviewContext, type Finding } from '../apps/worker/src/core.ts';

const file = { filename: 'src/ui/button.tsx', status: 'modified', patch: '@@ -1,2 +1,3 @@\n const label = "Open";\n-old\n+new\n+other' };
const finding = { path: file.filename, line: 2, severity: 'medium', confidence: 'high', rule: 'Accessibility', evidence: 'The label is absent.', recommendation: 'Provide a visible label.', verification: 'Inspect the accessible name.' };

test('tracks added lines and nested guidance', () => {
  assert.deepEqual([...addedLines(file.patch)], [2, 3]);
  assert.deepEqual(guidancePaths([file]), ['AGENTS.md', 'src/AGENTS.md', 'src/ui/AGENTS.md']);
});

test('omits sensitive and oversized files', () => {
  const result = selectFiles([file, { filename: '.env', status: 'added', patch: '+fixture' }, { filename: 'large.txt', status: 'added', patch: 'x'.repeat(1000) }], 500);
  assert.deepEqual(result.files, [file]);
  assert.deepEqual(result.omitted, ['Omitted protected file', 'large.txt']);
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
  assert.match(report, /No validated findings in 1 reviewed file\./);
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
  assert.match(body, /Advisory review complete/);
  assert.match(body, /Advisory findings are optional/);
  assert.match(body, /defer to a separate issue/);
  assert.match(body, /repeated review is not required solely/);
  assert.match(body, /참고 의견 처리/);
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
  assert.match(report, /No validated findings in 1 reviewed file\./);
  assert.match(report, /검토한 파일 1개에서 확인된 문제는 없습니다\./);
  assert.doesNotMatch(report, /proof of correctness|정확성을 보장/);
  assert.match(report, /`src\/renamed.ts`: GitHub did not provide a text diff/);
  assert.match(report, /`src\/incomplete.ts`: GitHub diff is incomplete/);
  assert.match(report, /Confidential path/);
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
  assert.match(privateReport, /0 eligible files/);
  assert.match(privateReport, /Path requires local review/);
  assert.doesNotMatch(privateReport, /No validated findings|확인된 문제는 없습니다/);
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


test('quality review selects ordinary manifests and auth source independently of strict private coverage', () => {
  const paths = ['.github/workflows/ci.yml', '.github/workflows/prepare-release.yml', 'vercel.json', 'tsconfig.json', 'next.config.ts', 'Dockerfile', 'src/auth/session.ts', 'src/authorization/permissions.ts'];
  const changes = paths.map(filename => ({ ...file, filename }));
  for (const visibility of [false, true]) {
    const selection = selectFiles(changes, 45_000, visibility, 'quality');
    assert.deepEqual(selection.files.map(item => item.filename), paths);
    assert.deepEqual(selection.omitted, []);
  }
  assert.equal(selectFiles(changes, 45_000, true, 'strict').files.some(item => item.filename === '.github/workflows/ci.yml'), false);
  assert.equal(selectFiles(changes, 45_000, true, 'strict').files.some(item => item.filename === 'src/auth/session.ts'), false);
});

test('private quality review includes webhook review code and tests while protecting credentials and rename origins', () => {
  const paths = ['src/webhook-review.ts', 'tests/webhook-review.test.ts'];
  const changes = paths.map(filename => ({ ...file, filename }));
  assert.deepEqual(selectFiles(changes, 45_000, true, 'quality').files.map(item => item.filename), paths);
  assert.equal(selectFiles(changes, 45_000, true, 'strict').files.length, 0);
  const restricted = selectFiles([
    { ...changes[0], patch: '@@ -1 +1 @@\n-old\n+const token = "synthetic-fixture-value";' },
    { ...changes[1], previous_filename: '.aws/credentials' },
  ], 45_000, true, 'quality');
  assert.deepEqual(restricted.omissionDetails, [{ reason: 'sensitive', path: paths[0] }, { reason: 'protected' }]);
  assert.doesNotMatch(JSON.stringify(restricted), /synthetic-fixture-value|\.aws/);
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Example', files: restricted.files, omitted: restricted.omitted, guidance: {}, checks: [] };
  const report = formatReport(context, [], true, restricted.omissionDetails);
  assert.match(report, /Confidential path[.] Inspect the change locally/);
  assert.match(report, /민감 경로입니다[.]/);
  assert.doesNotMatch(report, /정책|보안 문제가 확인/);
});

test('quality review hides confidential names, rename origins and credential-like content', () => {
  const changes = [
    { ...file, filename: '.env.local' },
    { ...file, filename: 'src/auth/secrets/session.ts' },
    { ...file, filename: '.github/workflows/ci.yml', previous_filename: '.aws/credentials' },
    { ...file, filename: 'vercel.json', patch: '@@ -1 +1 @@\n-old\n+password: synthetic-fixture-value' },
  ];
  for (const visibility of [false, true]) {
    const selection = selectFiles(changes, 45_000, visibility, 'quality');
    assert.equal(selection.files.length, 0);
    assert.deepEqual(selection.omissionDetails.map(item => item.reason), ['protected', 'protected', 'protected', 'sensitive']);
    assert.deepEqual(selection.omissionDetails.flatMap(item => item.path ? [item.path] : []), visibility ? ['vercel.json'] : []);
    assert.doesNotMatch(JSON.stringify(selection), /env.local|aws\/credentials|synthetic-fixture-value|session.ts/);
  }
  const privateSelection = selectFiles([{ ...file, filename: 'config/internal.ts' }], 45_000, true, 'quality');
  assert.deepEqual(privateSelection.omissionDetails, [{ reason: 'private-policy', path: 'config/internal.ts' }]);
});

test('private quality recognizes standalone environment lookups and excludes literal values', () => {
  const patch = (line: string) => '@@ -1 +1 @@\n-old\n+' + line;
  const script = { ...file, filename: 'scripts/prepare-release.mjs', patch: patch('const token = process.env.GITHUB_TOKEN;') };
  const reference = selectFiles([script], 45_000, true, 'quality');
  assert.equal(reference.files[0]?.patch, script.patch);
  assert.equal(selectFiles([script], 45_000, true, 'strict').omissionDetails[0]?.reason, 'sensitive');
  for (const line of ["const token = 'synthetic-fixture-value';", "const token = process.env.GITHUB_TOKEN || 'synthetic-fixture-value';", 'const token = process.env.GITHUB_TOKEN; // password: synthetic-fixture-value']) {
    assert.deepEqual(selectFiles([{ ...script, patch: patch(line) }], 45_000, true, 'quality').omissionDetails, [{ reason: 'sensitive', path: script.filename }]);
  }
});

test('needs human explains the exact reason and directs maintainers to verification tabs', () => {
  const coverage = formatReviewBody('COMMENT', 'marker', 'report', undefined, { advisory: false, incompleteCoverage: true, invalidEvidence: false });
  assert.match(coverage, /review: needs human/);
  assert.match(coverage, /Manual review coverage/);
  assert.match(coverage, /Files changed/);
  assert.match(coverage, /confidential changes locally/);
  assert.match(coverage, /수동 검토 필요 사유 및 확인 위치/);
  const invalid = formatReviewBody('COMMENT', 'marker', 'report', undefined, { advisory: false, incompleteCoverage: false, invalidEvidence: true });
  assert.match(invalid, /Review evidence incomplete/);
  assert.match(invalid, /Conversation/);
  assert.match(invalid, /Checks/);
  assert.doesNotMatch(invalid, /Manual review coverage/);
});

test('maintainer findings preserve manual disposition and never imply approval', () => {
  const owner = { id: 135234546, login: 'qtaghdi' };
  const followUp = { advisory: false, incompleteCoverage: false, invalidEvidence: false };
  const published = publicationFollowUp(followUp, 'REQUEST_CHANGES', owner);
  assert.equal(reviewOutcome('COMMENT', published).label, 'review: needs human');
  const body = formatReviewBody('COMMENT', '<!-- marker -->', 'Actionable finding', owner, published);
  assert.match(body, /Actionable findings remain/);
  assert.match(body, /No approval was issued/);
  assert.match(body, /automatic merge is not available/);
  assert.match(body, /Actionable finding/);
  assert.deepEqual(publicationFollowUp(followUp, 'REQUEST_CHANGES', { ...owner, id: 1 }), followUp);
  assert.deepEqual(publicationFollowUp(followUp, 'APPROVE', owner), followUp);
});

test('confirmed full empty review is neutral without coverage or evidence warnings and never approval', () => {
  const context: ReviewContext = { repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: 'Synchronization', files: [], omitted: [], guidance: {}, checks: [{ name: 'CI', status: 'completed', conclusion: 'success' }], confirmedEmpty: true };
  const followUp = reviewFollowUp(context, [], false);
  assert.deepEqual(followUp, { advisory: false, incompleteCoverage: false, invalidEvidence: false, confirmedEmpty: true });
  assert.equal(reviewDecision(context, [], false), 'COMMENT');
  assert.equal(reviewDecision(context, [], true), 'COMMENT');
  assert.deepEqual(reviewOutcome('COMMENT', followUp), { label: 'review: follow-up', title: 'No changed files' });
  const body = formatReviewBody('COMMENT', 'marker', formatReport(context, [], false), undefined, followUp);
  assert.match(body, /No changed files \(neutral review\)/);
  assert.match(body, /GitHub confirms zero changed files/);
  assert.match(body, /변경 파일이 0개임을 확인/);
  assert.match(body, /no approval or automatic merge authorization/);
  assert.doesNotMatch(body, /Manual review coverage|Maintainer review required|Review evidence incomplete|Approval pending/);
  for (const uncertain of [{ ...context, confirmedEmpty: undefined }, { ...context, omitted: ['Unknown'] }]) {
    assert.equal(reviewOutcome('COMMENT', reviewFollowUp(uncertain, [], false)).label, 'review: needs human');
    assert.match(formatReport(uncertain, [], false), /0 eligible files/);
  }
});
