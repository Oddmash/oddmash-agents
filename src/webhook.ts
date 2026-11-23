import { createHmac, timingSafeEqual, createSign } from 'node:crypto';

type Repository = { id: number; full_name: string; private: boolean; visibility: string; owner: { login: string }; archived?: boolean };
type Payload = { action?: string; installation?: { id: number }; repository?: Repository; pull_request?: { number: number; draft: boolean }; check_suite?: { head_sha: string; pull_requests?: { number: number }[] } };
export type Target = { installation: number; repository: string; repositoryId: number; number?: number; sha?: string };
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

export function route(event: string | null, p: Payload): Target | null {
  if (!publicOddmash(p.repository) || !positive(p.installation?.id)) return null;
  const repo = p.repository!;
  const target = { installation: p.installation!.id, repository: repo.full_name, repositoryId: repo.id };
  if (event === 'pull_request' && ['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(p.action ?? '') && p.pull_request?.draft === false && positive(p.pull_request.number)) return { ...target, number: p.pull_request.number };
  if (event === 'check_suite' && p.action === 'completed' && shaPattern.test(p.check_suite?.head_sha ?? '')) return { ...target, sha: p.check_suite!.head_sha };
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

export async function authorize(target: Target, appId: string, key: string, request: typeof fetch = fetch) {
  const jwtApi = githubApi(appJwt(appId, key), request);
  const installation = await jwtApi<{ account: { login: string }; suspended_at: string | null }>('/app/installations/' + target.installation);
  if (installation.account.login.toLowerCase() !== 'oddmash' || installation.suspended_at) throw new Error('Installation not eligible');
  const result = await jwtApi<{ token: string }>('/app/installations/' + target.installation + '/access_tokens', { method: 'POST', body: JSON.stringify({ repository_ids: [target.repositoryId], permissions: { contents: 'read', pull_requests: 'write', checks: 'read' } }) });
  const api = githubApi(result.token, request);
  const repository = await api<Repository>('/repos/' + target.repository);
  if (!publicOddmash(repository) || repository.id !== target.repositoryId || repository.full_name !== target.repository) throw new Error('Repository not eligible');
  return { api, token: result.token };
}

export async function authorizeMerge(target: Target, appId: string, key: string, request: typeof fetch = fetch) {
  if (!['Oddmash/kowrap', 'Oddmash/oddmash-ui', 'Oddmash/interaction-inspector', 'Oddmash/Vertactics'].includes(target.repository) || !positive(target.repositoryId)) throw new Error('Merge target not eligible');
  const jwtApi = githubApi(appJwt(appId, key), request);
  const installation = await jwtApi<{ account: { login: string }; suspended_at: string | null }>('/app/installations/' + target.installation);
  if (installation.account.login.toLowerCase() !== 'oddmash' || installation.suspended_at) throw new Error('Installation not eligible');
  const result = await jwtApi<{ token: string; permissions: { contents?: string } }>('/app/installations/' + target.installation + '/access_tokens', { method: 'POST', body: JSON.stringify({ repository_ids: [target.repositoryId], permissions: { contents: 'write' } }) });
  if (result.permissions.contents !== 'write') throw new Error('Merge permission missing');
  return githubApi(result.token, request);
}
