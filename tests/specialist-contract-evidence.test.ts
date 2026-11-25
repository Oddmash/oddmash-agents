import test from 'node:test';
import assert from 'node:assert/strict';
import { advisoryProfiles } from '../apps/worker/src/advisory-agents.ts';
import { publishSpecialistFindings, specialistFindingRules } from '../apps/worker/src/specialist-findings.ts';
import { githubApi } from '../apps/worker/src/webhook.ts';
import type { ChangedFile } from '../apps/worker/src/core.ts';

const head = 'a'.repeat(40);
const target = { installation: 1, repository: 'Oddmash/example', repositoryId: 71, number: 7, advisory: 'release' as const, advisoryIdentity: 'release' as const };
const internal: ChangedFile = {
  filename: 'src/select-dropdown.tsx', status: 'modified',
  patch: '@@ -12,3 +12,3 @@\n-export type SelectDropdownOption = {\n+export type SelectOption = {\n   value: string;\n };'
};
const reexport = (patch: string): ChangedFile => ({ filename: 'src/select.tsx', status: 'modified', patch });
const preserved = reexport("@@ -1,4 +1,5 @@\n export {\n-  type SelectDropdownOption,\n+  type SelectOption,\n+  type SelectOption as SelectDropdownOption,\n   Select,\n } from './select-dropdown';");
const missingAlias = 'This added type rename is a source-level breaking change for consumers importing SelectDropdownOption, so the claimed compatibility alias appears incomplete without a matching type alias export.';
const changedContract = 'The retained SelectDropdownOption type now rejects a formerly accepted option value.';

async function publish(files: ChangedFile[], en: string) {
  const posts: string[] = [];
  const api = githubApi('fixture', async (input, init) => {
    assert.match(String(input), /\/pulls\/7\/comments/);
    if (init?.method === 'POST') posts.push(JSON.parse(String(init.body)).body);
    return Response.json(init?.method === 'POST' ? {} : []);
  });
  await publishSpecialistFindings(api, target, 'oddmash-release[bot]', head, {
    inlineFindings: [{ path: internal.filename, line: 12, evidence: 'export type SelectOption = {', en, ko: '타입 호환성을 확인하세요.' }]
  }, files, async () => true);
  return posts;
}

test('specialist compatibility prompts require public contract evidence and allow provisional follow-up', () => {
  assert.match(specialistFindingRules, /inspect all supplied patches together/);
  assert.match(specialistFindingRules, /internal declaration rename alone is not evidence/);
  assert.match(specialistFindingRules, /verification suggestion in the summary/);
  assert.match(advisoryProfiles.release.instructions, /internal exports from supported public entrypoints and retained compatibility aliases/);
});

test('a matching type re-export contradicts a missing-alias finding on a renamed declaration', async () => {
  assert.deepEqual(await publish([internal, preserved], missingAlias), []);
  const typeOnlyBlock = reexport("@@ -1 +1 @@\n-export type { SelectDropdownOption } from './select-dropdown';\n+export type { SelectOption as SelectDropdownOption } from './select-dropdown';");
  assert.deepEqual(await publish([internal, typeOnlyBlock], missingAlias), []);
});

test('only a retained alias from the exact renamed declaration suppresses the missing-alias claim', async () => {
  const unrelatedModule = { ...preserved, patch: preserved.patch!.replace('./select-dropdown', './other/select-dropdown') };
  const unrelatedName = { ...preserved, patch: preserved.patch!.replace('as SelectDropdownOption', 'as DifferentOption') };
  const deletedAlias = reexport("@@ -1 +1 @@\n-export type { SelectOption as SelectDropdownOption } from './select-dropdown';\n+export type { SelectOption } from './select-dropdown';");
  const newReexport = reexport("@@ -1 +1 @@\n-export type { DifferentOption } from './select-dropdown';\n+export type { SelectOption as SelectDropdownOption } from './select-dropdown';");
  for (const files of [[internal], [internal, unrelatedModule], [internal, unrelatedName], [internal, deletedAlias], [internal, newReexport]]) {
    assert.equal((await publish(files, missingAlias)).length, 1);
  }
  const distinct = await publish([internal, preserved], changedContract);
  assert.equal(distinct.length, 1);
  assert.match(distinct[0], /formerly accepted option value/);
});
