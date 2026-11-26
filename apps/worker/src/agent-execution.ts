import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { publicTarget, type AgentRole, type ExecutionEvent, type ExecutionPhase, type ExecutionOutcome, type PublicTarget, type ModelUsageSummary, type SkipReason, type PublicationKind } from '../../../packages/operator-contract/src/index.ts';
import { operatorStoreConfig, writeOperatorEvent } from '../../../packages/operator-store/src/index.ts';
import { trackModelUsage } from './model-request.ts';
import { trackGitHubRequests } from './github-request.ts';
import { operatorSettings } from './runtime-config.ts';
import type { Target } from './webhook.ts';

export type { AgentRole } from '../../../packages/operator-contract/src/index.ts';
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

export function executionEvent(context: ExecutionContext, outcome: ExecutionOutcome, now: number, durationMs?: number, error?: unknown, phase?: ExecutionPhase): ExecutionEvent {
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

const activeExecution = new AsyncLocalStorage<{ context: ExecutionContext; emit: (event: ReturnType<typeof executionEvent>) => void; clock: () => number; skipped: boolean }>();

export function recordSkippedExecution(role: AgentRole, target: Pick<Target, 'repository' | 'number' | 'private'>, reason: SkipReason) {
  const active = activeExecution.getStore();
  const scope = publicTarget(target);
  if (!active || !scope) return;
  const context = executionContext(role, '', 1, scope);
  active.emit({ ...executionEvent(context, 'skipped', active.clock()), skipReason: reason });
}

export function recordCurrentExecutionSkipped(reason: SkipReason) {
  const active = activeExecution.getStore();
  if (!active) return;
  active.skipped = true;
  active.emit({ ...executionEvent(active.context, 'skipped', active.clock()), skipReason: reason });
}

export function publicationRecorder(target: Pick<Target, 'repository' | 'number' | 'private'>) {
  const origin = activeExecution.getStore()?.context;
  const scope = publicTarget(target);
  const context = origin && scope && (origin.target
    ? origin.target.repository.toLowerCase() === scope.repository.toLowerCase() && origin.target.number === scope.number ? origin : undefined
    : executionContext(origin.role, '', 1, scope));
  return (kind: PublicationKind, id: unknown) => {
    const active = activeExecution.getStore();
    if (!active || !context || typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return;
    active.emit({ ...executionEvent(context, 'published', active.clock()), publication: { kind, id } });
  };
}

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
  let usage: ModelUsageSummary | undefined;
  const execution = { context, emit: publish, clock, skipped: false };
  try {
    const result = await trackModelUsage(() => trackGitHubRequests(() => activeExecution.run(execution, action), counts => {
      if (!emit && counts.length) console.info(JSON.stringify({ event: 'oddmash_github_request_counts', role: context.role, correlationId: context.correlationId, attempt: context.attempt, counts }));
    }), observed => { usage = observed; });
    const end = clock();
    if (!execution.skipped) publish({ ...executionEvent(context, 'returned', end, end - start), ...(usage ? { usage } : {}) });
    return result;
  } catch (error) {
    const end = clock();
    publish({ ...executionEvent(context, 'failed', end, end - start, error), ...(usage ? { usage } : {}) });
    throw error;
  } finally {
    await Promise.allSettled(pending);
  }
}
