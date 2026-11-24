const required = ['OPENAI_API_KEY', 'REVIEWER_APP_PRIVATE_KEY', 'REVIEWER_APP_ID', 'REVIEWER_APP_SLUG'];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) throw new Error('Missing configuration: ' + missing.join(', '));
const token = process.env.VERCEL_TOKEN;
if (!token) throw new Error('Missing Vercel deployment credential');
const project = 'prj_RKccMkGPH0rn8GteNrNN2hQiaik5';
const team = 'team_hAp7kLycu6rwgAWypgcghemA';
if (process.env.VERCEL_PROJECT_ID !== project || process.env.VERCEL_ORG_ID !== team) throw new Error('Unexpected deployment target');
const webhook = process.env.REVIEWER_WEBHOOK_SECRET;
const coordinatedAdvisory = process.env.REVIEWER_AUTO_ADVISORY_ENABLED;
if (coordinatedAdvisory && !['true', 'false'].includes(coordinatedAdvisory)) throw new Error('REVIEWER_AUTO_ADVISORY_ENABLED must be true or false');
const entries = [
  { key: 'OPENAI_API_KEY', value: process.env.OPENAI_API_KEY, type: 'sensitive' },
  { key: 'REVIEWER_APP_PRIVATE_KEY', value: process.env.REVIEWER_APP_PRIVATE_KEY, type: 'sensitive' },
  { key: 'REVIEWER_APP_ID', value: process.env.REVIEWER_APP_ID, type: 'plain' },
  { key: 'REVIEWER_APP_SLUG', value: process.env.REVIEWER_APP_SLUG, type: 'plain' },
  ...(webhook ? [{ key: 'REVIEWER_WEBHOOK_SECRET', value: webhook, type: 'sensitive' }] : []),
  { key: 'REVIEWER_QUEUE_ENABLED', value: process.env.REVIEWER_QUEUE_ENABLED === 'true' ? 'true' : 'false', type: 'plain' },
  ...(coordinatedAdvisory ? [{ key: 'REVIEWER_AUTO_ADVISORY_ENABLED', value: coordinatedAdvisory, type: 'plain' }] : []),
  { key: 'REVIEWER_UI_THREAD_RESOLVE_ENABLED', value: process.env.REVIEWER_UI_THREAD_RESOLVE_ENABLED === 'true' ? 'true' : 'false', type: 'plain' },
  { key: 'REVIEWER_AUTO_MERGE_ENABLED', value: process.env.REVIEWER_AUTO_MERGE_ENABLED === 'true' ? 'true' : 'false', type: 'plain' },
  { key: 'REVIEWER_APP_ENABLED', value: webhook && process.env.REVIEWER_APP_ENABLED === 'true' ? 'true' : 'false', type: 'plain' }
];
for (const entry of entries) {
  const url = new URL('https://api.vercel.com/v10/projects/' + project + '/env');
  url.searchParams.set('teamId', team);
  url.searchParams.set('upsert', 'true');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...entry, target: ['production'] }),
    redirect: 'error',
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error('Vercel environment update failed for ' + entry.key + ' (HTTP ' + response.status + ')');
  console.log('Configured production variable: ' + entry.key);
}
