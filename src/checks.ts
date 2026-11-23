export type Check = { id?: number; name: string; status: string; conclusion: string | null; app?: { id: number } };
export type CheckEvidence = { total_count?: number; check_runs: Check[] };

export async function loadCheckEvidence(head: string, merge: string | null | undefined, read: (sha: string) => Promise<CheckEvidence | null>): Promise<CheckEvidence> {
  const refs = [head];
  if (merge && /^[a-f0-9]{40}$/i.test(merge) && merge !== head) refs.push(merge);
  const evidence = await Promise.all(refs.map(read));
  return { total_count: evidence.reduce((sum, item) => sum + (item?.total_count ?? item?.check_runs.length ?? 0), 0), check_runs: evidence.flatMap(item => item?.check_runs ?? []) };
}
