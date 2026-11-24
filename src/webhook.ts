import { createHmac, timingSafeEqual, createSign } from 'node:crypto';

type Repository = { id: number; full_name: string; private: boolean; visibility: string; owner: { login: string }; archived?: boolean };
type Actor = { id: number; login: string; type?: string };
type Payload = { action?: string; installation?: { id: number }; repository?: Repository; pull_request?: { number: number; draft: boolean; head?: { sha: string } }; check_suite?: { head_sha: string; app?: { id: number }; pull_requests?: { number: number }[] }; sender?: Actor; requested_reviewer?: Actor; issue?: { number: number; pull_request?: object }; comment?: { id: number; user: Actor; body: string; in_reply_to_id?: number } };
export type Target = { installation: number; repository: string; repositoryId: number; number?: number; sha?: string; expectedHead?: string; impact?: true; private?: boolean; recheck?: string; requestComment?: { kind: 'inline' | 'issue'; id: number; root?: number }; reply?: { comment: number; root: number; kind?: 'conversation'; rootKind?: 'issue' | 'review'; path?: string } };
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const shaPattern = /^[a-f0-9]{40}$/i;

export function validSignature(raw: Uint8Array, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function publicOddmash(repo: Repository | undefined): boolean {
  return !!repo && positive(repo.id) && repo.private === false && repo.visibility === 'public' && repo.archived !== true && repo.owner?.login?.toLowerCase() === 'oddmash' && /^Oddmash\/[a-z0-9_.-]+$/i.test(repo.full_name);
}

const privateRepositories: Record<string, number> = {
  "Oddmash/oddmash-agents": 1468182609,
  "Oddmash/oddmash-skills": 1468154482,
  "Oddmash/overtime-prototype": 1461455091,
  "Oddmash/cash-out": 1462488077,
  "Oddmash/oddmash-website": 1468561714
};

export function privateRepositoryAllowed(name: string, id: number | undefined): boolean {
  return positive(id) && Object.hasOwn(privateRepositories, name) && privateRepositories[name] === id;
}

export function reviewableOddmash(repo: Repository | undefined): boolean {
  return publicOddmash(repo) || (!!repo && repo.private === true && repo.visibility === 'private' && repo.archived !== true && repo.owner?.login?.toLowerCase() === 'oddmash' && privateRepositoryAllowed(repo.full_name, repo.id));
}

export const maintainer = (actor: Actor | undefined) => actor?.id === 135234546 && actor.login === 'qtaghdi' && actor.type === 'User';
export const mentioned = (body: string, slug: string) => /^[a-z0-9-]+$/i.test(slug) && new RegExp(`(?:^|\\s)@${slug}(?:\\[bot\\])?(?=$|[\\s,.!?])`, 'i').test(body);
export function reviewCommand(body: string, slug: string): boolean {
  if (!/^[a-z0-9-]+$/i.test(slug)) return false;
  const mention = `@${slug}(?:\\[bot\\])?`;
  const trimmed = body.trim();
  if (new RegExp(`^${mention}(?:\\s+/(?:re)?review)?$`, 'i').test(trimmed)) return true;
  const firstLine = trimmed.split(/\r\n|\n|\r/, 1)[0].trim();
  return new RegExp(`^${mention}[ \\t]+/(?:re)?review$`, 'i').test(firstLine);
}

export function impactCommand(body: string, slug: string): boolean {
  if (!/^[a-z0-9-]+$/i.test(slug)) return false;
  const normalized = body.trim().toLowerCase();
  return normalized === '@' + slug.toLowerCase() + ' /impact' || normalized === '@' + slug.toLowerCase() + '[bot] /impact';
}

export function conversationFixReference(body: string, slug: string, repository: string, number: number): { root: number; rootKind: 'issue' | 'review'; path: string } | undefined {
  if (!/^[a-z0-9-]+$/i.test(slug) || !new RegExp(`^@${slug}(?:\\[bot\\])? Fixed in [a-f0-9]{40}:`, 'i').test(body.trim())) return;
  const original = /^Original: (https:\/\/github\.com\/[^\s]+)$/m.exec(body)?.[1];
  const path = /^File: ([^\r\n]{1,180})$/m.exec(body)?.[1];
  if (!original || !path) return;
  try {
    const url = new URL(original);
    const match = /^#(issuecomment|pullrequestreview)-(\d+)$/.exec(url.hash);
    const root = Number(match?.[2]);
    if (url.origin !== 'https://github.com' || url.pathname !== `/${repository}/pull/${number}` || url.search || !match || !positive(root)) return;
    return { root, rootKind: match[1] === 'issuecomment' ? 'issue' : 'review', path };
  } catch { return; }
}

export function ignoredReviewRequest(event: string | null, payload: Payload, slug: string): string | undefined {
  if (event !== 'issue_comment' || payload.action !== 'created' || !reviewableOddmash(payload.repository) || !positive(payload.installation?.id) || !maintainer(payload.sender) || !maintainer(payload.comment?.user) || !positive(payload.comment?.id) || !payload.issue?.pull_request || !positive(payload.issue.number)) return;
  const body = payload.comment.body;
  if (typeof body !== 'string' || !mentioned(body, slug)) return;
  if (body.length > 2000) return 'Review request exceeds 2000 characters';
  if (!reviewCommand(body, slug) && !conversationFixReference(body, slug, payload.repository!.full_name, payload.issue.number)) return 'Review command not recognized; put an explicit review command on the first line or reference the original finding for scoped verification';
}

export function route(event: string | null, p: Payload, slug = '', delivery = '', reviewerAppId = Number(process.env.REVIEWER_APP_ID)): Target | null {
  if (!reviewableOddmash(p.repository) || !positive(p.installation?.id)) return null;
  const repo = p.repository!;
  const target = { installation: p.installation!.id, repository: repo.full_name, repositoryId: repo.id, ...(repo.private ? { private: true } : {}) };
  if (event === 'pull_request' && ['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(p.action ?? '') && p.pull_request?.draft === false && positive(p.pull_request.number)) return { ...target, number: p.pull_request.number, ...(shaPattern.test(p.pull_request.head?.sha ?? '') ? { expectedHead: p.pull_request.head!.sha } : {}) };
  if (event === 'pull_request' && p.action === 'review_requested' && maintainer(p.sender) && p.requested_reviewer?.login === `${slug}[bot]` && p.requested_reviewer.type === 'Bot' && p.pull_request?.draft === false && positive(p.pull_request.number) && /^[a-f0-9-]{36}$/i.test(delivery)) return { ...target, number: p.pull_request.number, ...(shaPattern.test(p.pull_request.head?.sha ?? '') ? { expectedHead: p.pull_request.head!.sha } : {}), recheck: delivery };
  if (p.action === 'created' && maintainer(p.sender) && maintainer(p.comment?.user) && positive(p.comment?.id) && typeof p.comment.body === 'string' && p.comment.body.length <= 2000) {
    if (event === 'issue_comment' && p.issue?.pull_request && positive(p.issue.number) && impactCommand(p.comment.body, slug)) return { ...target, number: p.issue.number, impact: true, requestComment: { kind: 'issue', id: p.comment.id } };
    if (event === 'issue_comment' && p.issue?.pull_request && positive(p.issue.number) && reviewCommand(p.comment.body, slug)) return { ...target, number: p.issue.number, recheck: `comment-${p.comment.id}`, requestComment: { kind: 'issue', id: p.comment.id } };
    if (event === 'issue_comment' && p.issue?.pull_request && positive(p.issue.number)) {
      const reference = conversationFixReference(p.comment.body, slug, repo.full_name, p.issue.number);
      if (reference) return { ...target, number: p.issue.number, reply: { comment: p.comment.id, kind: 'conversation', ...reference } };
    }
    if (event === 'pull_request_review_comment' && p.pull_request?.draft === false && positive(p.pull_request.number) && positive(p.comment.in_reply_to_id) && mentioned(p.comment.body, slug)) return { ...target, number: p.pull_request.number, ...(reviewCommand(p.comment.body, slug) ? { recheck: `comment-${p.comment.id}`, requestComment: { kind: 'inline' as const, id: p.comment.id, root: p.comment.in_reply_to_id } } : { reply: { comment: p.comment.id, root: p.comment.in_reply_to_id } }) };
  }
  if (event === 'check_suite' && p.action === 'completed' && shaPattern.test(p.check_suite?.head_sha ?? '')) {
    if (positive(reviewerAppId) && p.check_suite?.app?.id === reviewerAppId) return null;
    return { ...target, sha: p.check_suite!.head_sha };
  }
  return null;
}

export function appJwt(appId: string, privateKey: string, now = Math.floor(Date.now() / 1000)): string {
  if (!/^\d+$/.test(appId) || !privateKey) throw new Error('Missing app configuration');
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iat: now - 60, exp: now + 540, iss: appId });
  return input + '.' + createSign('RSA-SHA256').update(input).sign(privateKey.replace(/\\n/g, '\n')).toString('base64url');
}

export function githubApi(token: string, request: typeof fetch = fetch) {
  return async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await request('https://api.github.com' + path, { ...init, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('GitHub request failed (' + response.status + ')');
    return response.status === 204 ? undefined as T : await response.json() as T;
  };
}

export async function reactToComment(api: ReturnType<typeof githubApi>, repository: string, comment: { kind: 'inline' | 'issue'; id: number }, content: 'eyes' | '+1') {
  const resource = comment.kind === 'inline' ? 'pulls' : 'issues';
  try {
    const result = await api<{ id?: number }>(`/repos/${repository}/${resource}/comments/${comment.id}/reactions`, { method: 'POST', body: JSON.stringify({ content }) });
    return positive(result?.id) ? result.id : undefined;
  } catch { console.warn('Reviewer comment reaction unavailable.'); }
}

export async function completeCommentReaction(api: ReturnType<typeof githubApi>, repository: string, comment: { kind: 'inline' | 'issue'; id: number }, eyesId: number | undefined, agreed: boolean) {
  if (agreed && !await reactToComment(api, repository, comment, '+1')) return;
  if (!positive(eyesId)) return;
  const resource = comment.kind === 'inline' ? 'pulls' : 'issues';
  try {
    await api(`/repos/${repository}/${resource}/comments/${comment.id}/reactions/${eyesId}`, { method: 'DELETE' });
  } catch { console.warn('Reviewer pending reaction cleanup unavailable.'); }
}

export async function authorize(target: Target, appId: string, key: string, request: typeof fetch = fetch, progress = false) {
  const jwtApi = githubApi(appJwt(appId, key), request);
  const installation = await jwtApi<{ account: { login: string }; suspended_at: string | null }>('/app/installations/' + target.installation);
  if (installation.account.login.toLowerCase() !== 'oddmash' || installation.suspended_at) throw new Error('Installation not eligible');
  const permissions = progress ? { checks: 'write' } : { contents: 'read', pull_requests: 'write', checks: 'read', issues: target.requestComment?.kind === 'issue' || target.reply?.kind === 'conversation' ? 'write' : 'read' };
  const result = await jwtApi<{ token: string }>('/app/installations/' + target.installation + '/access_tokens', { method: 'POST', body: JSON.stringify({ repository_ids: [target.repositoryId], permissions }) });
  const api = githubApi(result.token, request);
  const repository = await api<Repository>('/repos/' + target.repository);
  if (!reviewableOddmash(repository) || repository.private !== Boolean(target.private) || repository.id !== target.repositoryId || repository.full_name !== target.repository) throw new Error('Repository not eligible');
  return { api, token: result.token };
}

const publicMergeRepositories = new Set(['Oddmash/kowrap', 'Oddmash/oddmash-ui', 'Oddmash/interaction-inspector', 'Oddmash/Vertactics', 'Oddmash/boundra']);

export function mergeRepositoryAllowed(target: Target): boolean {
  return positive(target.repositoryId) && (target.private === true ? privateRepositoryAllowed(target.repository, target.repositoryId) : publicMergeRepositories.has(target.repository));
}

export async function authorizeMerge(target: Target, appId: string, key: string, request: typeof fetch = fetch) {
  if (!mergeRepositoryAllowed(target)) throw new Error('Merge target not eligible');
  const jwtApi = githubApi(appJwt(appId, key), request);
  const installation = await jwtApi<{ account: { login: string }; suspended_at: string | null }>('/app/installations/' + target.installation);
  if (installation.account.login.toLowerCase() !== 'oddmash' || installation.suspended_at) throw new Error('Installation not eligible');
  const result = await jwtApi<{ token: string; permissions: { contents?: string } }>('/app/installations/' + target.installation + '/access_tokens', { method: 'POST', body: JSON.stringify({ repository_ids: [target.repositoryId], permissions: { contents: 'write' } }) });
  if (result.permissions.contents !== 'write') throw new Error('Merge permission missing');
  return githubApi(result.token, request);
}
