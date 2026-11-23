import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyToReview } from '../src/review-discussion.ts';
import { githubApi, type Target } from '../src/webhook.ts';

const target: Target = { installation: 1, repository: 'Oddmash/example', repositoryId: 2, number: 3, reply: { root: 4, comment: 5 } };
const base = '/repos/Oddmash/example/pulls/3';
const head = 'a'.repeat(40);
const bot = { id: 7, login: 'oddmash-reviewer[bot]', type: 'Bot' };
const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
const root = { id: 4, node_id: 'comment-4', user: bot, body: '<!-- oddmash-finding:fixture -->\nConsider a pause control.', path: 'src/demo.ts', commit_id: head, pull_request_url: `https://api.github.com${base}` };
const question = { ...root, id: 5, user: actor, in_reply_to_id: 4, body: '@oddmash-reviewer[bot] There is already a pause button. Is this necessary?' };
const pull = { state: 'open', draft: false, head: { sha: head }, base: { sha: 'b'.repeat(40), repo: { full_name: target.repository, id: 2, private: false } } };
const repository = { id: 2, full_name: target.repository, private: false, visibility: 'public', owner: { login: 'Oddmash' } };
const config = { slug: 'oddmash-reviewer', openaiKey: 'fixture', model: 'fixture' };

test('answers a verified maintainer thread once and does not change review state', async () => {
  const comments: (typeof root & { in_reply_to_id?: number })[] = [root, question];
  let modelCalls = 0;
  const reactions: string[] = [];
  const api = githubApi('fixture', async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/repos/Oddmash/example') return Response.json(repository);
    if (path === base) return Response.json(pull);
    if (path === `${base}/comments`) {
      const page = new URL(String(url)).searchParams.get('page');
      return Response.json(page === '1' ? Array.from({ length: 100 }, (_, index) => ({ ...root, id: 100 + index, user: actor })) : comments);
    }
    if (path === `${base}/files`) {
      const page = new URL(String(url)).searchParams.get('page');
      return Response.json(page === '1' ? Array.from({ length: 100 }, (_, index) => ({ filename: `src/other-${index}.ts`, status: 'modified' })) : [{ filename: root.path, status: 'modified', patch: '@@ -0,0 +1 @@\n+const paused = true;' }]);
    }
    if (path === '/repos/Oddmash/example/pulls/comments/5/reactions') {
      reactions.push(JSON.parse(String(init?.body)).content);
      return Response.json({ id: 9 });
    }
    assert.equal(path, `${base}/comments/4/replies`);
    assert.equal(init?.method, 'POST');
    const { body } = JSON.parse(String(init?.body));
    assert.match(body, /oddmash-discussion:5/);
    assert.match(body, /한국어/);
    comments.push({ ...root, id: 6, in_reply_to_id: 4, body });
    return Response.json({ id: 6 });
  });
  const model: typeof fetch = async (_url, init) => {
    modelCalls++;
    assert.match(String(init?.body), /pause button/);
    assert.match(String(init?.body), /const paused = true/);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ verdict: 'agree', english: 'The control is present. My earlier concern is not supported.', korean: '제어 버튼이 있으므로 이전 지적은 근거가 부족합니다.' }) }] }] });
  };
  await replyToReview(api, target, config, model);
  await replyToReview(api, target, config, model);
  assert.equal(modelCalls, 1);
  assert.deepEqual(reactions, ['eyes', '+1']);
});

test('ignores unrelated or unsafe discussions before asking the model', async () => {
  for (const comments of [[{ ...root, user: actor }, question], [root, { ...question, user: { ...actor, id: 9 } }], [root, { ...question, body: '@oddmash-reviewer password: fixture-secret-value' }]]) {
    const api = githubApi('fixture', async url => Response.json(new URL(String(url)).pathname === '/repos/Oddmash/example' ? repository : new URL(String(url)).pathname === base ? pull : comments));
    await replyToReview(api, target, config, async () => { throw new Error('model must not run'); });
  }
});

test('refuses an unapproved private repository or mismatched visibility', async () => {
  const api = githubApi('fixture', async () => Response.json({ ...repository, private: true, visibility: 'private' }));
  const model: typeof fetch = async () => { throw new Error('model must not run'); };
  await replyToReview(api, { ...target, private: true }, config, model);
  await replyToReview(api, target, config, model);
});

test('resolves only the exact bot-owned inline finding after verified current-head correction', async () => {
  const nextHead = 'c'.repeat(40);
  for (const scenario of ['fixed', 'uncertain', 'stale', 'other-author', 'missing-patch', 'invalid-evidence']) {
    const currentPull = { ...pull, head: { sha: nextHead } };
    const followup = { ...question, body: `@oddmash-reviewer Fixed in ${scenario === 'stale' ? head : nextHead}: added the pause control.` };
    const comments = [root, followup];
    const mutations: string[] = [];
    let replies = 0;
    const api = githubApi('fixture', async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/repos/Oddmash/example') return Response.json(repository);
      if (path === base) return Response.json(currentPull);
      if (path === `${base}/comments`) return Response.json(comments);
      if (path === `${base}/files`) return Response.json(scenario === 'missing-patch' ? [] : [{ filename: root.path, status: 'modified', patch: '@@ -0,0 +1 @@\n+const paused = true;' }]);
      if (path.endsWith('/reactions')) return Response.json({ id: 9 });
      if (path === `${base}/comments/4/replies`) {
        replies++;
        const { body } = JSON.parse(String(init?.body));
        if (['stale', 'missing-patch', 'invalid-evidence'].includes(scenario)) {
          assert.match(body, /could not be verified/);
          assert.match(body, /finding remains open/);
          assert.doesNotMatch(body, /The patch adds the missing pause control/);
        }
        return Response.json({ id: 6 });
      }
      assert.equal(path, '/graphql');
      const { query, variables } = JSON.parse(String(init?.body));
      if (query.startsWith('query')) return Response.json({ data: { repository: { pullRequest: { headRefOid: nextHead, baseRefOid: pull.base.sha, reviewThreads: { nodes: [{ id: 'thread-4', isResolved: false, comments: { nodes: [{ id: 'comment-4', author: { login: scenario === 'other-author' ? 'other' : bot.login } }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
      mutations.push(variables.id);
      return Response.json({ data: { resolveReviewThread: { thread: { id: variables.id, isResolved: true } } } });
    });
    const model: typeof fetch = async () => Response.json({ status: 'completed', output_parsed: { verdict: scenario === 'uncertain' ? 'uncertain' : 'fixed', english: 'The patch adds the missing pause control.', korean: '수정 내용에 일시정지 기능이 추가되었습니다.', evidence: scenario === 'invalid-evidence' ? '+unrelated' : '+const paused = true;' } });
    await replyToReview(api, target, config, model);
    assert.deepEqual(mutations, scenario === 'fixed' ? ['thread-4'] : []);
    assert.equal(replies, 1);
  }
});

test('verifies a referenced conversation finding without resolving a thread or starting a PR review', async () => {
  const nextHead = 'c'.repeat(40);
  const issuePath = '/repos/Oddmash/example/issues/3';
  const original = { ...root, issue_url: `https://api.github.com${issuePath}` };
  const followup = { ...question, issue_url: original.issue_url, body: `@oddmash-reviewer Fixed in ${nextHead}: added pause.\nOriginal: https://github.com/Oddmash/example/pull/3#issuecomment-4\nFile: src/demo.ts` };
  const comments = [original, followup];
  let replies = 0;
  const api = githubApi('fixture', async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/repos/Oddmash/example') return Response.json(repository);
    if (path === base) return Response.json({ ...pull, head: { sha: nextHead } });
    if (path === `${base}/files`) return Response.json([{ filename: root.path, status: 'modified', patch: '@@ -0,0 +1 @@\n+const paused = true;' }]);
    if (path.endsWith('/reactions')) return Response.json({ id: 9 });
    assert.equal(path, `${issuePath}/comments`);
    if (init?.method === 'POST') {
      replies++;
      const { body } = JSON.parse(String(init.body));
      assert.match(body, /#issuecomment-4/);
      return Response.json({ id: 6 });
    }
    return Response.json(comments);
  });
  const model: typeof fetch = async () => Response.json({ status: 'completed', output_parsed: { verdict: 'fixed', english: 'The pause control was added.', korean: '일시정지 기능이 추가되었습니다.', evidence: '+const paused = true;' } });
  await replyToReview(api, { ...target, reply: { root: 4, comment: 5, kind: 'conversation', rootKind: 'issue', path: root.path } }, config, model);
  assert.equal(replies, 1);
});
