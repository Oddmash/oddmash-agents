export const roles = ['reviewer', 'impact', 'triage', 'qa', 'release', 'docs', 'architect'] as const;
export type AgentRole = typeof roles[number];
export const phases = ['collecting-changes', 'collecting-context', 'reviewing', 'validating', 'specialist-review', 'publishing', 'verifying-findings'] as const;
export type ExecutionPhase = typeof phases[number];
export type PublicTarget = { repository: string; number: number };
export type ExecutionOutcome = 'queued' | 'started' | 'phase' | 'returned' | 'failed';
export type ExecutionEvent = {
  event: 'oddmash_agent_execution'; role: AgentRole; correlationId: string; attempt: number; retryCount: number;
  timestamp: string; outcome: ExecutionOutcome; durationMs?: number; failure?: string; target?: PublicTarget; phase?: ExecutionPhase;
};
export type JobState = 'queued' | 'running' | 'returned' | 'failed' | 'stale';
export type Job = { role: AgentRole; correlationId: string; attempt: number; state: JobState; updatedAt: string; target?: PublicTarget; phase?: ExecutionPhase; durationMs?: number; failure?: string };
export type AgentSettings = { role: AgentRole; enabled: boolean; configured: boolean; model: string | null; autoMerge: boolean };
export type WorkerSettings = { queueEnabled: boolean; coordinatedAdvisoriesEnabled: boolean; agents: AgentSettings[] };

const outcomes = ['queued', 'started', 'phase', 'returned', 'failed'] as const;
const failures = ['budget', 'model-quota', 'github', 'model', 'pending', 'configuration', 'unexpected'];
const rank = { queued: 0, started: 1, phase: 2, returned: 3, failed: 3 };

export function publicTarget(input: unknown): PublicTarget | undefined {
  if (!input || typeof input !== 'object') return;
  const { repository, number, private: privateRepository } = input as Record<string, unknown>;
  if (privateRepository === true || typeof repository !== 'string' || !/^Oddmash\/[A-Za-z0-9_.-]{1,100}$/.test(repository) || typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) return;
  return { repository, number };
}

export function modelName(input: unknown): string | null {
  return typeof input === 'string' && /^(?:gpt|o[1-9]|chatgpt)[a-z0-9.-]{0,75}$/i.test(input) ? input : null;
}

export function parseExecutionEvent(input: unknown): ExecutionEvent | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  if (value.event !== 'oddmash_agent_execution' || !roles.includes(value.role as AgentRole) || !outcomes.includes(value.outcome as ExecutionOutcome) || typeof value.correlationId !== 'string' || !/^[a-f0-9]{24}$/.test(value.correlationId) || typeof value.attempt !== 'number' || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))) return;
  const phase = phases.includes(value.phase as ExecutionPhase) ? value.phase as ExecutionPhase : undefined;
  if (value.outcome === 'phase' && !phase) return;
  const target = publicTarget(value.target);
  const failure = typeof value.failure === 'string' && failures.includes(value.failure) ? value.failure : undefined;
  const durationMs = typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0 ? value.durationMs : undefined;
  return { event: 'oddmash_agent_execution', role: value.role as AgentRole, correlationId: value.correlationId, attempt: value.attempt, retryCount: value.attempt - 1, timestamp: new Date(value.timestamp).toISOString(), outcome: value.outcome as ExecutionOutcome, ...(target ? { target } : {}), ...(phase ? { phase } : {}), ...(durationMs === undefined ? {} : { durationMs }), ...(failure ? { failure } : {}) };
}

export function projectJobs(inputs: readonly unknown[], now: number, staleAfterMs = 360_000): Job[] {
  const events = inputs.slice(-2000).map(parseExecutionEvent).filter((event): event is ExecutionEvent => Boolean(event));
  events.sort((a, b) => a.attempt - b.attempt || Date.parse(a.timestamp) - Date.parse(b.timestamp) || rank[a.outcome] - rank[b.outcome]);
  const jobs = new Map<string, Job>();
  for (const event of events) {
    const key = `${event.role}:${event.correlationId}`;
    const previous = jobs.get(key);
    const sameAttempt = previous?.attempt === event.attempt;
    if (sameAttempt && previous && ['returned', 'failed'].includes(previous.state)) continue;
    const state: JobState = event.outcome === 'started' || event.outcome === 'phase' ? 'running' : event.outcome;
    if (sameAttempt && previous?.state === 'running' && state === 'queued') continue;
    const target = event.target ?? (sameAttempt ? previous?.target : undefined);
    const phase = event.phase ?? (sameAttempt ? previous?.phase : undefined);
    jobs.set(key, { role: event.role, correlationId: event.correlationId, attempt: event.attempt, state, updatedAt: event.timestamp, ...(target ? { target } : {}), ...(phase ? { phase } : {}), ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }), ...(event.failure ? { failure: event.failure } : {}) });
  }
  return [...jobs.values()].map(job => ['queued', 'running'].includes(job.state) && now - Date.parse(job.updatedAt) > staleAfterMs ? { ...job, state: 'stale' as const } : job).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
