import { appendFileSync } from 'node:fs';
import { collectPreparation, generatePreparation, renderPreparation, reusablePreparation } from '../apps/worker/src/release-preparation.ts';

if (process.env.GITHUB_REPOSITORY !== 'Oddmash/oddmash-agents' || process.env.GITHUB_ACTOR_ID !== '135234546' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Unauthorized preparation');
const token = process.env.GITHUB_TOKEN;
const previous = process.env.PREVIOUS_TAG ?? '';
const candidate = process.env.CANDIDATE_SHA ?? '';
const currentId = Number(process.env.GITHUB_RUN_ID);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (!token || !summary || !Number.isSafeInteger(currentId) || candidate !== process.env.GITHUB_SHA) throw new Error('Exact main workflow context is required');
const root = '/repos/Oddmash/oddmash-agents';
const api = async path => {
  const response = await fetch('https://api.github.com' + path, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Release preparation metadata unavailable');
  return response.json();
};
const { evidence, projectGuidance, assertCurrent } = await collectPreparation(api, previous, candidate);
const runs = await api(root + '/actions/workflows/prepare-release.yml/runs?branch=main&event=workflow_dispatch&head_sha=' + candidate + '&per_page=100');
const existing = reusablePreparation(runs.workflow_runs, previous, candidate, currentId);
const header = `# Release preparation\n\n- Previous release: ${previous}\n- Candidate: \`${candidate}\`\n- Main CI: successful\n- Evidence: ${evidence.complete ? 'bounded commit metadata' : 'partial metadata; manual confirmation required'}\n\n`;
if (existing) {
  await assertCurrent();
  appendFileSync(summary, header + `Reused [previous preparation](https://github.com/Oddmash/oddmash-agents/actions/runs/${existing.id}). No model calls were made.\n`);
} else {
  const config = role => ({ model: process.env[role.toUpperCase() + '_OPENAI_MODEL'] || process.env.OPENAI_MODEL || 'gpt-5.4', key: process.env[role.toUpperCase() + '_OPENAI_API_KEY'] || process.env.OPENAI_API_KEY, projectGuidance });
  let qa;
  let qaFailed = false;
  if (evidence.qaRequired) {
    try { qa = await generatePreparation('qa', evidence, config('qa')); }
    catch { qaFailed = true; }
  }
  const release = await generatePreparation('release', { ...evidence, qa: qa ?? (qaFailed ? 'Unavailable; manual QA follow-up required' : 'Skipped: documentation/test-only changes') }, config('release'));
  await assertCurrent();
  appendFileSync(summary, header + '## Oddmash QA\n\n' + (qa ? renderPreparation(qa) : qaFailed ? 'Unavailable; manual QA follow-up required.' : 'Skipped: documentation/test-only scope.') + '\n\n## Oddmash Release\n\n' + renderPreparation(release) + '\n\nAdvisory only. No release was published, no deployment was initiated, and no suggested test was executed. Verify release notes, PR links and compatibility before publishing.\n');
  if (qaFailed) throw new Error('QA advice unavailable; release draft is retained but cannot be reused automatically');
}
