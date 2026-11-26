import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium } = await import(process.env.CONSOLE_PLAYWRIGHT_MODULE ?? 'playwright');
const app = 'http://127.0.0.1:4175';
const control = 'http://127.0.0.1:4312/__fixture';
const evidenceDir = process.argv[2] ?? 'render-evidence';
const scenarios = new Map();
const scenario = async (resource, name) => {
  const url = new URL(control);
  url.search = new URLSearchParams({ resource, scenario: name });
  assert((await fetch(url, { method: 'POST' })).ok);
  scenarios.set(resource, name);
};
const count = async resource => (await (await fetch(control)).json()).counts[resource] ?? 0;
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

const browser = await chromium.launch();
await mkdir(evidenceDir, { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    for (const colorScheme of ['light', 'dark']) {
      for (const language of ['en', 'ko']) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, reducedMotion: 'reduce' });
        const label = [width, colorScheme, language].join('-');
        const uncaught = [];
        page.on('pageerror', error => uncaught.push(error.message));
        await page.goto(app + '/' + language);
        const recentTarget = page.locator('.overview-target').first();
        await recentTarget.waitFor();
        assert(await noOverflow(page), label + ' overview overflow');
        await page.screenshot({ path: join(evidenceDir, label + '-overview.png'), fullPage: true });
        await recentTarget.click();
        const role = page.locator('.workflow-node').first();
        await role.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(element => document.activeElement === element, await role.elementHandle(), { timeout: 2000 });

        await page.locator('.console-nav a').nth(2).click();
        const card = page.locator('.contributor-card').first();
        const summary = card.locator('summary').first();
        await summary.waitFor();
        assert.equal(await page.locator('.contributor-evidence[open]').count(), 0);
        assert(await noOverflow(page), label + ' contributor overflow');
        await page.screenshot({ path: join(evidenceDir, label + '-contributors.png'), fullPage: true });
        await summary.focus();
        await page.keyboard.press('Enter');
        await card.locator('.contributor-workflow-link').waitFor();
        assert(await noOverflow(page), label + ' contributor detail overflow');
        if (width === 320 && colorScheme === 'dark' && language === 'ko') {
          await page.screenshot({ path: join(evidenceDir, label + '-contributor-detail.png'), fullPage: true });
        }
        if (width === 320 && language === 'en') {
          await page.locator('.console-preferences > summary').focus();
          await page.keyboard.press('Enter');
          await page.locator('.theme-options button').last().waitFor();
          assert(await noOverflow(page), label + ' preferences overflow');
        }
        assert.deepEqual(uncaught, [], label);
        await page.close();
        console.log('PASS', label, 'overview, history dialog, contributor disclosure and overflow');
      }
    }
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  const resource = '/api/contributors';
  await scenario(resource, 'slow');
  await page.goto(app + '/en/contributors');
  await page.locator('.contributor-loading').waitFor();
  await page.screenshot({ path: join(evidenceDir, 'slow-contributors.png'), fullPage: true });
  const summary = page.locator('.contributor-evidence summary').first();
  await summary.waitFor();
  const requestCount = await count(resource);
  await page.locator('.console-nav a').first().click();
  await page.locator('.console-nav a').nth(2).click();
  await summary.waitFor();
  assert.equal(await count(resource), requestCount, 'fresh contributor data survived navigation');

  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await scenario(resource, 'unavailable');
  await refresh.click();
  await page.getByText('Showing the last successful snapshot.', { exact: false }).waitFor();
  assert(await summary.isVisible());
  await page.screenshot({ path: join(evidenceDir, 'stale-contributors.png'), fullPage: true });
  await scenario(resource, 'partial');
  await refresh.click();
  await page.getByText('Results may be incomplete.', { exact: true }).first().waitFor();
  await scenario(resource, 'empty');
  await refresh.click();
  await page.getByText('No matching open contributor pull requests.').waitFor();
  await scenario(resource, 'expired');
  await refresh.click();
  await page.getByText('Session expired. Sign in again.').waitFor();
  assert.equal(await page.locator('.contributor-card').count(), 0);
  await scenario(resource, 'populated');

  await scenario('/api/status', 'unavailable');
  await page.goto(app + '/en');
  await page.getByText('Unable to refresh live status.', { exact: false }).waitFor();
  await page.locator('.console-nav a').nth(4).click();
  await page.locator('.runtime-controls input[type=number]').first().waitFor();
  assert.equal(await page.getByText('Unable to refresh live status.', { exact: false }).count(), 0);
  const pause = page.getByRole('checkbox', { name: 'Pause coordinated specialists' });
  const initialPause = await pause.isChecked();
  await pause.setChecked(!initialPause);
  await page.getByRole('button', {name:'Save changes', exact:true}).click();
  await page.getByText('Saved for future coordinated reviews.').waitFor();
  await page.reload();
  await pause.waitFor();
  assert.equal(await pause.isChecked(), !initialPause, 'saved controls survive reload');
  await pause.setChecked(initialPause);
  await page.getByRole('button', {name:'Save changes', exact:true}).click();
  await page.getByText('Saved for future coordinated reviews.').waitFor();
  const lead = page.getByRole('checkbox', { name: 'Lead', exact: true });
  const triage = page.getByRole('checkbox', { name: 'Triage', exact: true });
  const initialLead = await lead.isChecked();
  const initialTriage = await triage.isChecked();
  await lead.setChecked(!initialLead);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Saved for future coordinated reviews.').waitFor();
  await page.reload();
  await lead.waitFor();
  assert.equal(await lead.isChecked(), !initialLead);
  assert.equal(await triage.isChecked(), initialTriage);
  await lead.setChecked(initialLead);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Saved for future coordinated reviews.').waitFor();
  await scenario('/api/status', 'populated');
  await page.locator('.console-nav a').first().click();
  await page.locator('.overview-target').first().waitFor();
  console.log('PASS', 'delayed, fresh cache, stale recovery, partial, empty, expired, source isolation and settings save');
} finally {
  for (const resource of scenarios.keys()) await scenario(resource, 'populated');
  await browser.close();
}
