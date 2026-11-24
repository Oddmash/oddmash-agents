import type { AdvisoryRole } from './advisory-agents.ts';
import type { Target } from './webhook.ts';

export type ChangeMetadata = { filename: string; status?: string; changes?: number };
export type CompareEvidence = { status: string; ahead_by: number; total_commits: number; files?: ChangeMetadata[] };
const sha = /^[a-f0-9]{40}$/i;
export function reviewBaseMarker(base: string) {
  return sha.test(base) ? `<!-- oddmash-review-base:${base} -->` : '';
}
export function incrementalPaths(previous: { commit_id: string; state: string; body: string | null } | undefined, head: string, base: string, evidence: CompareEvidence | undefined): string[] | undefined {
  if (!previous || previous.state !== 'APPROVED' || !sha.test(previous.commit_id) || previous.commit_id === head || !previous.body?.includes(reviewBaseMarker(base)) || !sha.test(base) || !sha.test(head)) return;
  if (!evidence || evidence.status !== 'ahead' || evidence.ahead_by < 1 || evidence.ahead_by !== evidence.total_commits || !evidence.files || evidence.files.length > 10) return;
  if (evidence.files.some(file => !file.filename || file.status !== 'modified' || !Number.isSafeInteger(file.changes) || file.changes! < 0) || evidence.files.reduce((sum,file)=>sum+file.changes!,0)>150) return;
  return [...new Set(evidence.files.map(file=>file.filename))];
}
const automaticRoles = ['impact', 'qa', 'release', 'docs', 'architect'] as const;
type AutomaticRole = typeof automaticRoles[number];
export type AdvisoryBudget = { maxRequests: number; elapsedMs: number };
const bounded = (value: string | undefined, fallback: number, maximum: number) => {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(parsed, maximum) : fallback;
};

export function coordinatedAdvisoriesEnabled(target: Pick<Target, 'recheck' | 'requestComment'>, enabled: string | undefined): boolean {
  return enabled === 'true' && (!target.recheck || target.requestComment?.kind === 'issue');
}

export function automaticAdvisoryBudget(env: Record<string, string | undefined> = process.env, elapsedMs = 0): AdvisoryBudget {
  return {
    maxRequests: bounded(env.REVIEWER_AUTO_ADVISORY_MAX_REQUESTS, 5, automaticRoles.length),
    elapsedMs: Math.min(bounded(env.REVIEWER_AUTO_ADVISORY_MAX_MS, 90_000, 120_000), Math.max(0, 245_000 - elapsedMs))
  };
}

export function automaticAdvisoryPaths(files: readonly ChangeMetadata[]): string[] {
  return [...new Set(files.filter(file => {
    const path = file.filename.toLowerCase();
    return path.length > 0 && !/(?:^|\/)(?:\.github|\.git|\.env[^/]*|secrets?|credentials?|security|vulnerabilit(?:y|ies)|exploit(?:s)?|attack(?:s)?|auth(?:entication|orization)?|permissions?|infra(?:structure)?|deploy(?:ment)?|webhook(?:s|-review)?|auto-merge)(?:\/|\.|-|_|$)/.test(path)
      && !/\.(?:pem|key|p12|lock)$|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|vercel\.json)$/.test(path);
  }).map(file => file.filename))];
}

export function selectAdvisoryRoles(files: readonly ChangeMetadata[], maxRequests = 5): AdvisoryRole[] {
  const eligible = new Set(automaticAdvisoryPaths(files));
  const scores = new Map<AutomaticRole, number>();
  const score = (role: AutomaticRole, value: number) => scores.set(role, Math.max(scores.get(role) ?? 0, value));
  for (const file of files) {
    if (!eligible.has(file.filename)) continue;
    const path = file.filename.toLowerCase();
    const tinyDocumentationEdit = file.status === 'modified' && Number.isSafeInteger(file.changes) && file.changes! <= 2 && /\.(?:md|mdx|txt)$/.test(path);
    if (tinyDocumentationEdit) continue;
    const code = /\.(?:[cm]?[jt]s|tsx|jsx|py|rs|go|java|vue|astro|svelte)$/.test(path);
    const testFile = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(path);
    if (/(?:^|\/)(?:package\.json|changelog\.md|\.changeset\/)|(?:^|\/)(?:release|version)\./.test(path)) score('release', 5);
    if (code && /(?:^|\/)(?:api|routes|components|features|packages|public|contracts)\//.test(path) && !testFile) score('impact', 4);
    if (code || /\.(?:css|scss|sass|less)$/.test(path)) score('qa', 4);
    if (code && !testFile && /(?:^|\/)(?:architecture|domain|modules|packages|contracts)(?:\/|\.)/.test(path)) score('architect', 5);
    if (/(?:^|\/)(?:docs|readme|agents|contributing)(?:\/|\.)/.test(path) || code && !testFile && /(?:^|\/)(?:api|public|contracts)\//.test(path)) score('docs', 4);
  }
  const limit = Number.isSafeInteger(maxRequests) ? Math.min(automaticRoles.length, Math.max(0, maxRequests)) : 0;
  return [...scores].sort((a,b) => b[1] - a[1] || automaticRoles.indexOf(a[0]) - automaticRoles.indexOf(b[0])).slice(0, limit).map(([role]) => role);
}

export async function runCoordinatedAdvisories(roles: readonly AdvisoryRole[], budget: AdvisoryBudget, action: (role: AdvisoryRole, signal: AbortSignal) => Promise<boolean>, clock = Date.now) {
  if (!Number.isSafeInteger(budget.maxRequests) || budget.maxRequests <= 0 || !Number.isSafeInteger(budget.elapsedMs) || budget.elapsedMs <= 0) return;
  const elapsedMs = Math.min(budget.elapsedMs, 120_000);
  const started = clock();
  const signal = AbortSignal.timeout(elapsedMs);
  let attempts = 0;
  for (const role of new Set(roles)) {
    if (role === 'triage' || !automaticRoles.includes(role)) continue;
    if (signal.aborted || clock() - started >= elapsedMs || attempts >= Math.min(budget.maxRequests, automaticRoles.length)) break;
    attempts++;
    try {
      if (!await action(role, signal)) break;
    } catch (error) {
      console.warn('Coordinated advisory failed');
      if (signal.aborted || error instanceof Error && error.message === 'Model quota, rate or credit limit reached; stop and check API billing before retrying') break;
    }
  }
}
