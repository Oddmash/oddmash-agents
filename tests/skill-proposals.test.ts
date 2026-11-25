import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProposalArgs, proposeSkillImprovement } from '../src/skill-proposals.ts';

const examples = ['Oddmash/juliya#17', 'Oddmash/oddmash-ui#25'];
const category = 'ui-feedback';
const title = 'Skill proposal: oddmash-ux-design (ui-feedback)';
const marker = '<!-- oddmash-skill-proposal:oddmash-ux-design:ui-feedback -->';
const evidenceMarker = '<!-- oddmash-skill-evidence:ui-feedback -->';
const catalog = '/repos/Oddmash/oddmash-skills';

function fixture(options: { issues?: unknown[]; comments?: unknown[]; privateRepo?: boolean; unmerged?: boolean; repeatingPage?: boolean } = {}) {
  const writes: { path: string; body?: object }[] = [];
  const request = async <T>(path: string, method?: 'GET' | 'POST', body?: object): Promise<T> => {
    if (method === 'POST') {
      writes.push({ path, body });
      return { number: 101 } as T;
    }
    if (path.startsWith(`${catalog}/issues?`)) return (options.repeatingPage ? Array.from({ length: 100 }, () => ({ number: 1, title: 'Unrelated' })) : options.issues ?? []) as T;
    if (path.includes('/comments?')) return (options.comments ?? []) as T;
    const pull = /\/pulls\/(\d+)$/.exec(path);
    if (pull) return { number: Number(pull[1]), state: 'closed', merged_at: options.unmerged ? null : '2026-11-24', base: { repo: { id: 123 } } } as T;
    return { id: 123, full_name: path.slice('/repos/'.length), private: options.privateRepo ?? false, archived: false } as T;
  };
  return { writes, request };
}

test('restricts input to distinct product PR references and approved quality categories', () => {
  for (const args of [
    ['security', ...examples],
    [category, examples[0]],
    [category, examples[0], 'oddmash/JULIYA#17'],
    [category, examples[0], 'External/product#22'],
    [category, examples[0], 'Oddmash/oddmash-agents#22'],
    [category, examples[0], 'Oddmash/product#0'],
    [category, ...examples, '--publish']
  ]) assert.throws(() => parseProposalArgs(args));
  assert.deepEqual(parseProposalArgs([category, ...examples]).evidence.map(value => value.number), [17, 25]);
});

test('preview includes only controlled text and canonical public references; publication needs confirmation', async () => {
  const { writes, request } = fixture();
  const preview = await proposeSkillImprovement(request, [category, ...examples]);
  assert.equal(preview.action, 'create-preview');
  assert.equal(preview.title, title);
  assert.match(preview.body ?? '', /https:\/\/github\.com\/Oddmash\/juliya\/pull\/17/);
  assert.equal(writes.length, 0);
  assert.deepEqual(await proposeSkillImprovement(request, [category, ...examples, '--confirm-gap', '--publish']), { action: 'created', number: 101 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, `${catalog}/issues`);
});

test('private or unmerged evidence cannot publish', async () => {
  for (const options of [{ privateRepo: true }, { unmerged: true }]) {
    const { request, writes } = fixture(options);
    await assert.rejects(proposeSkillImprovement(request, [category, ...examples, '--confirm-gap', '--publish']));
    assert.equal(writes.length, 0);
  }
});

test('appends new evidence only once and leaves closed issues unchanged', async () => {
  const existing = { number: 99, title, body: `${marker}\n- https://github.com/Oddmash/juliya/pull/17`, state: 'open' };
  const first = fixture({ issues: [existing] });
  assert.deepEqual(await proposeSkillImprovement(first.request, [category, ...examples, '--confirm-gap', '--publish']), { action: 'appended', number: 99 });
  assert.deepEqual(first.writes, [{ path: `${catalog}/issues/99/comments`, body: { body: `${evidenceMarker}\n\nAdditional verified examples for the same guidance gap:\n\n- https://github.com/Oddmash/oddmash-ui/pull/25` } }]);
  const duplicate = fixture({ issues: [existing], comments: [{ body: `${evidenceMarker}\n- https://github.com/Oddmash/oddmash-ui/pull/25`, author_association: 'MEMBER' }] });
  assert.deepEqual(await proposeSkillImprovement(duplicate.request, [category, ...examples, '--confirm-gap', '--publish']), { action: 'duplicate', number: 99 });
  assert.equal(duplicate.writes.length, 0);
  const closed = fixture({ issues: [{ ...existing, state: 'closed' }] });
  assert.deepEqual(await proposeSkillImprovement(closed.request, [category, ...examples, '--confirm-gap', '--publish']), { action: 'closed-existing', number: 99 });
  assert.equal(closed.writes.length, 0);
});

test('ambiguous or incomplete catalog lookup fails closed', async () => {
  for (const options of [{ issues: [{ number: 99, title, body: 'No valid proposal marker', state: 'open' }] }, { repeatingPage: true }]) {
    const { request, writes } = fixture(options);
    await assert.rejects(proposeSkillImprovement(request, [category, ...examples, '--confirm-gap', '--publish']));
    assert.equal(writes.length, 0);
  }
});
