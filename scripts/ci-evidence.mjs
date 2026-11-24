const sha = /^[a-f0-9]{40}$/;
const workflow = '.github/workflows/ci.yml';

export async function successfulTests(api, { repository, head, revision, event, branch, headRepository, currentRun }) {
  if (!sha.test(head) || !sha.test(revision) || !Number.isSafeInteger(headRepository)) return null;

  const root = `/repos/${repository}/actions`;
  const query = new URLSearchParams({ event, branch, head_sha: head, status: 'success', per_page: '10' });
  try {
    const { workflow_runs: runs } = await api(`${root}/workflows/ci.yml/runs?${query}`);
    for (const run of runs) {
      if (!Number.isSafeInteger(run.id) || run.id === currentRun || !Number.isSafeInteger(run.run_attempt) ||
          run.path !== workflow || run.head_sha !== head || run.head_branch !== branch ||
          run.event !== event || run.head_repository?.id !== headRepository ||
          run.status !== 'completed' || run.conclusion !== 'success') continue;

      const { jobs } = await api(`${root}/runs/${run.id}/attempts/${run.run_attempt}/jobs`);
      const tests = jobs.find(job => job.name === 'test' && job.status === 'completed' && job.conclusion === 'success');
      if (tests?.steps?.some(step => step.name === `Record full test result for ${revision}` && step.conclusion === 'success')) return run.id;
    }
  } catch {
    return null;
  }
  return null;
}

export async function findGitHubTests(input, token) {
  return successfulTests(async path => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('CI evidence is unavailable');
    return response.json();
  }, input);
}
