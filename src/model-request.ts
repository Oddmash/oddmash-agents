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

export function boundedModelBody(phase: ModelPhase, payload: { max_output_tokens: number }, env: Record<string, string | undefined> = process.env) {
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

export function recordUsage(phase: ModelPhase, model: string, usage?: Usage) {
  console.log(JSON.stringify(usageEvent(phase, model, usage)));
}
