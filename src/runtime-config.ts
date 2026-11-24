import { advisoryRoles, isAdvisoryRole } from './advisory-agents.ts';

export function advisoryConfig(role: unknown) {
  if (!isAdvisoryRole(role)) return null;
  const prefix = role.toUpperCase();
  const config = { appId: process.env[`${prefix}_APP_ID`] ?? '', key: process.env[`${prefix}_APP_PRIVATE_KEY`] ?? '', slug: `oddmash-${role}`, openaiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.OPENAI_MODEL ?? 'gpt-5.4', autoMerge: false, secret: process.env[`${prefix}_WEBHOOK_SECRET`] ?? '' };
  const distinct = config.appId !== process.env.REVIEWER_APP_ID && config.secret !== process.env.REVIEWER_WEBHOOK_SECRET && !advisoryRoles.some(other => other !== role && (process.env[`${other.toUpperCase()}_APP_ID`] === config.appId || process.env[`${other.toUpperCase()}_WEBHOOK_SECRET`] === config.secret));
  return process.env[`${prefix}_APP_ENABLED`] === 'true' && /^\d+$/.test(config.appId) && distinct && config.key && config.openaiKey && config.secret ? config : null;
}

export function runtimeConfig() {
  const config = { appId: process.env.REVIEWER_APP_ID ?? '', key: process.env.REVIEWER_APP_PRIVATE_KEY ?? '', slug: process.env.REVIEWER_APP_SLUG ?? '', openaiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.OPENAI_MODEL ?? 'gpt-5.4', autoMerge: process.env.REVIEWER_AUTO_MERGE_ENABLED === 'true' };
  return process.env.REVIEWER_APP_ENABLED === 'true' && config.appId && config.key && config.slug && config.openaiKey ? config : null;
}
