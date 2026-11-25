import type { AgentRole } from './index.ts';

export const modelRoles = ['reviewer', 'impact', 'triage', 'qa', 'release', 'docs', 'architect'] as const satisfies readonly AgentRole[];
export type ModelOverrides = Partial<Record<AgentRole, string>>;
export type OperatorModelsRecord = { revision: string | null; overrides: ModelOverrides; updatedAt: string | null };
export type ModelPolicy = Record<AgentRole, { defaultModel: string | null; allowed: string[] }>;
export type OperatorModelsResponse = OperatorModelsRecord & { policy: ModelPolicy };

const safeModel = (value: unknown): value is string => typeof value === 'string' && /^(?:gpt|o[1-9]|chatgpt)[a-z0-9.-]{0,75}$/i.test(value);
const validRevision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export function parseModelOverrides(input: unknown): ModelOverrides | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(role => !modelRoles.includes(role as AgentRole) || !safeModel(value[role]))) return;
  const result: ModelOverrides = {};
  for (const role of modelRoles) if (Object.hasOwn(value, role)) result[role] = value[role] as string;
  return result;
}

export function parseOperatorModelsRecord(input: unknown): OperatorModelsRecord | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  const overrides = parseModelOverrides(value.overrides);
  if (Object.keys(value).length !== 3 || !overrides || !validRevision(value.revision) || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return;
  return { revision: value.revision, overrides, updatedAt: value.updatedAt };
}

export function modelPolicy(env: Readonly<Record<string, string | undefined>>): ModelPolicy {
  const shared = env.OPENAI_MODEL ?? 'gpt-5.4';
  return Object.fromEntries(modelRoles.map(role => {
    const defaultValue = role === 'reviewer' ? shared : env[role.toUpperCase() + '_OPENAI_MODEL'] || shared;
    const defaultModel = safeModel(defaultValue) ? defaultValue : null;
    const allowed = [...new Set((env[role.toUpperCase() + '_OPERATOR_ALLOWED_MODELS'] ?? '').split(',').slice(0, 16).map(model => model.trim()).filter(safeModel))];
    return [role, { defaultModel, allowed }];
  })) as ModelPolicy;
}

export function approvedModelOverrides(overrides: ModelOverrides, policy: ModelPolicy): boolean {
  return modelRoles.every(role => !Object.hasOwn(overrides, role) || policy[role].allowed.includes(overrides[role]!));
}

export function effectiveOperatorModel(role: AgentRole, deploymentModel: string, overrides: ModelOverrides, policy: ModelPolicy): string {
  const model = overrides[role];
  return model && policy[role].allowed.includes(model) ? model : deploymentModel;
}
