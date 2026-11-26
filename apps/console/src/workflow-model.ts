import type { AgentRole, Job, JobState, PublicTarget } from '@oddmash/agent-operator-contract';

export const specialistRoles = ['impact', 'qa', 'docs', 'architect', 'release'] as const;
export type WorkflowRole = AgentRole;
export type WorkflowState = JobState;
export type ObservedJob = Job;

export const workflowRoles: readonly WorkflowRole[] = ['triage', 'reviewer', ...specialistRoles];

export const targetObservations = (target: PublicTarget, jobs: readonly ObservedJob[]): ObservedJob[] =>
  jobs.filter(job => job.target?.repository.toLowerCase() === target.repository.toLowerCase() && job.target.number === target.number)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export const roleObservations = (role: WorkflowRole, jobs: readonly ObservedJob[]) => jobs.filter(job => job.role === role);

export const stateCounts = (jobs: readonly ObservedJob[]) => {
  const counts: Partial<Record<WorkflowState, number>> = {};
  for (const job of jobs) {
    const state = job.state;
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
};

export const publicationObservations = (jobs: readonly ObservedJob[]) => jobs.filter(job => job.publication !== undefined);
export const publicationPhaseObserved = (jobs: readonly ObservedJob[]) => jobs.some(job => job.phase === 'publishing' || job.phaseHistory?.some(entry => entry.phase === 'publishing'));
export const publicationStageObservations = (jobs: readonly ObservedJob[]) => jobs.filter(job => job.publication !== undefined || publicationPhaseObserved([job]));

export function publicationLink(target: PublicTarget, job: ObservedJob): string | undefined {
  const result = job.publication;
  if (!job.target || job.target.repository.toLowerCase() !== target.repository.toLowerCase() || job.target.number !== target.number) return;
  if (!result || !Number.isSafeInteger(result.id) || (result.id ?? 0) <= 0) return;
  return 'https://github.com/' + target.repository + (result.kind === 'review' ? '/pull/' + target.number + '#pullrequestreview-' : result.kind === 'inline-comment' ? '/pull/' + target.number + '#discussion_r' : '/issues/' + target.number + '#issuecomment-') + result.id;
}

export function executionGroups(jobs: readonly ObservedJob[]) {
  const groups = new Map<string, ObservedJob[]>();
  for (const job of jobs) {
    const key = job.role + ':' + job.correlationId;
    const group = groups.get(key) ?? [];
    group.push(job);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, records]) => ({ key, records: records.sort((a, b) => b.attempt - a.attempt) }));
}

export function publicationCounts(jobs: readonly ObservedJob[]) {
  return { review: jobs.filter(job => job.publication?.kind === 'review').length, 'inline-comment': jobs.filter(job => job.publication?.kind === 'inline-comment').length, comment: jobs.filter(job => job.publication?.kind === 'comment').length };
}

export const latestObservation = (jobs: readonly ObservedJob[]): ObservedJob | undefined =>
  jobs.reduce<ObservedJob | undefined>((latest, job) => !latest || Date.parse(job.updatedAt) > Date.parse(latest.updatedAt) ||
    (Date.parse(job.updatedAt) === Date.parse(latest.updatedAt) && job.attempt > latest.attempt) ? job : latest, undefined);

export const observedStages = (job: ObservedJob) => {
  const history = job.phaseHistory ?? [];
  return history.map((entry, index) => {
    const next = history[index + 1];
    const last = !next;
    const matches = last && job.phase === entry.phase;
    const failure = matches && job.state === 'failed';
    const end = next?.timestamp ?? (matches ? job.finishedAt : undefined);
    const interval = Date.parse(end ?? '') - Date.parse(entry.timestamp);
    return { ...entry, intervalMs: Number.isFinite(interval) && interval >= 0 ? interval : undefined,
      state: failure ? 'failed' as const : matches && job.state === 'running' ? 'running' as const : 'observed' as const };
  });
};

export type CanvasPoint = { x: number; y: number };
export type CanvasSize = { width: number; height: number };
export type CanvasViewport = CanvasPoint & { scale: number };
export type CanvasStage = WorkflowRole | 'publication' | 'user';
export const canvasSize = { width: 960, height: 480 };
export const canvasNodeSize = { width: 164, height: 78 };
export const canvasNodes: Record<CanvasStage, CanvasPoint> = {
  triage: { x: 16, y: 216 },
  reviewer: { x: 208, y: 216 },
  impact: { x: 400, y: 48 },
  qa: { x: 400, y: 132 },
  docs: { x: 400, y: 216 },
  architect: { x: 400, y: 300 },
  release: { x: 400, y: 384 },
  publication: { x: 592, y: 216 },
  user: { x: 784, y: 216 }
};

export const canvasMinScale = .25;
export const canvasMaxScale = 2;
export const canvasDetailScale = 1.05;
export const wheelZoomEnabled = (focused: boolean, ctrlKey: boolean, metaKey: boolean) => focused || ctrlKey || metaKey;
export const pointerDragInterrupted = (pointerType: string, buttons: number) => pointerType !== 'touch' && (buttons & 1) === 0;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function fitViewport(size: CanvasSize, readable = false): CanvasViewport {
  const fitted = clamp(Math.min(size.width / canvasSize.width, size.height / canvasSize.height), canvasMinScale, 1);
  const scale = readable ? Math.max(size.width < 600 ? .8 : .85, fitted) : fitted;
  const x = readable && size.width < canvasSize.width * scale ? 8 : (size.width - canvasSize.width * scale) / 2;
  return { scale, x, y: (size.height - canvasSize.height * scale) / 2 };
}

export function panViewport(view: CanvasViewport, delta: CanvasPoint, size: CanvasSize): CanvasViewport {
  const margin = 48;
  const bound = (value: number, viewport: number, content: number) =>
    clamp(value, Math.min(0, viewport - content) - margin, Math.max(0, viewport - content) + margin);
  return { ...view, x: bound(view.x + delta.x, size.width, canvasSize.width * view.scale), y: bound(view.y + delta.y, size.height, canvasSize.height * view.scale) };
}

export function zoomViewport(view: CanvasViewport, scale: number, anchor: CanvasPoint, size: CanvasSize): CanvasViewport {
  const nextScale = clamp(scale, canvasMinScale, canvasMaxScale);
  const ratio = nextScale / view.scale;
  return panViewport({ scale: nextScale, x: anchor.x - (anchor.x - view.x) * ratio, y: anchor.y - (anchor.y - view.y) * ratio }, { x: 0, y: 0 }, size);
}

type CanvasEdge = { from: CanvasStage; to: CanvasStage; path: string; observed: boolean };
export function workflowEdges(jobs: readonly ObservedJob[]): CanvasEdge[] {
  const elbow = (from: CanvasStage, to: CanvasStage, observed = false): CanvasEdge => {
    const a = canvasNodes[from], b = canvasNodes[to];
    const x1 = a.x + canvasNodeSize.width, x2 = b.x;
    const y1 = a.y + canvasNodeSize.height / 2, y2 = b.y + canvasNodeSize.height / 2;
    const mid = (x1 + x2) / 2;
    return { from, to, observed, path: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}` };
  };
  const lead = canvasNodes.reviewer, publication = canvasNodes.publication;
  const triage = canvasNodes.triage;
  const leadPublication: CanvasEdge = {
    from: 'reviewer', to: 'publication',
    observed: jobs.some(job => job.role === 'reviewer' && job.publication),
    path: `M ${lead.x + canvasNodeSize.width / 2} ${lead.y + canvasNodeSize.height} V 470 H ${publication.x + canvasNodeSize.width / 2} V ${publication.y + canvasNodeSize.height}`
  };
  return [
    elbow('triage', 'reviewer'),
    ...specialistRoles.map(role => elbow('reviewer', role)),
    ...specialistRoles.map(role => elbow(role, 'publication', jobs.some(job => job.role === role && job.publication))),
    leadPublication,
    ...(jobs.some(job => job.role === 'triage' && job.publication) ? [{
      from: 'triage' as const, to: 'publication' as const, observed: true,
      path: `M ${triage.x + canvasNodeSize.width - 12} ${triage.y} V 8 H ${publication.x + canvasNodeSize.width - 12} V ${publication.y}`
    }] : []),
    elbow('publication', 'user')
  ].sort((a, b) => Number(a.observed) - Number(b.observed));
}
