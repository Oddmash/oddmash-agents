import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { publicTarget, type AgentRole, type ExecutionPhase, type ExecutionOutcome, type PublicTarget } from '../packages/operator-contract/src/index.ts';
import type { Target } from './webhook.ts';

export type { AgentRole } from '../packages/operator-contract/src/index.ts';
type ExecutionContext = { role: AgentRole; correlationId: string; attempt: number; target?: PublicTarget };

export function executionRole(target: Pick<Target, 'impact' | 'advisory'>): AgentRole {
  return target.impact ? 'impact' : target.advisory ?? 'reviewer';
}

export function executionContext(role: AgentRole, delivery: string, attempt = 1, target?: Pick<Target, 'repository' | 'number' | 'private'>): ExecutionContext {
  const id = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(delivery) ? delivery.toLowerCase() : randomUUID();
  const scope = publicTarget(target);
  return { role, ...(scope ? { target: scope } : {}), correlationId: createHash('sha256').update(`${role}:${id}`).digest('hex').slice(0, 24), attempt: Number.isSafeInteger(attempt) && attempt >= 1 ? attempt : 1 };
}

export function failureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Model input budget exceeded') return 'budget';
  if (message === 'Model quota, rate or credit limit reached; stop and check API billing before retrying') return 'model-quota';
  if (/^GitHub request failed \(\d{3}\)$/.test(message)) return 'github';
  if (/^Model request failed \(\d{3}\)$/.test(message)) return 'model';
  if (message === 'Pending review active') return 'pending';
  if (['Missing app configuration', 'Installation not eligible', 'Repository not eligible'].includes(message)) return 'configuration';
  return 'unexpected';
}

export function executionEvent(context: ExecutionContext, outcome: ExecutionOutcome, now: number, durationMs?: number, error?: unknown, phase?: ExecutionPhase) {
  return { event: 'oddmash_agent_execution', ...context, retryCount: context.attempt - 1, timestamp: new Date(now).toISOString(), outcome, ...(durationMs === undefined ? {} : { durationMs: Math.max(0, durationMs) }), ...(phase ? { phase } : {}), ...(outcome === 'failed' ? { failure: failureCategory(error) } : {}) };
}

export function recordQueued(context: ExecutionContext) {
  console.info(JSON.stringify(executionEvent(context, 'queued', Date.now())));
}

const activeExecution = new AsyncLocalStorage<{ context: ExecutionContext; emit: (event: ReturnType<typeof executionEvent>) => void; clock: () => number }>();

export function recordReviewPhase(title: string) {
  const phase: ExecutionPhase | undefined = title === 'Collecting changes' ? 'collecting-changes'
    : title === 'Collecting review context' ? 'collecting-context'
    : title === 'Reviewing changes' ? 'reviewing'
    : title === 'Validating findings' ? 'validating'
    : title.startsWith('Specialist review in progress (') ? 'specialist-review'
    : title === 'Publishing review' ? 'publishing'
    : title === 'Verifying earlier findings' ? 'verifying-findings' : undefined;
  const active = activeExecution.getStore();
  if (active && phase) active.emit(executionEvent(active.context, 'phase', active.clock(), undefined, undefined, phase));
}

export async function runAgentExecution<T>(context: ExecutionContext, action: () => Promise<T>, emit = (event: ReturnType<typeof executionEvent>) => console.info(JSON.stringify(event)), clock = Date.now): Promise<T> {
  const start = clock();
  emit(executionEvent(context, 'started', start));
  try {
    const result = await activeExecution.run({ context, emit, clock }, action);
    const end = clock();
    emit(executionEvent(context, 'returned', end, end - start));
    return result;
  } catch (error) {
    const end = clock();
    emit(executionEvent(context, 'failed', end, end - start, error));
    throw error;
  }
}
