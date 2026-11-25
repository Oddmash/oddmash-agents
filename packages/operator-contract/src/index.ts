export const roles = ['reviewer', 'impact', 'triage', 'qa', 'release', 'docs', 'architect'] as const;
export type AgentRole = typeof roles[number];
export const phases = ['collecting-changes', 'collecting-context', 'reviewing', 'validating', 'specialist-review', 'publishing', 'verifying-findings'] as const;
export type ExecutionPhase = typeof phases[number];
export type PublicTarget = { repository: string; number: number };
export type ExecutionOutcome = 'queued' | 'started' | 'phase' | 'returned' | 'failed';
export type ModelUsageSummary = { calls: number; inputTokens: number; outputTokens: number; missingInput: number; missingOutput: number };
export type ExecutionEvent = {
  event: 'oddmash_agent_execution'; role: AgentRole; correlationId: string; attempt: number; retryCount: number;
  timestamp: string; outcome: ExecutionOutcome; usage?: ModelUsageSummary; durationMs?: number; failure?: string; target?: PublicTarget; phase?: ExecutionPhase;
};
export type JobState = 'queued' | 'running' | 'returned' | 'failed' | 'stale';
export type PhaseObservation = { phase: ExecutionPhase; timestamp: string };
export type Job = { role: AgentRole; correlationId: string; attempt: number; state: JobState; updatedAt: string; startedAt?: string; queuedAt?: string; finishedAt?: string; target?: PublicTarget; phase?: ExecutionPhase; phaseHistory?: PhaseObservation[]; durationMs?: number; failure?: string; usage?: ModelUsageSummary };
export type AgentSettings = { role: AgentRole; enabled: boolean; configured: boolean; model: string | null; autoMerge: boolean };
export type WorkerSettings = { queueEnabled: boolean; coordinatedAdvisoriesEnabled: boolean; authenticatedGuidanceEnabled?: boolean; scopedThreadResolutionEnabled?: boolean; advisoryMaxRequests?: number; advisoryMaxMs?: number; agents: AgentSettings[] };

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

export function parseModelUsage(input: unknown): ModelUsageSummary | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000;
  const { calls, inputTokens, outputTokens, missingInput, missingOutput } = value;
  if (!integer(calls) || calls === 0 || !integer(inputTokens) || !integer(outputTokens) || !integer(missingInput) || !integer(missingOutput) || missingInput > calls || missingOutput > calls) return;
  return { calls, inputTokens, outputTokens, missingInput, missingOutput };
}

export function projectModelUsage(inputs: readonly unknown[]) {
  const rows = new Map<AgentRole, ModelUsageSummary>();
  const seen = new Set<string>();
  for (const input of inputs.slice(0, 500)) {
    const event = parseExecutionEvent(input);
    if (!event?.usage || !['returned', 'failed'].includes(event.outcome)) continue;
    const key = event.role + ':' + event.correlationId + ':' + event.attempt;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = rows.get(event.role) ?? { calls: 0, inputTokens: 0, outputTokens: 0, missingInput: 0, missingOutput: 0 };
    for (const field of ['calls', 'inputTokens', 'outputTokens', 'missingInput', 'missingOutput'] as const) row[field] += event.usage[field];
    rows.set(event.role, row);
  }
  return roles.flatMap(role => rows.has(role) ? [{ role, ...rows.get(role)! }] : []);
}

export function parseExecutionEvent(input: unknown): ExecutionEvent | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  if (value.event !== 'oddmash_agent_execution' || !roles.includes(value.role as AgentRole) || !outcomes.includes(value.outcome as ExecutionOutcome) || typeof value.correlationId !== 'string' || !/^[a-f0-9]{24}$/.test(value.correlationId) || typeof value.attempt !== 'number' || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))) return;
  const phase = phases.includes(value.phase as ExecutionPhase) ? value.phase as ExecutionPhase : undefined;
  if (value.outcome === 'phase' && !phase) return;
  const target = publicTarget(value.target);
  const usage = ['returned', 'failed'].includes(value.outcome as string) ? parseModelUsage(value.usage) : undefined;
  const failure = typeof value.failure === 'string' && failures.includes(value.failure) ? value.failure : undefined;
  const durationMs = typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0 ? value.durationMs : undefined;
  return { event: 'oddmash_agent_execution', role: value.role as AgentRole, correlationId: value.correlationId, attempt: value.attempt, retryCount: value.attempt - 1, timestamp: new Date(value.timestamp).toISOString(), outcome: value.outcome as ExecutionOutcome, ...(target ? { target } : {}), ...(usage ? { usage } : {}), ...(phase ? { phase } : {}), ...(durationMs === undefined ? {} : { durationMs }), ...(failure ? { failure } : {}) };
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
    const startedAt = event.outcome === 'started' ? event.timestamp : sameAttempt ? previous?.startedAt : undefined;
    const queuedAt = event.outcome === 'queued' ? (sameAttempt ? previous?.queuedAt ?? event.timestamp : event.timestamp) : sameAttempt ? previous?.queuedAt : undefined;
    const finishedAt = event.outcome === 'returned' || event.outcome === 'failed' ? event.timestamp : undefined;
    const phaseHistory = sameAttempt ? [...(previous?.phaseHistory ?? [])] : [];
    if (event.outcome === 'phase' && event.phase && phaseHistory.at(-1)?.phase !== event.phase) phaseHistory.push({ phase: event.phase, timestamp: event.timestamp });
    jobs.set(key, { role: event.role, correlationId: event.correlationId, attempt: event.attempt, state, updatedAt: event.timestamp, ...(startedAt ? { startedAt } : {}), ...(queuedAt ? { queuedAt } : {}), ...(finishedAt ? { finishedAt } : {}), ...(phaseHistory.length ? { phaseHistory: phaseHistory.slice(-16) } : {}), ...(event.usage ? { usage: event.usage } : {}), ...(target ? { target } : {}), ...(phase ? { phase } : {}), ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }), ...(event.failure ? { failure: event.failure } : {}) });
  }
  return [...jobs.values()].map(job => ['queued', 'running'].includes(job.state) && now - Date.parse(job.updatedAt) > staleAfterMs ? { ...job, state: 'stale' as const } : job).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function parseWorkerSettings(input: unknown): WorkerSettings | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  if (typeof value.queueEnabled !== 'boolean' || typeof value.coordinatedAdvisoriesEnabled !== 'boolean' || !Array.isArray(value.agents) || value.agents.length !== roles.length) return;
  const agents: AgentSettings[] = [];
  for (const role of roles) {
    const matches = value.agents.filter(item => item && typeof item === 'object' && item.role === role);
    if (matches.length !== 1) return;
    const agent = matches[0];
    if (typeof agent.enabled !== 'boolean' || typeof agent.configured !== 'boolean' || typeof agent.autoMerge !== 'boolean') return;
    agents.push({ role, enabled: agent.enabled, configured: agent.configured, model: modelName(agent.model), autoMerge: role === 'reviewer' && agent.autoMerge });
  }
  return { queueEnabled: value.queueEnabled, coordinatedAdvisoriesEnabled: value.coordinatedAdvisoriesEnabled, ...(typeof value.authenticatedGuidanceEnabled === 'boolean' ? { authenticatedGuidanceEnabled: value.authenticatedGuidanceEnabled } : {}), ...(typeof value.scopedThreadResolutionEnabled === 'boolean' ? { scopedThreadResolutionEnabled: value.scopedThreadResolutionEnabled } : {}), ...(typeof value.advisoryMaxRequests === 'number' && Number.isInteger(value.advisoryMaxRequests) && value.advisoryMaxRequests >= 0 && value.advisoryMaxRequests <= 5 ? { advisoryMaxRequests: value.advisoryMaxRequests } : {}), ...(typeof value.advisoryMaxMs === 'number' && Number.isInteger(value.advisoryMaxMs) && value.advisoryMaxMs >= 0 && value.advisoryMaxMs <= 120000 ? { advisoryMaxMs: value.advisoryMaxMs } : {}), agents };
}

export function isUnfinishedJob(job: Pick<Job, 'state'>): boolean {
  return job.state === 'queued' || job.state === 'running' || job.state === 'stale';
}

export function jobElapsedMs(job: Job, observedAt: string): number | undefined {
  if (job.durationMs !== undefined) return job.durationMs;
  if (!isUnfinishedJob(job)) {
    const start = Date.parse(job.startedAt ?? '');
    const end = Date.parse(job.finishedAt ?? '');
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
  }
  const start = Date.parse((job.state === 'queued' ? job.queuedAt : job.state === 'running' ? job.startedAt : job.startedAt ?? (!job.phase ? job.queuedAt : undefined)) ?? '');
  const now = Date.parse(observedAt);
  return Number.isFinite(start) && Number.isFinite(now) ? Math.max(0, now - start) : undefined;
}

export * from './controls.ts';
