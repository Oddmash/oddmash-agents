export function runtimeConfig() {
  const config = { appId: process.env.REVIEWER_APP_ID ?? '', key: process.env.REVIEWER_APP_PRIVATE_KEY ?? '', slug: process.env.REVIEWER_APP_SLUG ?? '', openaiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.OPENAI_MODEL ?? 'gpt-5.4', autoMerge: process.env.REVIEWER_AUTO_MERGE_ENABLED === 'true' };
  return process.env.REVIEWER_APP_ENABLED === 'true' && config.appId && config.key && config.slug && config.openaiKey ? config : null;
}
