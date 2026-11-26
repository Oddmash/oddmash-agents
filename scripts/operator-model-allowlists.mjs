const roles = ['REVIEWER', 'IMPACT', 'TRIAGE', 'QA', 'RELEASE', 'DOCS', 'ARCHITECT'];
const approved = role => role === 'REVIEWER' ? ['gpt-6.2-sol'] : ['gpt-5.4-mini', 'gpt-6.2-sol'];

export function operatorModelAllowlistEntries(env) {
  return roles.flatMap(role => {
    const key = `${role}_OPERATOR_ALLOWED_MODELS`;
    const value = env[key]?.trim();
    if (!value) return [];
    const models = [...new Set(value.split(',').map(model => model.trim()))];
    if (!models.every(model => approved(role).includes(model))) throw new Error(`Unsupported approved model configuration: ${key}`);
    return [{ key, value: models.join(','), type: 'plain' }];
  });
}
