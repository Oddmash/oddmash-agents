import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { authorize, completeCommentReaction, githubApi, ignoredReviewRequest, reactToComment, route, validSignature } from '../src/webhook.ts';

const repo = { id: 7, full_name: 'Oddmash/new-project', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
const event = { action: 'opened', installation: { id: 3 }, repository: repo, pull_request: { number: 2, draft: false } };
test('new public organization repositories are eligible', () => {
  assert.deepEqual(route('pull_request', event), { installation: 3, repository: repo.full_name, repositoryId: 7, number: 2 });
});
test('unapproved private, external, draft, archived and unrelated events are ignored', () => {
  for (const repository of [{ ...repo, private: true }, { ...repo, visibility: 'internal' }, { ...repo, owner: { login: 'Other' } }, { ...repo, archived: true }]) assert.equal(route('pull_request', { ...event, repository }), null);
  assert.equal(route('pull_request', { ...event, pull_request: { number: 2, draft: true } }), null);
  assert.equal(route('pull_request', { ...event, action: 'closed' }), null);
  assert.equal(route('push', event), null);
});
test('only completed valid check suites trigger', () => {
  const sha = 'a'.repeat(40);
  assert.equal(route('check_suite', { ...event, action: 'completed', check_suite: { head_sha: sha } })?.sha, sha);
  assert.equal(route('check_suite', { ...event, action: 'requested', check_suite: { head_sha: sha } }), null);
  assert.equal(route('check_suite', { ...event, action: 'completed', check_suite: { head_sha: sha, app: { id: 42 } } }, 'reviewer', '', 42), null);
  assert.equal(route('check_suite', { ...event, action: 'completed', check_suite: { head_sha: sha, app: { id: 43 } } }, 'reviewer', '', 42)?.sha, sha);
});
test('signature authenticates exact bytes', () => {
  const data = Buffer.from('{"hello":1}');
  const signature = 'sha256=' + createHmac('sha256', 'test-secret').update(data).digest('hex');
  assert.equal(validSignature(data, signature, 'test-secret'), true);
  assert.equal(validSignature(Buffer.from('different'), signature, 'test-secret'), false);
  assert.equal(validSignature(data, signature, ''), false);
  assert.equal(validSignature(data, null, 'test-secret'), false);
});

test('maintainer can request a fresh review or mention the bot in its inline thread', () => {
  const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
  const slug = 'oddmash-reviewer';
  const delivery = '11111111-2222-3333-4444-555555555555';
  const requested = { ...event, action: 'review_requested', sender: actor, requested_reviewer: { id: 9, login: `${slug}[bot]`, type: 'Bot' } };
  assert.equal(route('pull_request', requested, slug, delivery)?.recheck, delivery);
  assert.equal(route('pull_request', { ...requested, sender: { ...actor, id: 10 } }, slug, delivery), null);
  const comment = { ...event, action: 'created', sender: actor, comment: { id: 5, user: actor, body: `@${slug} /review` }, issue: { number: 2, pull_request: {} } };
  assert.equal(route('issue_comment', comment, slug)?.recheck, 'comment-5');
  assert.deepEqual(route('issue_comment', comment, slug)?.requestComment, { kind: 'issue', id: 5 });
  assert.equal(route('issue_comment', { ...comment, comment: { ...comment.comment, body: `@${slug}` } }, slug)?.recheck, 'comment-5');
  assert.equal(route('issue_comment', { ...comment, issue: { number: 2 } }, slug), null);
  const reply = { ...comment, comment: { ...comment.comment, body: `@${slug}[bot] Is this required?`, in_reply_to_id: 4 } };
  assert.deepEqual(route('pull_request_review_comment', reply, slug)?.reply, { comment: 5, root: 4 });
  const currentHead = 'a'.repeat(40);
  const unmentioned = { ...reply, pull_request: { ...reply.pull_request, head: { sha: currentHead } },
    comment: { ...reply.comment, body: `Fixed in ${currentHead}: the control is restored.` } };
  assert.deepEqual(route('pull_request_review_comment', unmentioned, slug)?.reply, { comment: 5, root: 4, byThread: true });
  assert.equal(route('pull_request_review_comment', unmentioned, slug)?.expectedHead, currentHead);
  assert.equal(route('pull_request_review_comment', unmentioned, 'oddmash-qa', '', undefined, false), null);
  assert.equal(route('issue_comment', unmentioned, slug), null);
  assert.equal(route('pull_request_review_comment', { ...unmentioned, comment: { ...unmentioned.comment, in_reply_to_id: undefined } }, slug), null);
  assert.equal(route('pull_request_review_comment', { ...reply, sender: { ...actor, type: 'Bot' } }, slug), null);
  assert.equal(route('pull_request_review_comment', { ...reply, action: 'edited' }, slug), null);
  assert.equal(route('pull_request_review_comment', { ...reply, comment: { ...reply.comment, body: '@other is this required?' } }, slug), null);
});

test('adds reactions to the exact comment type and uses only supported statuses', async () => {
  const calls: [string, string][] = [];
  const api = githubApi('fixture', async (url, init) => { calls.push([new URL(String(url)).pathname, JSON.parse(String(init?.body)).content]); return Response.json({ id: 1 }); });
  await reactToComment(api, repo.full_name, { kind: 'issue', id: 123 }, 'eyes');
  await reactToComment(api, repo.full_name, { kind: 'inline', id: 456 }, '+1');
  assert.deepEqual(calls, [[`/repos/${repo.full_name}/issues/comments/123/reactions`, 'eyes'], [`/repos/${repo.full_name}/pulls/comments/456/reactions`, '+1']]);
});

test('completion removes only the bot receipt reaction and keeps the positive acknowledgement', async () => {
  for (const kind of ['inline', 'issue'] as const) {
    const calls: [string, string, string | undefined][] = [];
    const api = githubApi('fixture', async (url, init) => {
      const path = new URL(String(url)).pathname;
      const content = init?.body ? JSON.parse(String(init.body)).content : undefined;
      calls.push([init?.method ?? 'GET', path, content]);
      return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: content === 'eyes' ? 9 : 10 });
    });
    const comment = { kind, id: 123 };
    const base = `/repos/${repo.full_name}/${kind === 'inline' ? 'pulls' : 'issues'}/comments/123/reactions`;
    const eyes = await reactToComment(api, repo.full_name, comment, 'eyes');
    await completeCommentReaction(api, repo.full_name, comment, eyes, true);
    assert.deepEqual(calls, [['POST', base, 'eyes'], ['POST', base, '+1'], ['DELETE', `${base}/9`, undefined]]);
    calls.length = 0;
    await completeCommentReaction(api, repo.full_name, comment, eyes, false);
    assert.deepEqual(calls, [['DELETE', `${base}/9`, undefined]]);
  }
});

test('routes explicit scoped conversation references only to the same PR', () => {
  const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
  const slug = 'oddmash-reviewer';
  const body = `@${slug} Fixed in ${'a'.repeat(40)}: fixed the finding.\nOriginal: https://github.com/${repo.full_name}/pull/2#pullrequestreview-4\nFile: src/demo.ts`;
  const payload = { ...event, action: 'created', sender: actor, comment: { id: 5, user: actor, body }, issue: { number: 2, pull_request: {} } };
  const result = route('issue_comment', payload, slug);
  assert.deepEqual(result?.reply, { comment: 5, root: 4, kind: 'conversation', rootKind: 'review', path: 'src/demo.ts' });
  assert.equal(result?.recheck, undefined);
  assert.equal(ignoredReviewRequest('issue_comment', payload, slug), undefined);
  assert.equal(route('issue_comment', { ...payload, comment: { ...payload.comment, body: body.replace('/pull/2', '/pull/7') } }, slug), null);
  assert.equal(route('issue_comment', { ...payload, sender: { ...actor, id: 9 } }, slug), null);
});

test('explicit review command accepts following context without interpreting mentions as commands', () => {
  const actor = { id: 135234546, login: 'qtaghdi', type: 'User' };
  const slug = 'oddmash-reviewer';
  const comment = { ...event, action: 'created', sender: actor, issue: { number: 2, pull_request: {} }, comment: { id: 5, user: actor, body: '' } };
  const withBody = (body: string) => ({ ...comment, comment: { ...comment.comment, body } });
  const context = `Exact-head CI passed for ${'a'.repeat(40)}. Please review the current head.`;
  for (const body of [
    `@${slug} /review\n\n${context}`,
    `  @${slug}[bot] /rereview\r\n${context}  `,
    `\n@ODDMASH-REVIEWER\t/REVIEW\n${context}`,
    `@${slug}\n/review`,
    `@${slug} /review\n${'x'.repeat(2000 - (`@${slug} /review\n`).length)}`
  ]) {
    assert.deepEqual(route('issue_comment', withBody(body), slug)?.requestComment, { kind: 'issue', id: 5 });
    assert.equal(ignoredReviewRequest('issue_comment', withBody(body), slug), undefined);
  }
  for (const body of [
    `Please ask @${slug} /review`,
    `@${slug} /reviewing\n${context}`,
    `@${slug} /review please`,
    `@${slug}\nIs this required?`,
    `> @${slug} /review\n${context}`,
    `\`\`\`\n@${slug} /review\n\`\`\``,
    `${context}\n@${slug} /review`
  ]) assert.equal(route('issue_comment', withBody(body), slug), null);
  const inline = { ...withBody(`@${slug} /rereview\n${context}`), comment: { ...withBody(`@${slug} /rereview\n${context}`).comment, in_reply_to_id: 4 } };
  assert.deepEqual(route('pull_request_review_comment', inline, slug)?.requestComment, { kind: 'inline', id: 5, root: 4 });
  const discussion = { ...inline, comment: { ...inline.comment, body: `@${slug}\nIs this required?` } };
  assert.deepEqual(route('pull_request_review_comment', discussion, slug)?.reply, { comment: 5, root: 4 });
  const valid = withBody(`@${slug} /review\n${context}`);
  for (const payload of [
    { ...valid, sender: { ...actor, id: 10 } },
    { ...valid, comment: { ...valid.comment, user: { ...actor, id: 10 } } },
    { ...valid, sender: { ...actor, type: 'Bot' } },
    { ...valid, action: 'edited' },
    { ...valid, repository: { ...repo, private: true, visibility: 'private' } },
    { ...valid, issue: { number: 2 } },
    { ...valid, installation: { id: 0 } }
  ]) {
    assert.equal(route('issue_comment', payload, slug), null);
    assert.equal(ignoredReviewRequest('issue_comment', payload, slug), undefined);
  }
  const invalid = withBody(`@${slug} /review please`);
  assert.match(ignoredReviewRequest('issue_comment', invalid, slug) ?? '', /first line/);
  const oversized = withBody(`@${slug} /review\n${'x'.repeat(2000)}`);
  assert.equal(route('issue_comment', oversized, slug), null);
  assert.match(ignoredReviewRequest('issue_comment', oversized, slug) ?? '', /2000 characters/);
});

test('only explicitly approved private repository identities are eligible', () => {
  for (const [name, id] of Object.entries({ 'Oddmash/oddmash-agents': 1468182609, 'Oddmash/oddmash-skills': 1468154482, 'Oddmash/overtime-prototype': 1461455091, 'Oddmash/cash-out': 1462488077, 'Oddmash/oddmash-website': 1468561714 })) {
    const repository = { ...repo, full_name: name, id, private: true, visibility: 'private' };
    assert.deepEqual(route('pull_request', { ...event, repository }), { installation: 3, repository: name, repositoryId: id, private: true, number: 2 });
    assert.equal(route('pull_request', { ...event, repository: { ...repository, id: 99 } }), null);
    assert.equal(route('pull_request', { ...event, repository: { ...repository, visibility: 'internal' } }), null);
    assert.equal(route('pull_request', { ...event, repository: { ...repository, archived: true } }), null);
  }
  assert.equal(route('pull_request', { ...event, repository: { ...repo, private: true, visibility: 'private' } }), null);
});


test('PR advisory identities request pull request write access while Triage remains read-only', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  for (const role of ['impact', 'qa', 'release', 'docs', 'architect', 'triage'] as const) {
    const requests: unknown[] = [];
    const request: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/app/installations/3') return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
      if (path === '/app/installations/3/access_tokens') {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({ token: 'fixture' });
      }
      if (path === `/repos/${repo.full_name}`) return Response.json(repo);
      throw new Error('Unexpected fixture request');
    };
    await authorize({ installation: 3, repository: repo.full_name, repositoryId: repo.id, number: 2, advisory: role }, '123', privateKey, request);
    assert.deepEqual(requests, [{ repository_ids: [repo.id], permissions: { contents: 'read', pull_requests: role === 'triage' ? 'read' : 'write', checks: 'read', issues: 'write' } }]);
  }
});

test('Lead alone routes each standalone slash command in its supported context', () => {
  const user = { id: 135234546, login: 'qtaghdi', type: 'User' };
  const make = (body: string, pull = true) => ({
    ...event, action: 'created', sender: user, issue: { number: 2, ...(pull ? { pull_request: {} } : {}) },
    comment: { id: 5, user, body, in_reply_to_id: 4 }
  });
  for (const role of ['review', 'qa', 'docs', 'impact', 'architect', 'release', 'triage'] as const) {
    const pull = role !== 'triage';
    const payload = make(`\n /${role}\r\n\nPlease check the fallback path.`, pull);
    const target = route('issue_comment', payload, 'oddmash-lead');
    assert.deepEqual(target?.requestComment, { kind: 'issue', id: 5, slash: true });
    assert.equal(target?.advisory, role === 'review' ? undefined : role);
    assert.equal(target?.recheck, role === 'review' ? 'comment-5' : undefined);
    assert.equal(route('issue_comment', make('/' + role, !pull), 'oddmash-lead'), null);
    assert.equal(route('issue_comment', payload, 'oddmash-' + role, '', undefined, false), null);
  }
  assert.deepEqual(route('pull_request_review_comment', make('/review'), 'oddmash-lead')?.requestComment,
    { kind: 'inline', id: 5, root: 4, slash: true });
  assert.equal(route('pull_request_review_comment', make('/qa'), 'oddmash-lead'), null);
  for (const body of ['> /review', '    /review', 'Please /review', '/review and /qa', '/review\n/qa', '/qa\n@oddmash-lead[bot] /review', '\x60\x60\x60\n/review\n\x60\x60\x60']) {
    assert.equal(route('issue_comment', make(body), 'oddmash-lead'), null);
  }
  for (const payload of [
    { ...make('/review'), sender: { ...user, id: 9 } },
    { ...make('/review'), comment: { ...make('/review').comment, user: { ...user, id: 9 } } },
    { ...make('/review'), action: 'edited' },
    { ...make('/review'), repository: { ...repo, private: true, visibility: 'private' } }
  ]) assert.equal(route('issue_comment', payload, 'oddmash-lead'), null);
});

test('slash request context is scoped to the authenticated maintainer and subject', async () => {
  const { slashRequestContext } = await import('../src/webhook.ts');
  const sender = { id: 135234546, login: 'qtaghdi', type: 'User' };
  const payload = { ...event, action: 'created', sender, issue: { number: 2, pull_request: {} }, comment: { id: 5, user: sender, body: '/qa' } };
  const target = route('issue_comment', payload, 'oddmash-lead')!;
  const item = { ...payload.comment, issue_url: `https://api.github.com/repos/${repo.full_name}/issues/2`, body: '/qa\nCheck the fallback path.' };
  const api = (comment: typeof item) => githubApi('fixture', async () => Response.json(comment));
  assert.equal(await slashRequestContext(api(item), target, 'qa'), 'Check the fallback path.');
  assert.equal(await slashRequestContext(api({ ...item, body: '/qa\nsecret: synthetic-value' }), target, 'qa'), undefined);
  assert.equal(await slashRequestContext(api({ ...item, issue_url: item.issue_url + '0' }), target, 'qa'), undefined);
  assert.equal(await slashRequestContext(api({ ...item, body: '/docs\nDifferent scope.' }), target, 'qa'), undefined);
});
