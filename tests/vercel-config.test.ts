import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Vercel install configuration is project-scoped', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.installCommand, 'corepack pnpm install --frozen-lockfile --ignore-scripts');
  for (const settings of Object.values(config.functions)) {
    assert.equal(Object.hasOwn(settings as object, 'installCommand'), false);
  }
  assert.equal(config.functions['api/review-jobs.ts'].experimentalTriggers[0].topic, 'oddmash-review-jobs');
});
