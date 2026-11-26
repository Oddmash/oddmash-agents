import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { adoption, contributors, status } from './synthetic-data.mjs';
import { defaultControls } from '../../../packages/operator-contract/src/controls.ts';
import { modelPolicy } from '../../../packages/operator-contract/src/model-settings.ts';
import { handleControlWrite } from '../control-request.ts';
import { handleModelWrite } from '../model-request.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
if (execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() !== 'test/console-fixtures') {
  throw new Error('The synthetic console server requires the test/console-fixtures branch.');
}

const host = '127.0.0.1';
const apiPort = 4312;
const appPort = 4175;
const appOrigin = 'http://' + host + ':' + appPort;
const limits = { maxRequests: 5, maxMs: 90000 };
const policy = modelPolicy({ OPENAI_MODEL: 'gpt-fixture-default', REVIEWER_OPERATOR_ALLOWED_MODELS: 'gpt-fixture-alternate' });
const scenarios = new Set(['populated', 'slow', 'empty', 'partial', 'unavailable', 'expired']);
const scenariosByPath = new Map();
const counts = new Map();
const previews = new Map([
  ['/api/status', status],
  ['/api/contributors', contributors],
  ['/api/adoption', adoption],
  ['/api/controls', { revision: null, updatedAt: null, controls: defaultControls(), limits }],
  ['/api/models', { revision: null, updatedAt: null, overrides: {}, policy }]
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

const writeSettings = async (request, response, path) => {
  if (request.headers.origin !== appOrigin || request.headers['content-type']?.split(';')[0] !== 'application/json') {
    return send(response, 403, { error: 'Use the local console origin and JSON' });
  }
  const input = new Request(appOrigin + path, {
    method: 'POST', headers: request.headers, body: Readable.toWeb(request), duplex: 'half'
  });
  const persist = field => async (revision, value) => {
    const previous = previews.get(path);
    if (revision !== previous.revision) return null;
    const next = { ...previous, [field]: value, revision: randomUUID(), updatedAt: new Date().toISOString() };
    previews.set(path, next);
    return next;
  };
  const result = path === '/api/controls'
    ? await handleControlWrite(input, persist('controls'), limits)
    : await handleModelWrite(input, policy, async () => true, persist('overrides'));
  return send(response, result.status, result.body);
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
  const write = request.method === 'POST' && (path === '/api/controls' || path === '/api/models');
  if (request.method !== 'GET' && !write) return send(response, 405, { error: 'Unsupported fixture action' });
  if (path === '/api/auth/session') return send(response, 200, { user: { id: '1' }, expires: '2099-01-01T00:00:00.000Z' });
  if (path === '/api/availability') return send(response, 200, { configured: true });
  if (!previews.has(path)) return send(response, 404, { error: 'Unknown fixture endpoint' });
  counts.set(path, (counts.get(path) ?? 0) + 1);
  const scenario = scenariosByPath.get(path);
  if (scenario === 'slow') await new Promise(resolve => setTimeout(resolve, 900));
  if (scenario === 'unavailable') return send(response, 503, { error: 'Synthetic outage' });
  if (scenario === 'expired') return send(response, 401, { error: 'Synthetic session expiry' });
  if (write) {
    try { return await writeSettings(request, response, path); }
    catch { return send(response, 400, { error: 'Invalid fixture write' }); }
  }
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
