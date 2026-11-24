import { advisoryConfig } from './runtime-config.ts';
import { type AdvisoryRole } from './advisory-agents.ts';
import { appJwt, authorize, githubApi, privateRepositoryAllowed, type Target } from './webhook.ts';

export async function authorizeCoordinatedAdvisor(target: Target, role: AdvisoryRole, reviewerAppId: string, request: typeof fetch = fetch) {
  if (role === 'triage' || !/^Oddmash\/[a-z0-9_.-]+$/i.test(target.repository) || !Number.isSafeInteger(target.repositoryId) || target.repositoryId <= 0 || (target.private && !privateRepositoryAllowed(target.repository, target.repositoryId))) return;
  const config = advisoryConfig(role);
  if (!config || Number(config.appId) === Number(reviewerAppId)) return;
  const app = githubApi(appJwt(config.appId, config.key), request);
  const installation = await app<{ id: number; app_id: number; suspended_at: string | null }>(`/repos/${target.repository}/installation`);
  if (!Number.isSafeInteger(installation.id) || installation.id <= 0 || installation.app_id !== Number(config.appId) || installation.suspended_at) throw new Error('Installation not eligible');
  const advisor: Target = { installation: installation.id, repository: target.repository, repositoryId: target.repositoryId, private: target.private, number: target.number, expectedHead: target.expectedHead, advisory: role, advisoryIdentity: role, ...(role === 'impact' ? { impact: true as const } : {}) };
  const { api } = await authorize(advisor, config.appId, config.key, request);
  return { api, target: advisor, config: { bot: config.slug + '[bot]', model: config.model, openaiKey: config.openaiKey } };
}
