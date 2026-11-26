import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { adoption, contributors, status } from './synthetic-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() !== 'test/console-fixtures') {
  throw new Error('The synthetic console server requires the test/console-fixtures branch.');
}

const host = '127.0.0.1';
const apiPort = 4312;
const appPort = 4175;
const scenarios = new Set(['populated', 'slow', 'empty', 'partial', 'unavailable', 'expired']);
const scenariosByPath = new Map();
const counts = new Map();
const previews = new Map([
  ['/api/status', status],
  ['/api/contributors', contributors],
  ['/api/adoption', adoption],
  ['/api/controls', { revision: null, controls: { paused: false, excludedRoles: [], maxRequests: null, maxMs: null }, limits: { maxRequests: 5, maxMs: 90000 } }],
  ['/api/models', { revision: null, overrides: {}, policy: Object.fromEntries(['reviewer', 'impact', 'triage', 'qa', 'release', 'docs', 'architect'].map(role => [role, { defaultModel: 'fixture-model', allowed: [] }])) }]
]);
const empty = new Map([
  ['/api/status', { ...status, jobs: [] }],
  ['/api/contributors', { ...contributors, pulls: [] }],
  ['/api/adoption', { metrics: [] }]
]);
const send = (response, code, json) => {
  response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(json));
};

const api = createHttpServer(async (request, response) => {
  const url = new URL(request.url, 'http://' + host);
  const path = url.pathname;
  if (path === '/__fixture') {
    if (request.headers.host !== host + ':' + apiPort || request.headers.origin) return send(response, 403, { error: 'Use the loopback API directly' });
    const resource = url.searchParams.get('resource');
    const scenario = url.searchParams.get('scenario');
    if (request.method === 'POST' && previews.has(resource) && scenarios.has(scenario)) scenariosByPath.set(resource, scenario);
    else if (request.method !== 'GET') return send(response, 400, { error: 'Unknown fixture resource or scenario' });
    return send(response, 200, { scenarios: Object.fromEntries(scenariosByPath), counts: Object.fromEntries(counts) });
  }
  if (request.method !== 'GET') return send(response, 405, { error: 'Fixture data is read-only' });
  if (path === '/api/auth/session') return send(response, 200, { user: { id: '1' }, expires: '2099-01-01T00:00:00.000Z' });
  if (path === '/api/availability') return send(response, 200, { configured: true });
  if (!previews.has(path)) return send(response, 404, { error: 'Unknown fixture endpoint' });
  counts.set(path, (counts.get(path) ?? 0) + 1);
  const scenario = scenariosByPath.get(path);
  if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 900));
  if (scenario === 'unavailable') return send(response, 503, { error: 'Synthetic outage' });
  if (scenario === 'expired') return send(response, 401, { error: 'Synthetic session expiry' });
  if (scenario === 'partial' && path === '/api/contributors') return send(response, 200, { ...contributors, partial: true });
  return send(response, 200, (scenario === 'empty' && empty.get(path)) || previews.get(path));
});

const vite = await createViteServer({
  root,
  server: { host, port: appPort, strictPort: true }
});
try {
  await new Promise((resolve, reject) => api.listen(apiPort, host, resolve).once('error', reject));
  await vite.listen();
  vite.printUrls();
} catch (error) {
  api.close();
  await vite.close();
  throw error;
}
