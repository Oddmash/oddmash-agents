export const progressCheckName = 'Oddmash Reviewer / review';

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Conclusion = 'success' | 'failure' | 'neutral' | 'cancelled';

export async function startReviewProgress(api: Api, repository: string, head: string) {
  const path = `/repos/${repository}/check-runs`;
  let id: number | undefined;
  let finished = false;
  const write = async (status: 'queued' | 'in_progress' | 'completed', title: string, summary: string, conclusion?: Conclusion) => {
    try {
      const body = { name: progressCheckName, status, output: { title, summary }, ...(id ? {} : { head_sha: head }), ...(conclusion ? { conclusion, completed_at: new Date().toISOString() } : {}) };
      const result = await api<{ id: number }>(id ? `${path}/${id}` : path, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      if (Number.isSafeInteger(result.id) && result.id > 0) id = result.id;
    } catch { console.warn('Review progress unavailable'); }
  };
  await write('queued', 'Review queued', 'Waiting to collect review evidence.');
  return {
    update: async (title: string, summary: string) => { if (id) await write('in_progress', title, summary); },
    finish: async (conclusion: Conclusion, title: string) => { if (id && !finished) { finished = true; await write('completed', title, 'See the pull request review for details.', conclusion); } }
  };
}
