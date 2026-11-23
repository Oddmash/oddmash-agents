export const progressCheckName = 'Oddmash Reviewer / review';

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Conclusion = 'success' | 'failure' | 'neutral' | 'cancelled';
type ProgressIdentity = { appId: number; number: number; request?: string; waiting?: boolean; reuseOnly?: boolean };
type CheckRun = { id: number; name: string; head_sha: string; external_id: string | null; status: string; app?: { id: number } };

export async function startReviewProgress(api: Api, repository: string, head: string, identity?: ProgressIdentity) {
  const path = `/repos/${repository}/check-runs`;
  let id: number | undefined;
  let finished = false;
  const externalId = identity ? `oddmash-review:${identity.number}:${head}:${identity.request ?? 'initial'}` : undefined;
  const write = async (status: 'queued' | 'in_progress' | 'completed', title: string, summary: string, conclusion?: Conclusion) => {
    try {
      const body = { name: progressCheckName, status, output: { title, summary }, ...(id ? {} : { head_sha: head, ...(externalId ? { external_id: externalId } : {}) }), ...(conclusion ? { conclusion, completed_at: new Date().toISOString() } : {}) };
      const result = await api<{ id: number }>(id ? `${path}/${id}` : path, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      if (!id && Number.isSafeInteger(result.id) && result.id > 0) id = result.id;
      return true;
    } catch { console.warn('Review progress unavailable'); return false; }
  };
  if (identity) {
    try {
      if (!Number.isSafeInteger(identity.appId) || identity.appId <= 0) throw new Error('Invalid progress App identity');
      const result = await api<{ total_count: number; check_runs: CheckRun[] }>(`/repos/${repository}/commits/${head}/check-runs?check_name=${encodeURIComponent(progressCheckName)}&filter=all&per_page=100`);
      if (result.total_count !== result.check_runs.length) throw new Error('Incomplete progress lookup');
      const existing = result.check_runs.filter(run => run.name === progressCheckName && run.head_sha === head && run.external_id === externalId && run.app?.id === identity.appId && Number.isSafeInteger(run.id) && run.id > 0 && ['queued', 'in_progress'].includes(run.status)).sort((a, b) => b.id - a.id)[0];
      id = existing?.id;
    } catch { console.warn('Review progress lookup unavailable'); finished = true; }
  }
  if (!id && !finished && !identity?.reuseOnly) await write('queued', identity?.waiting ? 'Waiting for CI' : 'Review queued', identity?.waiting ? 'Review will start after required checks pass.' : 'Waiting to collect review evidence.');
  return {
    update: async (title: string, summary: string) => { if (id) await write('in_progress', title, summary); },
    finish: async (conclusion: Conclusion, title: string, summary = 'See the pull request review for details.') => { if (id && !finished) finished = await write('completed', title, summary, conclusion); }
  };
}
