import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewFeedback } from '../apps/worker/src/review-feedback.ts';
import { relatedPaths, reviewFocus } from '../apps/worker/src/review-context.ts';
import { deletedLines, validateFindings, reviewAssessment } from '../apps/worker/src/core.ts';
import { deferredRequest } from '../apps/worker/src/webhook-review.ts';
import { createHash } from 'node:crypto';

test('bounded relative imports exclude sensitive paths and changed files', () => {
  const files = [{ filename: 'src/ui.ts', status: 'modified', patch: '+import { a } from "./helper";\n+import { b } from "./auth";\n+import { c } from "../../outside";\n+import { d } from "./changed.ts";' }, { filename: 'src/changed.ts', status: 'modified' }];
  assert.deepEqual(relatedPaths(files), ['src/helper.ts', 'src/helper.tsx', 'src/helper/index.ts']);
  assert.match(reviewFocus('Oddmash/juliya').join(' '), /Unicode/);
});

test('deleted code findings are advisory and cannot suggest code replacements', () => {
  const files = [{ filename: 'src/ui.ts', status: 'modified', patch: '@@ -4,2 +4,1 @@\n-old line\n keep' }];
  assert.deepEqual([...deletedLines(files[0].patch)], [4]);
  const candidate = { path: 'src/ui.ts', side: 'LEFT', line: 4, severity: 'high', confidence: 'high', rule: 'Missing behavior', evidence: 'A behavior was removed.', recommendation: 'Verify the requirement.', verification: 'Check behavior.', suggestion: 'restore', blockingEvidence: { excerpt: 'old line', impact: 'Regression', requirement: 'Contract' } };
  const findings = validateFindings([candidate, { ...candidate, line: 5 }], files);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].side, 'LEFT');
  assert.equal(findings[0].suggestion, undefined);
  assert.equal(findings[0].blockingEvidence, undefined);
  assert.equal(reviewAssessment({ repository: 'Oddmash/example', number: 1, head: 'a'.repeat(40), title: '', files, guidance: {}, checks: [], omitted: [] }, findings, true), 'COMMENT');
});

test('deferred requests resume only on the same head and never repeat a recorded review', () => {
  const head = 'a'.repeat(40), bot = 'oddmash-reviewer[bot]';
  const comment = { body: `<!-- oddmash-deferred:${head}:inline:17:9 -->`, user: { login: bot } };
  assert.deepEqual(deferredRequest([comment], [], bot, head), { kind: 'inline', id: 17, root: 9 });
  assert.equal(deferredRequest([comment], [], bot, 'b'.repeat(40)), undefined);
  assert.equal(deferredRequest([{ ...comment, user: { login: 'human' } }], [], bot, head), undefined);
  const tag = createHash('sha256').update('comment-17').digest('hex').slice(0, 24);
  assert.equal(deferredRequest([comment], [{ id: 1, user: { login: bot }, state: 'COMMENTED', commit_id: head, body: `<!-- oddmash-recheck:${tag} -->` }], bot, head), undefined);
});


test('product-specific guidance and reviewed feedback cover distinct product contracts', () => {
  assert.match(reviewFocus('Oddmash/oddmash-website').join(' '), /Localization/);
  assert.match(reviewFocus('Oddmash/boundra').join(' '), /cross-platform CLI/);
  assert.match(reviewFocus('Oddmash/Vertactics').join(' '), /map coordinate/);
  assert.match(reviewFocus('Oddmash/oddmash-agents').join(' '), /idempotent publication/);
  assert.ok(reviewFeedback.some(rule => rule.includes('some returns false for an empty array')));
  assert.equal([].some(() => true), false);
});

test('product profiles remain specific and unrecognized products use the common baseline', () => {
  const fallback = reviewFocus('Oddmash/unrecognized');
  assert.deepEqual(fallback, ['Correctness, regression, error handling and test coverage']);
  assert.deepEqual(reviewFocus('Oddmash/kowrap'), fallback);
  assert.match(reviewFocus('Oddmash/oddmash-ui').join(' '), /Keyboard interaction/);
  assert.match(reviewFocus('Oddmash/interaction-inspector').join(' '), /Event lifecycle/);
  assert.doesNotMatch(reviewFocus('Oddmash/juliya').join(' '), /map coordinate/);
  assert.doesNotMatch(reviewFocus('Oddmash/boundra').join(' '), /design tokens/);
});
