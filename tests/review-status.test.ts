import test from 'node:test';
import assert from 'node:assert/strict';
import { githubApi } from '../apps/worker/src/webhook.ts';
import { publishAutomationStatus, statusText, billingHelpLink } from '../apps/worker/src/review-status.ts';

test('status comments update in place, suppress repeats and do not disclose arbitrary errors', async () => {
  const head = 'a'.repeat(40), bot = 'oddmash-reviewer[bot]';
  const comments: { id: number; body: string; user: { login: string } }[] = [];
  let posts = 0, patches = 0;
  const api = githubApi('fixture', async (input, init) => {
    const url = String(input);
    if (url.includes('/pulls/7')) return Response.json({ state: 'open', head: { sha: head } });
    if (init?.method === 'POST') { posts++; comments.push({ id: 10, body: JSON.parse(String(init.body)).body, user: { login: bot } }); return Response.json(comments[0]); }
    if (init?.method === 'PATCH') { patches++; comments[0].body = JSON.parse(String(init.body)).body; return Response.json(comments[0]); }
    return Response.json(comments);
  });
  const publish = (reason: string, completed = false) => publishAutomationStatus(api, 'Oddmash/example', 7, bot, head, 'merge', reason, completed);
  await publish('merge completed', true);
  assert.equal(posts, 0);
  await publish('missing single closing issue link');
  await publish('missing single closing issue link');
  assert.equal(posts, 1);
  assert.equal(patches, 0);
  assert.match(comments[0].body, /Closes #N/);
  await publish('arbitrary secret-like fixture');
  assert.equal(patches, 1);
  assert.doesNotMatch(comments[0].body, /arbitrary secret-like fixture/);
  await publish('merge completed', true);
  assert.match(comments[0].body, /Automatic merge completed/);
  assert.equal(patches, 2);
  assert.match(statusText('review', 'Model quota, rate or credit limit reached; stop and check API billing before retrying')[0], /billing/);
});

test('status comments are suppressed for a stale head and never update another author', async () => {
  const bot = 'oddmash-reviewer[bot]';
  let writes = 0;
  const api = githubApi('fixture', async (input, init) => {
    if (init?.method === 'POST' || init?.method === 'PATCH') writes++;
    if (String(input).includes('/pulls/7')) return Response.json({ state: 'open', head: { sha: 'b'.repeat(40) } });
    return Response.json([{ id: 1, user: { login: 'other' }, body: '<!-- oddmash-automation-status:merge -->' }]);
  });
  await publishAutomationStatus(api, 'Oddmash/example', 7, bot, 'a'.repeat(40), 'merge', 'candidate is not clean');
  assert.equal(writes, 0);
});

test('billing notices link only the known organization and use generic guidance otherwise', () => {
  assert.match(billingHelpLink('Oddmash/example'), /github\.com\/organizations\/Oddmash\/settings\/billing/);
  assert.match(billingHelpLink('personal/example'), /docs\.github\.com\/en\/billing/);
  assert.match(billingHelpLink('Oddmash/other/invalid'), /docs\.github\.com\/en\/billing/);
});

test('model input budget failures provide actionable guidance without private details', () => {
  const [en, ko] = statusText('review', 'Model input budget exceeded');
  assert.match(en, /Split the PR/);
  assert.match(ko, /입력 한도/);
});


test('concurrent status publishers retain only one identical bot-owned status comment', async () => {
  const head = 'a'.repeat(40), bot = 'oddmash-reviewer[bot]';
  const comments: { id: number; body: string; user: { login: string } }[] = [{ id: 1, body: '<!-- oddmash-automation-status:merge -->', user: { login: 'other' } }];
  let release!: () => void;
  const bothPosted = new Promise<void>(resolve => { release = resolve; });
  let posts = 0;
  const api = githubApi('fixture', async (input, init) => {
    const url = String(input);
    if (url.includes('/pulls/7')) return Response.json({ state: 'open', head: { sha: head } });
    if (init?.method === 'POST') {
      const created = { id: ++posts + 10, body: JSON.parse(String(init.body)).body, user: { login: bot } };
      comments.push(created);
      if (posts === 2) release();
      await bothPosted;
      return Response.json(created);
    }
    const id = Number(url.match(/\/issues\/comments\/(\d+)$/)?.[1]);
    if (init?.method === 'DELETE') {
      comments.splice(comments.findIndex(comment => comment.id === id), 1);
      return new Response(null, { status: 204 });
    }
    if (id) return Response.json(comments.find(comment => comment.id === id));
    return Response.json(comments);
  });
  const publish = () => publishAutomationStatus(api, 'Oddmash/example', 7, bot, head, 'merge', 'missing single closing issue link');
  await Promise.all([publish(), publish()]);
  assert.equal(posts, 2);
  assert.deepEqual(comments.map(comment => comment.id), [1, 11]);
});


test('full pagination without a marker does not create a duplicate status', async () => {
  let reads = 0;
  let writes = 0;
  const api = githubApi('fixture', async (_input, init) => {
    if (init?.method === 'POST' || init?.method === 'PATCH' || init?.method === 'DELETE') writes++;
    reads++;
    return Response.json(Array.from({ length: 100 }, (_, i) => ({ id: reads * 100 + i, user: { login: 'other' }, body: 'fixture' })));
  });
  await publishAutomationStatus(api, 'Oddmash/example', 7, 'oddmash-reviewer[bot]', 'a'.repeat(40), 'merge', 'missing single closing issue link');
  assert.equal(reads, 10);
  assert.equal(writes, 0);
});


test('auto-merge diagnostics provide bilingual next actions without confidential filenames', () => {
  const [en, ko] = statusText('merge', 'repository requires root README-only changes');
  assert.match(en, /root README/);
  assert.match(en, /merge manually/);
  assert.match(ko, /루트 README/);
  assert.match(ko, /수동 머지/);
  assert.match(statusText('merge', 'changed diff exceeds the auto-merge budget')[0], /45,000/);
  assert.match(statusText('merge', 'private strict review coverage is incomplete')[1], /로컬/);
  assert.doesNotMatch(statusText('merge', 'arbitrary confidential path example')[0], /confidential path example/);
});

test('cross-repository auto-merge notice explains the rule and names the current linked issue', async () => {
  const bot = 'oddmash-lead[bot]', head = 'a'.repeat(40);
  let posted = '';
  const api = githubApi('fixture', async (input, init) => {
    if (String(input).endsWith('/pulls/63')) {
      return Response.json({ state: 'open', head: { sha: head }, body: '## Related issue\n\nRefs Oddmash/.github#68\n\n## Summary\n\nUnrelated text.' });
    }
    if (init?.method === 'POST') {
      posted = JSON.parse(String(init.body)).body;
      return Response.json({ id: 1, user: { login: bot }, body: posted });
    }
    return Response.json([]);
  });
  await publishAutomationStatus(api, 'Oddmash/oddmash-ui', 63, bot, head, 'merge', 'cross-repository issue reference requires manual merge');
  assert.match(posted, /one issue in this PR’s repository/);
  assert.doesNotMatch(posted, /CI와 리뷰 통과 후 수동으로 머지/);
  assert.equal(posted.split('Oddmash/.github#68').length, 2);
  assert.doesNotMatch(posted, /Unrelated text/);
});
