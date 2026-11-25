import { AsyncLocalStorage } from 'node:async_hooks';
import type { ModelUsageSummary } from '../../../packages/operator-contract/src/index.ts';
import type { AdvisoryRole } from './advisory-agents.ts';

export type ModelPhase = 'review' | 'confirmation' | 'discussion' | AdvisoryRole;
export type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number };
const caps: Record<ModelPhase, readonly [number, number]> = {
  review: [512_000, 6000], confirmation: [512_000, 1000], discussion: [128_000, 1000],
  impact: [192_000, 1400], triage: [192_000, 1100], qa: [192_000, 1100],
  release: [192_000, 1100], docs: [192_000, 1100], architect: [192_000, 1100]
};

export function modelRole(phase: ModelPhase) {
  return phase === 'review' || phase === 'confirmation' || phase === 'discussion' ? 'reviewer' : phase;
}

function configuredCap(value: string | undefined, maximum: number, minimum: number) {
  if (!value || !/^\d+$/.test(value)) return maximum;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= minimum ? Math.min(limit, maximum) : maximum;
}

export function boundedModelBody<T extends { max_output_tokens: number }>(phase: ModelPhase, payload: T, env: Record<string, string | undefined> = process.env) {
  const [inputBytes, outputTokens] = caps[phase];
  const prefix = modelRole(phase).toUpperCase();
  const body = JSON.stringify({ ...payload, max_output_tokens: Math.min(payload.max_output_tokens, configuredCap(env[`${prefix}_MAX_OUTPUT_TOKENS`], outputTokens, 16)) });
  if (Buffer.byteLength(body, 'utf8') > configuredCap(env[`${prefix}_MAX_INPUT_BYTES`], inputBytes, 1)) throw new Error('Model input budget exceeded');
  return body;
}

export function usageEvent(phase: ModelPhase, model: string, usage?: Usage) {
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { event: 'reviewer_usage', role: modelRole(phase), phase, model: /^[a-zA-Z0-9_.:-]{1,100}$/.test(model) ? model : 'unknown', inputTokens: count(usage?.input_tokens), outputTokens: count(usage?.output_tokens), totalTokens: count(usage?.total_tokens) };
}

const activeUsage = new AsyncLocalStorage<ModelUsageSummary>();

export async function trackModelUsage<T>(action: () => Promise<T>, report: (usage: ModelUsageSummary) => void): Promise<T> {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, missingInput: 0, missingOutput: 0 };
  try { return await activeUsage.run(usage, action); }
  finally { if (usage.calls) report(usage); }
}

export function recordUsage(phase: ModelPhase, model: string, usage?: Usage) {
  const observed = usageEvent(phase, model, usage);
  console.log(JSON.stringify(observed));
  const current = activeUsage.getStore();
  if (!current) return;
  current.calls++;
  if (observed.inputTokens === null) current.missingInput++; else current.inputTokens += observed.inputTokens;
  if (observed.outputTokens === null) current.missingOutput++; else current.outputTokens += observed.outputTokens;
}
