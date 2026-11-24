import type { AdvisoryRole } from './advisory-agents.ts';

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
export function selectAdvisoryRoles(files: readonly ChangeMetadata[]): AdvisoryRole[] {
  const paths = files.map(file=>file.filename.toLowerCase());
  const scores = new Map<AdvisoryRole,number>();
  const score = (role: AdvisoryRole, value: number) => scores.set(role, (scores.get(role) ?? 0) + value);
  for (const path of paths) {
    if (/^(package\.json|changelog\.md|\.changeset\/)|(?:^|\/)(?:release|version)\./.test(path)) score('release', 5);
    if (/^(?:src\/)?(?:api|routes|components|features|packages)\//.test(path) && /\.(?:tsx?|jsx?|vue|astro|svelte)$/.test(path)) score('impact', 2);
    if (/\.(?:tsx?|jsx?|py|rs|go|java)$/.test(path) && !/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(path)) score('qa', 2);
    if (/(?:^|\/)(?:architecture|domain|modules|packages|contracts)(?:\/|\.)|(?:^|\/)package\.json$/.test(path)) score('architect', 3);
    if (/(?:^|\/)(?:docs|readme)(?:\/|\.)|(?:^|\/)(?:api|public)\//.test(path)) score('docs', 3);
  }
  return [...scores].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,2).map(([role])=>role);
}
