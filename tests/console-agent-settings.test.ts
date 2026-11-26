import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (name: string) => readFileSync(new URL('../apps/console/src/' + name, import.meta.url), 'utf8');

test('agent settings have one role list, retain owner model controls without worker telemetry, and center identity', () => {
  const settings = source('model-settings.tsx');
  const dashboard = source('dashboard.tsx');
  assert.match(settings, /modelRoles\.map\(role => \{\s+const agent = agents\?\.find/);
  assert.match(settings, /modelSelectionAvailable\(policy\.allowed, current\) \? <Select/);
  assert.match(settings, /No alternate approved for this agent\./);
  assert.match(settings, /response\.status === 422/);
  assert.match(settings, /disabled=\{!dirty \|\| !valid \|\| busy \|\| conflict \|\| review\}/);
  assert.equal((dashboard.match(/<ModelSettings /g) ?? []).length, 1);
  assert.doesNotMatch(source('runtime-controls.tsx'), /<ModelSettings /);
  assert.doesNotMatch(dashboard, /className="config-grid data-row"/);
  assert.match(dashboard, /hidden=\{!snapshot && \(view !== 'settings' \|\| error === 'Session expired\. Sign in again\.'\)\}/);
  assert.match(dashboard, /agents=\{snapshot\?\.settings\?\.agents\}/);
  const css = source('agent-settings.css');
  assert.match(css, /\.agent-settings-row \{[^}]*align-items: center/);
  assert.match(css, /\.agent-settings-identity \.agent-identity \{[^}]*align-items: center/);
});
