import { githubContentFixture } from './github-content-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { acquirePendingReview, attachReviewFindings, attachReviewFindingsWithCoverage, canRetryApprovedMerge, existingAdvisoryReview, hasOfficialReview, reviewFingerprint, expiredWebhookLock, ownsPendingReview, publishCoordinatedFindings, reviewWebhook } from '../apps/worker/src/webhook-review.ts';
import { githubApi, route } from '../apps/worker/src/webhook.ts';

const path = '/repos/Oddmash/example/pulls/1';
const bot = 'oddmash-reviewer[bot]';
const head = 'a'.repeat(40);

for (const scenario of ['bare command after CI', 'mention after CI', 'CI completes during acknowledgment', 'CI completes after acknowledgment', 'failed current CI', 'stale requested head', 'one automatic review per PR']) {
  test(`explicit public review: ${scenario}`, async t => {
    t.mock.method(console, 'warn', () => {});
    const repo = { id: 7, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
    const actor = { login: 'qtaghdi', id: 135234546, type: 'User' };
    const slug = bot.replace('[bot]', '');
    const root = '/repos/Oddmash/example';
    const issueComments = `${root}/issues/1/comments`;
    const command = { id: 9, user: actor, body: scenario === 'mention after CI' ? `@${slug}[bot] /review` : '/review' };
    const routed = route('issue_comment', { action: 'created', sender: actor, comment: command, issue: { number: 1, pull_request: {} }, repository: repo, installation: { id: 3 } }, slug);
    assert.ok(routed?.requestComment);
    const target = { ...routed, expectedHead: scenario === 'stale requested head' ? 'c'.repeat(40) : head };
    const pr = { number: 1, state: 'open', draft: false, user: actor, head: { sha: head }, base: { sha: 'b'.repeat(40), repo }, changed_files: 0, labels: [], title: 'Fixture' };
    const reviews = new Map<number, Record<string, unknown>>();
    const comments: { id: number; body: string; user: { login: string } }[] = [];
    const acknowledgments = () => comments.filter(item => item.body.includes('oddmash-deferred:'));
    let started = 0;
    let submitted = 0;
    let nextReview = 42;
    let ci = scenario.startsWith('CI completes') ? 'pending' : scenario === 'failed current CI' ? 'failure' : 'success';
    t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const endpoint = url.pathname;
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      assert.equal(url.origin, 'https://api.github.com');
      if (endpoint === '/app/installations/3') return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
      if (endpoint === '/app/installations/3/access_tokens') return Response.json({ token: 'fixture' });
      if (endpoint === root) return Response.json(repo);
      if (endpoint === path) return Response.json(pr);
      if (endpoint === `${root}/pulls`) return Response.json([pr]);
      if (endpoint === `${path}/files`) { ++started; return Response.json([]); }
      if (endpoint.startsWith('/repos/Oddmash/.github/contents/')) return Response.json(githubContentFixture(endpoint.split('/contents/')[1], 'Organization policy.'));
    if (endpoint.includes('/contents/')) return new Response(null, { status: 404 });
      if (endpoint === `${root}/commits/${pr.head.sha}/check-runs`) {
        const verify = { name: 'verify', status: 'completed', app: { id: 15368 } };
        const check_runs = [{ ...verify, id: 1, conclusion: 'failure', check_suite: { id: 125 } }];
        if (ci !== 'pending') check_runs.push({ ...verify, id: 2, conclusion: ci, check_suite: { id: 126 } });
        return Response.json({ check_runs, total_count: check_runs.length });
      }
      if (endpoint === `${root}/actions/runs`) {
        const run = { head_sha: pr.head.sha, event: 'pull_request', workflow_id: 1, pull_requests: [{ number: 1 }] };
        return Response.json({ total_count: 2, workflow_runs: [
          { ...run, check_suite_id: 125, run_number: 125, status: 'completed', conclusion: 'cancelled' },
          { ...run, check_suite_id: 126, run_number: 126, status: ci === 'pending' ? 'queued' : 'completed', conclusion: ci === 'pending' ? null : ci }
        ] });
      }
      if (endpoint === `${path}/reviews`) {
        if (method !== 'POST') return Response.json([...reviews.values()]);
        const id = nextReview++;
        const review = { ...body, id, state: 'PENDING', user: { login: bot } };
        reviews.set(id, review);
        return Response.json(review);
      }
      if (endpoint.startsWith(`${path}/reviews/`)) {
        const id = Number(endpoint.slice(`${path}/reviews/`.length).split('/')[0]);
        const review = reviews.get(id);
        assert.ok(review);
        if (method === 'DELETE') { reviews.delete(id); return new Response(null, { status: 204 }); }
        if (endpoint.endsWith('/events')) {
          ++submitted;
          reviews.set(id, { ...review, body: body.body, state: 'COMMENTED' });
        }
        return Response.json(review);
      }
      if (endpoint === issueComments) {
        if (method !== 'POST') return Response.json(comments);
        const comment = { id: comments.length + 10, body: body.body, user: { login: bot } };
        comments.push(comment);
        if (scenario === 'CI completes during acknowledgment' && comment.body.includes('oddmash-deferred:')) ci = 'success';
        return Response.json(comment);
      }
      if (endpoint === `${root}/issues/comments/${command.id}`) return Response.json({ ...command, issue_url: `https://api.github.com${root}/issues/1` });
      if (endpoint.endsWith('/reactions')) return Response.json(method === 'POST' ? { id: 99 } : []);
      if (endpoint.endsWith('/reactions/99')) return new Response(null, { status: 204 });
      if (endpoint.endsWith('/labels') || endpoint === `${path}/comments`) return Response.json([]);
      assert.fail(`Unexpected request: ${method} ${endpoint}`);
    });
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const config = { appId: '42', key, slug, openaiKey: 'fixture', model: 'fixture' };
    if (scenario === 'one automatic review per PR') {
      const automatic = { installation: 3, repository: repo.full_name, repositoryId: repo.id, number: 1, expectedHead: head };
      await reviewWebhook(automatic, config);
      assert.equal(started, 1);
      assert.equal(submitted, 1);
      pr.head.sha = 'd'.repeat(40);
      await reviewWebhook({ ...automatic, expectedHead: pr.head.sha }, config);
      await reviewWebhook({ installation: 3, repository: repo.full_name, repositoryId: repo.id, sha: pr.head.sha }, config);
      assert.equal(started, 1);
      assert.equal(submitted, 1);
      await reviewWebhook({ ...routed, expectedHead: pr.head.sha }, config);
      await reviewWebhook({ ...routed, expectedHead: pr.head.sha }, config);
      assert.equal(started, 2);
      assert.equal(submitted, 2);
      return;
    }
    await reviewWebhook(target, config);
    if (scenario === 'stale requested head') {
      assert.equal(started, 0);
      assert.equal(acknowledgments().length, 0);
      return;
    }
    if (scenario === 'failed current CI') {
      assert.equal(started, 0);
      assert.match(acknowledgments()[0].body, /required checks did not pass/);
      return;
    }
    if (scenario === 'CI completes after acknowledgment') {
      assert.equal(started, 0);
      assert.match(acknowledgments()[0].body, /will start when the required checks pass/);
      ci = 'success';
    } else {
      assert.equal(started, 1);
      assert.equal(acknowledgments().length, scenario === 'CI completes during acknowledgment' ? 1 : 0);
    }
    const completed = { installation: 3, repository: repo.full_name, repositoryId: repo.id, sha: head };
    await reviewWebhook(completed, config);
    await reviewWebhook(completed, config);
    await reviewWebhook(target, config);
    assert.equal(started, 1);
    assert.equal(submitted, 1);
  });
}

test('concurrent eligible PR deliveries waiting on CI create one queued check without submitting a review', { timeout: 10000 }, async t => {
  const previousProgress = process.env.REVIEWER_CHECK_PROGRESS_ENABLED;
  const previousQueue = process.env.REVIEWER_QUEUE_ENABLED;
  const previousApp = process.env.REVIEWER_APP_ID;
  process.env.REVIEWER_CHECK_PROGRESS_ENABLED = 'true';
  process.env.REVIEWER_QUEUE_ENABLED = 'false';
  process.env.REVIEWER_APP_ID = '42';
  t.after(() => {
    for (const [key, value] of Object.entries({ REVIEWER_CHECK_PROGRESS_ENABLED: previousProgress, REVIEWER_QUEUE_ENABLED: previousQueue, REVIEWER_APP_ID: previousApp })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const repository = { id: 7, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
  const pr = { number: 1, state: 'open', draft: false, user: { login: 'fixture', id: 10 }, head: { sha: head }, base: { sha: 'b'.repeat(40), repo: repository }, labels: [] };
  const pending = new Map<number, Record<string, unknown>>();
  let nextId = 42;
  let release!: () => void;
  const bothLocks = new Promise<void>(resolve => { release = resolve; });
  let check: Record<string, unknown> | undefined;
  let creations = 0;
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const endpoint = url.pathname;
    assert.equal(url.origin, 'https://api.github.com');
    if (endpoint === '/app/installations/3') return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
    if (endpoint === '/app/installations/3/access_tokens') return Response.json({ token: 'fixture' });
    if (endpoint === '/repos/Oddmash/example') return Response.json(repository);
    if (endpoint === path) return Response.json(pr);
    if (endpoint === `${path}/reviews` && init?.method === 'POST') {
      const id = nextId++;
      const lock = { ...JSON.parse(String(init.body)), id, state: 'PENDING', user: { login: bot } };
      pending.set(id, lock);
      if (nextId === 44) release();
      await bothLocks;
      return Response.json(lock);
    }
    if (endpoint === `${path}/reviews`) return Response.json([...pending.values()]);
    if (endpoint.startsWith(`${path}/reviews/`)) {
      const id = Number(endpoint.split('/').at(-1));
      if (init?.method === 'DELETE') { pending.delete(id); return new Response(null, { status: 204 }); }
      return Response.json(pending.get(id));
    }
    if (endpoint === `/repos/Oddmash/example/commits/${head}/check-runs`) {
      if (url.searchParams.has('check_name')) return Response.json({ total_count: check ? 1 : 0, check_runs: check ? [check] : [] });
      return Response.json({ total_count: check ? 2 : 1, check_runs: [{ name: 'verify', status: 'in_progress', conclusion: null, app: { id: 15368 } }, ...(check ? [check] : [])] });
    }
    if (endpoint === '/repos/Oddmash/example/check-runs' && init?.method === 'POST') {
      ++creations;
      check = { ...JSON.parse(String(init.body)), id: 99, app: { id: 42 } };
      return Response.json(check);
    }
    if (endpoint === '/repos/Oddmash/example/check-runs/99' && init?.method === 'PATCH') {
      check = { ...check, ...JSON.parse(String(init.body)) };
      return Response.json(check);
    }
    assert.fail(`Unexpected request: ${endpoint}`);
  });
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const target = { installation: 3, repository: repository.full_name, repositoryId: repository.id, number: 1, expectedHead: head };
  const config = { appId: '42', key, slug: 'oddmash-reviewer', openaiKey: 'fixture', model: 'fixture' };
  await Promise.all([reviewWebhook(target, config), reviewWebhook(target, config)]);
  assert.equal(nextId, 44);
  await reviewWebhook(target, config);
  assert.equal(creations, 1);
  assert.equal(pending.size, 0);
  assert.equal(check?.status, 'queued');
  assert.equal((check?.output as { title: string }).title, 'Waiting for CI');
});

for (const confirmedEmpty of [false, true]) {
  test(confirmedEmpty ? 'a confirmed empty webhook review remains neutral without earlier thread reconciliation' : 'a full neutral webhook review schedules reconciliation for the current PR and retries only with green CI', async t => {
  const root = '/repos/Oddmash/example';
  const repository = { id: 7, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
  const base = 'b'.repeat(40);
  const pr = { number: 1, state: 'open', draft: false, user: { login: 'fixture', id: 10 }, head: { sha: head },
    base: { sha: base, repo: repository }, changed_files: confirmedEmpty ? 0 : 1, title: 'Fixture', labels: [] };
  const previous = { id: 10, user: { login: bot }, state: 'COMMENTED', commit_id: 'c'.repeat(40), body: '<!-- oddmash-app-review:earlier -->' };
  let current: typeof previous | undefined;
  let green = true, reconciliations = 0;
  const priorAutomatic = process.env.REVIEWER_AUTO_ADVISORY_ENABLED;
  process.env.REVIEWER_AUTO_ADVISORY_ENABLED = 'false';
  t.after(() => { if (priorAutomatic === undefined) delete process.env.REVIEWER_AUTO_ADVISORY_ENABLED; else process.env.REVIEWER_AUTO_ADVISORY_ENABLED = priorAutomatic; });
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo, init?: RequestInit) => {
    const endpoint = new URL(String(input)).pathname;
    if (endpoint === '/app/installations/3') return Response.json({ account: { login: 'Oddmash' }, suspended_at: null });
    if (endpoint === '/app/installations/3/access_tokens') return Response.json({ token: 'fixture' });
    if (endpoint === root) return Response.json(repository);
    if (endpoint === path) return Response.json(pr);
    if (endpoint === root + '/pulls') return Response.json([pr]);
    if (endpoint === path + '/files' || endpoint.endsWith('/comments') || endpoint.endsWith('/labels')) return Response.json([]);
    if (endpoint.startsWith('/repos/Oddmash/.github/contents/')) return Response.json(githubContentFixture(endpoint.split('/contents/')[1], 'Organization policy.'));
    if (endpoint.includes('/contents/')) return new Response(null, { status: 404 });
    if (endpoint === root + '/commits/' + head + '/check-runs') return Response.json({ total_count: 1, check_runs: [
      { name: 'verify', status: 'completed', conclusion: green ? 'success' : 'failure', app: { id: 15368 } }
    ] });
    if (endpoint === path + '/reviews') {
      if (init?.method === 'POST') {
        current = { ...previous, ...JSON.parse(String(init.body)), id: 11, state: 'PENDING' };
        return Response.json(current);
      }
      return Response.json(current ? [previous, current] : [previous]);
    }
    if (endpoint === path + '/reviews/11/events') {
      const { event, body } = JSON.parse(String(init?.body));
      assert.equal(event, 'COMMENT');
      current = { ...current!, state: 'COMMENTED', body };
      return Response.json(current);
    }
    if (endpoint === '/graphql') {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.variables.number, 1);
      reconciliations++;
      return Response.json({ data: { repository: { pullRequest: { headRefOid: head, baseRefOid: base, reviewThreads: {
        nodes: [], pageInfo: { hasNextPage: false }
      } } } } });
    }
    assert.fail(`Unexpected request: ${endpoint}`);
  });
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const target = { installation: 3, repository: repository.full_name, repositoryId: repository.id, sha: head };
  const config = { appId: '42', key, slug: 'oddmash-reviewer', openaiKey: 'fixture', model: 'fixture' };
  await reviewWebhook({ ...target, recheck: 'fixture-explicit-request' }, config);
  assert.equal(current?.state, 'COMMENTED');
  assert.ok(current?.body.includes(`<!-- oddmash-review-base:${base} -->`));
  assert.equal(current?.body.includes('<!-- oddmash-verified-thread-reconciliation: -->'), !confirmedEmpty);
  assert.equal(current?.body.includes('No changed files (neutral review)'), confirmedEmpty);
  assert.equal(reconciliations, confirmedEmpty ? 0 : 1);
  green = false;
  await reviewWebhook(target, config);
  assert.equal(reconciliations, confirmedEmpty ? 0 : 1);
  green = true;
  await reviewWebhook(target, config);
  assert.equal(reconciliations, confirmedEmpty ? 0 : 2);
  assert.equal(current?.id, 11);
  });
}

test('coordinated reviews publish only after all selected specialists finish', async t => {
  const root = '/repos/Oddmash/example';
  const repository = { id: 7, full_name: 'Oddmash/example', private: false, visibility: 'public', owner: { login: 'Oddmash' } };
  const base = 'b'.repeat(40);
  const files = ['src/example.ts', 'docs/guide.md'].map(filename => ({
    filename, status: 'modified', changes: 4, additions: 2, deletions: 2, patch: '@@ -1,2 +1,2 @@\n-old\n-before\n+new\n+after'
  }));
  const pr = { number: 1, state: 'open', draft: false, user: { login: 'qtaghdi', id: 135234546 }, head: { sha: head },
    base: { sha: base, repo: repository }, changed_files: files.length, title: 'Fixture', labels: [] };
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const specialists = [{ role: 'qa', appId: 43, file: files[0] }, { role: 'docs', appId: 44, file: files[1] }];
  const env = { ...process.env };
  const overrides: Record<string, string> = {
    REVIEWER_AUTO_ADVISORY_ENABLED: 'true', REVIEWER_AUTO_ADVISORY_MAX_REQUESTS: '2', REVIEWER_AUTO_ADVISORY_MAX_MS: '90000',
    REVIEWER_CHECK_PROGRESS_ENABLED: 'false'
  };
  for (const { role, appId } of specialists) {
    const prefix = role.toUpperCase();
    Object.assign(overrides, {
      [prefix + '_APP_ENABLED']: 'true', [prefix + '_APP_ID']: String(appId), [prefix + '_APP_PRIVATE_KEY']: key,
      [prefix + '_WEBHOOK_SECRET']: role, [prefix + '_OPENAI_API_KEY']: role
    });
  }
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const name of Object.keys(overrides)) {
      if (env[name] === undefined) delete process.env[name];
      else process.env[name] = env[name];
    }
  });
  const events: string[] = [];
  const comments: Record<string, unknown>[] = [];
  let review: Record<string, unknown> | undefined;
  let pending: Record<string, unknown> | undefined;
  t.mock.method(globalThis, 'fetch', async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const endpoint = url.pathname;
    const token = new Headers(init?.headers).get('authorization')?.slice(7);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url.hostname === 'api.openai.com') {
      const specialist = specialists.find(({ role }) => role === token);
      events.push('assessed ' + (specialist?.role ?? 'lead'));
      const report = specialist ? {
        en: Array(4).fill(specialist.role + ' summary'), ko: Array(4).fill('검토했습니다.'),
        inlineFindings: [{ path: specialist.file.filename, line: 1, evidence: 'new', en: 'Check the displayed state.', ko: '표시 상태를 확인하세요.' }]
      } : { findings: [], acceptance: [], allRequirementsMet: false };
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(report) }] }] });
    }
    if (endpoint === root + '/installation') {
      const jwt = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString());
      const advisor = specialists.find(({ appId }) => appId === Number(jwt.iss));
      assert.ok(advisor);
      return Response.json({ id: advisor.appId, app_id: advisor.appId, app_slug: 'oddmash-' + advisor.role, suspended_at: null });
    }
    const installation = /^\/app\/installations\/(\d+)(\/access_tokens)?$/.exec(endpoint);
    if (installation) return Response.json(installation[2] ? { token: installation[1] } : { account: { login: 'Oddmash' }, suspended_at: null });
    if (endpoint === root) return Response.json(repository);
    if (endpoint === path) return Response.json(pr);
    if (endpoint === path + '/files') return Response.json(files);
    if (endpoint.startsWith('/repos/Oddmash/.github/contents/')) return Response.json(githubContentFixture(endpoint.split('/contents/')[1], 'Organization policy.'));
    if (endpoint.includes('/contents/')) return new Response(null, { status: 404 });
    if (endpoint === root + '/commits/' + head + '/check-runs') return Response.json({ total_count: 1, check_runs: [
      { name: 'verify', status: 'completed', conclusion: 'success', app: { id: 15368 } }
    ] });
    if (endpoint === path + '/reviews') {
      if (method !== 'POST') return Response.json([review, pending].filter(Boolean));
      pending = { ...body, id: review ? 12 : 11, state: 'PENDING', user: { login: bot } };
      return Response.json(pending);
    }
    if (endpoint === path + '/reviews/11/events') {
      events.push('published lead');
      assert.equal(body.event, 'APPROVE');
      assert.match(body.body, /qa summary/);
      assert.match(body.body, /docs summary/);
      review = { ...pending, state: 'APPROVED', body: body.body };
      pending = undefined;
      return Response.json(review);
    }
    if (endpoint === path + '/reviews/11' && method === 'PUT') {
      events.push('updated lead');
      assert.match(body.body, /qa summary/);
      assert.match(body.body, /docs summary/);
      review = { ...review, body: body.body };
      return Response.json(review);
    }
    if (endpoint === path + '/reviews/12') {
      if (method === 'DELETE') { pending = undefined; return new Response(null, { status: 204 }); }
      return Response.json(pending);
    }
    if (endpoint === '/graphql') return Response.json({ data: { repository: { pullRequest: {
      headRefOid: head, baseRefOid: base, reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } }
    } } } });
    if (endpoint === path + '/comments') {
      if (method !== 'POST') return Response.json(comments);
      const specialist = specialists.find(({ appId }) => String(appId) === token);
      assert.ok(specialist);
      events.push('published ' + specialist.role);
      const comment = { ...body, id: comments.length + 1, user: { login: 'oddmash-' + specialist.role + '[bot]' } };
      comments.push(comment);
      return Response.json(comment);
    }
    if (endpoint.endsWith('/labels') || endpoint === root + '/issues/1/comments') return Response.json([]);
    assert.fail('Unexpected request: ' + method + ' ' + endpoint);
  });
  const target = { installation: 3, repository: repository.full_name, repositoryId: repository.id, number: 1, expectedHead: head };
  const config = { appId: '42', key, slug: 'oddmash-reviewer', openaiKey: 'lead', model: 'fixture' };
  await reviewWebhook(target, config);
  assert.deepEqual(events, ['assessed lead', 'assessed qa', 'assessed docs', 'published qa', 'published docs', 'published lead']);
  events.length = 0;
  const recheck = { ...target, recheck: 'fixture-recheck' };
  await reviewWebhook(recheck, config);
  await reviewWebhook(recheck, config);
  assert.deepEqual(events, ['assessed lead', 'updated lead']);
  assert.equal(pending, undefined);
});

test('only expired webhook locks owned by the bot are eligible for recovery', () => {
  const now = 1_800_000_000_000;
  const body = `<!-- oddmash-review-lock -->\n<!-- oddmash-webhook-lock:${now - 361_000} -->`;
  const review = { id: 1, state: 'PENDING', user: { login: bot }, commit_id: head, body };
  assert.equal(expiredWebhookLock(review, bot, now), true);
  assert.equal(expiredWebhookLock(review, bot, now - 10_000), false);
  assert.equal(expiredWebhookLock({ ...review, user: { login: 'other' } }, bot, now), false);
  assert.equal(expiredWebhookLock({ ...review, state: 'APPROVED' }, bot, now), false);
  assert.equal(expiredWebhookLock({ ...review, body: '<!-- oddmash-review-lock -->' }, bot, now), false);
});

test('finds the existing bot advisory to update instead of submitting a duplicate', () => {
  const old = { id: 1, state: 'COMMENTED', user: { login: bot }, commit_id: head, body: '<!-- oddmash-app-review:old -->\nMaintainer review required.' };
  const checks = { total_count: 1, check_runs: [{ id: 2, name: 'verify', status: 'completed', conclusion: 'success' }] };
  assert.notEqual(old.body, reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks));
  assert.equal(existingAdvisoryReview([old, { ...old, id: 2, user: { login: 'someone' } }, { ...old, id: 3, commit_id: 'c'.repeat(40) }], bot, head)?.id, 1);
  assert.equal(existingAdvisoryReview([{ ...old, state: 'APPROVED' }], bot, head), undefined);
  const marker = reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks);
  assert.equal(canRetryApprovedMerge({ ...old, state: 'APPROVED' }, marker), true);
  assert.equal(canRetryApprovedMerge({ ...old, state: 'APPROVED', body: marker }, marker), false);
  assert.equal(canRetryApprovedMerge(old, marker), false);
  assert.notEqual(marker, reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks, 'comment-123'));
  assert.equal(reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks, 'comment-123'), reviewFingerprint('Oddmash/example', 1, head, 'b'.repeat(40), checks, 'comment-123'));
});

test('acquires only its own pending review lock', async () => {
  const api = githubApi('fixture-token', async () => Response.json({ id: 42, state: 'PENDING', user: { login: bot }, commit_id: head }));
  assert.equal(await acquirePendingReview(api, path, head, bot), 42);
});

test('a submitted official review deduplicates the PR while exact-head lookup remains available', () => {
  const review = { id: 42, state: 'CHANGES_REQUESTED', user: { login: bot }, body: '<!-- oddmash-app-review:fixture -->', commit_id: 'b'.repeat(40) };
  assert.equal(hasOfficialReview([review], bot), true);
  assert.equal(hasOfficialReview([review], bot, review.commit_id), true);
  assert.equal(hasOfficialReview([review], bot, 'd'.repeat(40)), false);
  assert.equal(hasOfficialReview([{ ...review, state: 'DISMISSED' }], bot), true);
  assert.equal(hasOfficialReview([{ ...review, state: 'PENDING' }], bot), false);
  assert.equal(hasOfficialReview([{ ...review, user: { login: 'another-reviewer' } }], bot), false);
  assert.equal(hasOfficialReview([{ ...review, body: 'unrelated comment' }], bot), false);
});

test('does not acquire a concurrent pending review', async () => {
  const api = githubApi('fixture-token', async (_url, init) => init?.method === 'POST' ? new Response(null, { status: 422 }) : Response.json([{ id: 42, state: 'PENDING', user: { login: bot }, commit_id: head }]));
  assert.equal(await acquirePendingReview(api, path, head, bot), null);
});

test('does not hide unrelated validation errors', async () => {
  const api = githubApi('fixture-token', async (_url, init) => init?.method === 'POST' ? new Response(null, { status: 422 }) : Response.json([]));
  await assert.rejects(acquirePendingReview(api, path, head, bot), /\(422\)/);
});

test('attaches all new findings to the same pending review in one mutation', async () => {
  const findings = ['a', 'b', 'c'].map((id, index) => ({ path: 'src/ui.ts', line: index + 1, side: 'RIGHT' as const, body: `<!-- oddmash-finding:${id.repeat(24)} -->\nFinding` }));
  let mutations = 0;
  const api = githubApi('fixture-token', async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === `${path}/comments`) return Response.json([{ user: { login: bot }, body: findings[0].body }]);
    if (endpoint === `${path}/reviews/42`) return Response.json({ id: 42, node_id: 'PRR_fixture', state: 'PENDING', user: { login: bot }, commit_id: head, body: '<!-- oddmash-review-lock -->' });
    assert.equal(endpoint, '/graphql');
    mutations++;
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(Object.values(payload.variables).map(value => (value as { pullRequestReviewId: string }).pullRequestReviewId), ['PRR_fixture', 'PRR_fixture']);
    assert.deepEqual(Object.values(payload.variables).map(value => (value as { line: number }).line), [2, 3]);
    return Response.json({ data: { finding0: { thread: { id: 'thread1' } }, finding1: { thread: { id: 'thread2' } } } });
  });
  assert.equal(await attachReviewFindings(api, path, 42, head, bot, findings), 2);
  assert.equal(mutations, 1);
});

test('rejects partial batch attachment before submitting the review', async () => {
  const finding = { body: `<!-- oddmash-finding:${'a'.repeat(24)} -->`, path: 'src/ui.ts', line: 1, side: 'RIGHT' as const };
  const api = githubApi('fixture-token', async url => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === `${path}/comments`) return Response.json([]);
    if (endpoint === `${path}/reviews/42`) return Response.json({ id: 42, node_id: 'PRR_fixture', state: 'PENDING', user: { login: bot }, commit_id: head, body: '<!-- oddmash-review-lock -->' });
    assert.equal(endpoint, '/graphql');
    return Response.json({ errors: [{ message: 'fixture error' }] });
  });
  await assert.rejects(attachReviewFindings(api, path, 42, head, bot, [finding]), /could not be attached/);
});


test('only suppresses the summary when existing bot threads cover every finding', async () => {
  const finding = { body: `<!-- oddmash-finding:${'a'.repeat(24)} -->`, path: 'src/ui.ts', line: 1, side: 'RIGHT' as const };
  const api = githubApi('fixture-token', async url => {
    assert.equal(new URL(String(url)).pathname, `${path}/comments`);
    return Response.json([{ user: { login: bot }, body: finding.body }]);
  });
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [finding]), { attached: 0, covered: true });
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [{ ...finding, body: 'Missing marker' }]), { attached: 0, covered: false });
});


test('existing advice cannot suppress a blocking Lead finding on the same line', async () => {
  const text = 'Keyboard focus disappears when opening the dialog.';
  const anchor = { path: 'src/ui.ts', line: 1, side: 'RIGHT' as const };
  const marker = `<!-- oddmash-finding:${'a'.repeat(24)} -->`;
  const blocking = { ...anchor, body: `${marker}\n**BLOCKING / MEDIUM: ${text}**` };
  const advisory = { ...blocking, body: blocking.body.replace('BLOCKING', 'ADVISORY') };
  let priorLeadAdvisory = false;
  const api = githubApi('fixture-token', async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === path + '/comments') return Response.json([
      { ...anchor, commit_id: head, user: { login: 'oddmash-qa[bot]', type: 'Bot' }, body: `<!-- oddmash-finding:${'b'.repeat(24)} -->\n${text}` },
      ...(priorLeadAdvisory ? [{ ...advisory, commit_id: head, user: { login: bot, type: 'Bot' } }] : [])
    ]);
    if (endpoint === path + '/reviews/42') return Response.json({ id: 42, node_id: 'PRR_fixture', state: 'PENDING', user: { login: bot }, commit_id: head, body: '<!-- oddmash-review-lock -->' });
    assert.equal(endpoint, '/graphql');
    assert.equal(JSON.parse(String(init?.body)).variables.finding0.body, blocking.body);
    return Response.json({ data: { finding0: { thread: { id: 'fixture' } } } });
  });
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [advisory]), { attached: 0, covered: true });
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [blocking]), { attached: 1, covered: true });
  priorLeadAdvisory = true;
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [blocking]), { attached: 1, covered: true });
});

test('simultaneous pending reviews elect only the oldest owned lock and fail closed on incomplete evidence', () => {
  const lock = (id: number) => ({ id, state: 'PENDING', user: { login: bot }, commit_id: head, body: '<!-- oddmash-review-lock -->' });
  const concurrent = [lock(44), lock(42)];
  assert.equal(ownsPendingReview(concurrent, bot, head, 42), true);
  assert.equal(ownsPendingReview(concurrent, bot, head, 44), false);
  assert.equal(ownsPendingReview([lock(44)], bot, head, 42), false);
  assert.equal(ownsPendingReview([lock(42), { ...lock(44), body: 'unrelated pending review' }], bot, head, 42), false);
  assert.equal(ownsPendingReview([lock(42), { ...lock(44), commit_id: 'b'.repeat(40) }], bot, head, 42), false);
  assert.equal(ownsPendingReview(Array.from({ length: 100 }, (_, i) => lock(i + 42)), bot, head, 42), false);
});


test('specialist publication failure falls back to Lead and grouped advice retains coverage', async () => {
  const anchor = { path: 'docs/example.md', line: 1, side: 'RIGHT' as const };
  const text = 'Verify the standalone example uses the published public export.';
  const finding = { ...anchor, body: `<!-- oddmash-finding:${'a'.repeat(24)} -->\n**ADVISORY / MEDIUM: ${text}**` };
  let specialistPublished = false;
  let leadAttachments = 0;
  const api = githubApi('fixture-token', async url => {
    const endpoint = new URL(String(url)).pathname;
    if (endpoint === path + '/comments') return Response.json(specialistPublished ? [
      { ...anchor, commit_id: head, user: { login: 'oddmash-docs[bot]', type: 'Bot' }, body: `<!-- oddmash-finding:${'b'.repeat(24)} -->\n${text}` }
    ] : []);
    if (endpoint === path + '/reviews/42') return Response.json({ id: 42, node_id: 'PRR_fixture', state: 'PENDING', user: { login: bot }, commit_id: head, body: '<!-- oddmash-review-lock -->' });
    assert.equal(endpoint, '/graphql');
    leadAttachments++;
    return Response.json({ data: { finding0: { thread: { id: 'fixture' } } } });
  });
  await publishCoordinatedFindings([{ publish: async () => { throw new Error('fixture failure'); } }]);
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [finding]), { attached: 1, covered: true });
  await publishCoordinatedFindings([{ publish: async () => { specialistPublished = true; } }]);
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [finding]), { attached: 0, covered: true });
  const grouped = { ...finding, body: finding.body + '\n<!-- oddmash-grouped-finding -->\nRelated: README.md' };
  assert.deepEqual(await attachReviewFindingsWithCoverage(api, path, 42, head, bot, [grouped]), { attached: 1, covered: true });
  assert.equal(leadAttachments, 2);
});
