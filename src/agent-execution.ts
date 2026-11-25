import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { publicTarget, type AgentRole, type ExecutionPhase, type ExecutionOutcome, type PublicTarget } from '../packages/operator-contract/src/index.ts';
import { operatorStoreConfig, writeOperatorEvent } from '../packages/operator-store/src/index.ts';
import { operatorSettings } from './runtime-config.ts';
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

async function persistEvent(event: ReturnType<typeof executionEvent>) {
  const config = operatorStoreConfig(process.env.OPERATOR_STORE_URL, process.env.OPERATOR_STORE_WRITE_TOKEN);
  if (!config) return;
  try { await writeOperatorEvent(config, event, operatorSettings()); } catch { console.warn('Operator telemetry unavailable'); }
}

export async function recordQueued(context: ExecutionContext) {
  const event = executionEvent(context, 'queued', Date.now());
  console.info(JSON.stringify(event));
  await persistEvent(event);
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

export async function runAgentExecution<T>(context: ExecutionContext, action: () => Promise<T>, emit?: (event: ReturnType<typeof executionEvent>) => void, clock = Date.now): Promise<T> {
  const pending: Promise<void>[] = [];
  const publish = emit ?? ((event: ReturnType<typeof executionEvent>) => { console.info(JSON.stringify(event)); pending.push(persistEvent(event)); });
  const start = clock();
  publish(executionEvent(context, 'started', start));
  try {
    const result = await activeExecution.run({ context, emit: publish, clock }, action);
    const end = clock();
    publish(executionEvent(context, 'returned', end, end - start));
    return result;
  } catch (error) {
    const end = clock();
    publish(executionEvent(context, 'failed', end, end - start, error));
    throw error;
  } finally {
    await Promise.allSettled(pending);
  }
}
