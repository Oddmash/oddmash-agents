import { modelName, type WorkerSettings } from '../../../packages/operator-contract/src/index.ts';
import { effectiveOperatorModel, modelPolicy, modelRoles, type ModelOverrides } from '../../../packages/operator-contract/src/model-settings.ts';
import { operatorStoreConfig, readOperatorModels } from '../../../packages/operator-store/src/index.ts';
import { automaticAdvisoryBudget } from './review-follow-up-policy.ts';
import { advisoryRoles, isAdvisoryRole, type AdvisoryRole } from './advisory-agents.ts';

export function advisoryModelConfig(role: AdvisoryRole, fallback: { openaiKey: string; model: string }, overrides: ModelOverrides = {}) {
  const prefix = role.toUpperCase();
  return { openaiKey: process.env[`${prefix}_OPENAI_API_KEY`] || fallback.openaiKey, model: effectiveOperatorModel(role, process.env[`${prefix}_OPENAI_MODEL`] || fallback.model, overrides, modelPolicy(process.env)) };
}

export function advisoryConfig(role: unknown, overrides: ModelOverrides = {}) {
  if (!isAdvisoryRole(role)) return null;
  const prefix = role.toUpperCase();
  const config = { appId: process.env[`${prefix}_APP_ID`] ?? '', key: process.env[`${prefix}_APP_PRIVATE_KEY`] ?? '', slug: `oddmash-${role}`, ...advisoryModelConfig(role, { openaiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.OPENAI_MODEL ?? 'gpt-5.4' }, overrides), autoMerge: false, secret: process.env[`${prefix}_WEBHOOK_SECRET`] ?? '' };
  const distinct = config.appId !== process.env.REVIEWER_APP_ID && config.secret !== process.env.REVIEWER_WEBHOOK_SECRET && !advisoryRoles.some(other => other !== role && (process.env[`${other.toUpperCase()}_APP_ID`] === config.appId || process.env[`${other.toUpperCase()}_WEBHOOK_SECRET`] === config.secret));
  return process.env[`${prefix}_APP_ENABLED`] === 'true' && /^\d+$/.test(config.appId) && distinct && config.key && config.openaiKey && config.secret ? config : null;
}

export function runtimeConfig() {
  const config = { appId: process.env.REVIEWER_APP_ID ?? '', key: process.env.REVIEWER_APP_PRIVATE_KEY ?? '', slug: process.env.REVIEWER_APP_SLUG ?? '', openaiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.OPENAI_MODEL ?? 'gpt-5.4', autoMerge: process.env.REVIEWER_AUTO_MERGE_ENABLED === 'true' };
  return process.env.REVIEWER_APP_ENABLED === 'true' && config.appId && config.key && config.slug && config.openaiKey ? config : null;
}

export function operatorSettings(): WorkerSettings {
  const lead = runtimeConfig();
  const budget = automaticAdvisoryBudget();
  return {
    queueEnabled: process.env.REVIEWER_QUEUE_ENABLED === 'true',
    coordinatedAdvisoriesEnabled: process.env.REVIEWER_AUTO_ADVISORY_ENABLED === 'true',
    authenticatedGuidanceEnabled: process.env.REVIEWER_AUTHENTICATED_GUIDANCE_ENABLED === 'true',
    scopedThreadResolutionEnabled: process.env.REVIEWER_SCOPED_THREAD_RESOLVE_ENABLED === 'true',
    advisoryMaxRequests: budget.maxRequests,
    advisoryMaxMs: budget.elapsedMs,
    agents: [
      { role: 'reviewer', enabled: process.env.REVIEWER_APP_ENABLED === 'true', configured: Boolean(lead), model: modelName(process.env.OPENAI_MODEL ?? 'gpt-5.4'), autoMerge: lead?.autoMerge === true },
      ...advisoryRoles.map(role => ({
        role, enabled: process.env[`${role.toUpperCase()}_APP_ENABLED`] === 'true',
        configured: Boolean(advisoryConfig(role)),
        model: modelName(advisoryModelConfig(role, { openaiKey: '', model: process.env.OPENAI_MODEL ?? 'gpt-5.4' }).model),
        autoMerge: false
      }))
    ]
  };
}

export async function readReviewModelOverrides(env: Readonly<Record<string, string | undefined>> = process.env, request = fetch): Promise<ModelOverrides> {
  const policy = modelPolicy(env);
  if (!modelRoles.some(role => policy[role].allowed.length > 0)) return {};
  const config = operatorStoreConfig(env.OPERATOR_STORE_URL, env.OPERATOR_STORE_READ_TOKEN);
  if (!config) return {};
  try { return (await readOperatorModels(config, request)).overrides; }
  catch { console.warn('Operator model settings unavailable; using deployment defaults'); return {}; }
}
