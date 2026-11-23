import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyToReview } from '../src/review-discussion.ts';
import { githubApi, type Target } from '../src/webhook.ts';

const target: Target = { installation: 1, repository: 'Oddmash/example', repositoryId: 2, number: 3, reply: { root: 4, comment: 5 } };
const base = '/repos/Oddmash/example/pulls/3';
const head = 'a'.repeat(40);
const bot = { id: 7, login: 'oddmash-reviewer[bot]', type: 'Bot' };
const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
const root = { id: 4, user: bot, body: '<!-- oddmash-finding:fixture -->\nConsider a pause control.', path: 'src/demo.ts', commit_id: head, pull_request_url: `https://api.github.com${base}` };
const question = { ...root, id: 5, user: actor, in_reply_to_id: 4, body: '@oddmash-reviewer[bot] There is already a pause button. Is this necessary?' };
const pull = { state: 'open', draft: false, head: { sha: head }, base: { sha: 'b'.repeat(40), repo: { full_name: target.repository, id: 2, private: false } } };
const config = { slug: 'oddmash-reviewer', openaiKey: 'fixture', model: 'fixture' };

test('answers a verified maintainer thread once and does not change review state', async () => {
  const comments = [root, question];
  let modelCalls = 0;
  const api = githubApi('fixture', async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === base) return Response.json(pull);
    if (path === `${base}/comments`) {
      const page = new URL(String(url)).searchParams.get('page');
      return Response.json(page === '1' ? Array.from({ length: 100 }, (_, index) => ({ ...root, id: 100 + index, user: actor })) : comments);
    }
    if (path === `${base}/files`) return Response.json([{ filename: root.path, status: 'modified', patch: '@@ -0,0 +1 @@\n+const paused = true;' }]);
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
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ english: 'The control is present. My earlier concern is not supported.', korean: '제어 버튼이 있으므로 이전 지적은 근거가 부족합니다.' }) }] }] });
  };
  await replyToReview(api, target, config, model);
  await replyToReview(api, target, config, model);
  assert.equal(modelCalls, 1);
});

test('ignores unrelated or unsafe discussions before asking the model', async () => {
  for (const comments of [[{ ...root, user: actor }, question], [root, { ...question, user: { ...actor, id: 9 } }], [root, { ...question, body: '@oddmash-reviewer password: fixture-secret-value' }]]) {
    const api = githubApi('fixture', async url => Response.json(new URL(String(url)).pathname === base ? pull : comments));
    await replyToReview(api, target, config, async () => { throw new Error('model must not run'); });
  }
});
