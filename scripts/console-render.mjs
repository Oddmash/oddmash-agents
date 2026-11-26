import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const { chromium } = await import(process.env.CONSOLE_PLAYWRIGHT_MODULE ?? 'playwright');
const base = 'http://127.0.0.1:4175';
const host = spawn('pnpm', ['--filter', '@oddmash/agents-console', 'exec', 'vite', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: 'inherit' });
const dir = 'render-evidence';
const target = { repository: 'Oddmash/example', number: 42 };
const startedAt = '2026-01-01T12:00:00Z';
const updatedAt = '2026-01-01T12:01:00Z';
const job = (role, state, extra = {}) => ({ role, state, target, correlationId: 'fixture-' + role, attempt: 1, startedAt, updatedAt, phase: 'reviewing', ...extra });
const jobs = [
  job('reviewer', 'failed', { finishedAt: updatedAt, failure: 'unexpected', phase: 'validating', phaseHistory: [{ phase: 'collecting-changes', timestamp: startedAt }, { phase: 'validating', timestamp: '2026-01-01T12:00:30Z' }] }),
  job('qa', 'running', { phase: 'specialist-review' }),
  job('docs', 'returned', { finishedAt: updatedAt }),
  job('impact', 'published', { phase: 'publishing', publication: { kind: 'comment', id: 1, at: updatedAt }, finishedAt: updatedAt })
];
const snapshot = { connected: true, jobs, settings: null, observedAt: updatedAt };
let browser;
try {
  await mkdir(dir, { recursive: true });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/tests/render-fixture.html')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'Fixture server did not start');
  browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    for (const language of ['en', 'ko']) {
      for (const width of [1440, 390, 320]) {
        const label = [theme, language, width].join('-');
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.stack ?? error.message); });
        page.on('console', message => { if (message.type() === 'error') console.error('BROWSER', message.text()); });
        page.on('response', response => { if (response.status() >= 400) console.error('HTTP', response.status(), response.url()); });
        await page.route('**/api/**', route => {
          const path = new URL(route.request().url()).pathname;
          if (path === '/api/status') return route.fulfill({ json: snapshot });
          if (path === '/api/models') return route.fulfill({ json: { revision: 'fixture', overrides: {}, policy: Object.fromEntries(['reviewer','impact','triage','qa','release','docs','architect'].map(role => [role, { defaultModel: 'fixture-model', allowed: [] }])) } });
          if (path === '/api/controls') return route.fulfill({ json: { revision: 'fixture', controls: { paused: false, excludedRoles: [], maxRequests: null, maxMs: null } } });
          return route.fulfill({ status: 503, json: { error: 'Not part of render fixture' } });
        });
        await page.goto(base + '/tests/render-fixture.html?theme=' + theme + '&language=' + language);
        const workflow = page.locator('.workflow-view').first();
        try { await workflow.waitFor({ state: 'visible', timeout: 12000 }); } catch (error) {
          console.error('FIXTURE BODY', (await page.locator('body').innerText()).slice(0, 2000));
          await page.screenshot({ path: dir + '/' + label + '-failure.png', fullPage: true });
          throw error;
        }
        const nodes = workflow.locator('.workflow-grid').first().locator('.workflow-node');
        assert.equal(await nodes.count(), 5, label);
        assert.match(await nodes.first().innerText(), /Lead/, label);
        assert.match(await nodes.nth(1).innerText(), /QA/, label);
        const geometry = await workflow.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const cards = [...element.querySelectorAll(':scope > .workflow-grid > .workflow-node')];
          const overflow = cards.some(card => {
            const rect = card.getBoundingClientRect();
            return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || card.scrollWidth > card.clientWidth + 1;
          });
          const misaligned = cards.some(card => {
            const avatar = card.querySelector('.agent-avatar');
            const identity = card.querySelector('.agent-identity');
            if (!avatar || !identity) return false;
            const a = avatar.getBoundingClientRect(), b = identity.getBoundingClientRect();
            return Math.abs(a.top + a.height / 2 - b.top - b.height / 2) > 2;
          });
          return { overflow, misaligned, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        assert.deepEqual(geometry, { overflow: false, misaligned: false, documentOverflow: false }, label);
        await page.screenshot({ path: dir + '/' + label + '.png', fullPage: true, animations: 'disabled' });
        const lead = nodes.first();
        await lead.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await dialog.locator('.workflow-timeline li').count(), 2, label);
        assert.match(await dialog.locator('.workflow-failure-phase').innerText(), language === 'ko' ? /실패/ : /failure/i, label);
        await page.screenshot({ path: dir + '/' + label + '-details.png', animations: 'disabled' });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(element => document.activeElement === element, await lead.elementHandle(), { timeout: 2000 });
        const remaining = workflow.locator('.workflow-unobserved');
        assert.equal(await remaining.getAttribute('open'), null, label);
        await remaining.locator('summary').click();
        assert.equal(await remaining.locator('.workflow-node:visible').count(), 3, label);
        assert.deepEqual(errors, [], label);
        console.log('PASS ' + label + ': card bounds, alignment, phase history, keyboard, collapsed roles');
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  host.kill();
}
