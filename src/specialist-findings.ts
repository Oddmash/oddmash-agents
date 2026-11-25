import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { addedLineText, privateSensitiveText, type ChangedFile } from './core.ts';
import type { AdvisoryRole } from './advisory-agents.ts';
import type { Target, githubApi } from './webhook.ts';

type Api = ReturnType<typeof githubApi>;
type Finding = { path: string; line: number; evidence: string; en: string; ko: string };
type Role = Exclude<AdvisoryRole, 'triage'>;

export const specialistFindingRules = 'Provide at most three inlineFindings for concrete actionable defects within your role. Use only added lines from the provided patches. For each, copy the exact added source line without the diff prefix as evidence, and describe the defect and why it matters in one concise English and Korean sentence. For public API or compatibility claims, inspect all supplied patches together, including public entrypoints, re-exports, aliases and package exports. An internal declaration rename alone is not evidence of a broken public import. When the public contract is not established, put a specific verification suggestion in the summary instead of asserting an inline defect. Do not infer that an alias guarantees complete compatibility. General advice belongs in the summary. Return an empty array when there is no supported anchor.';

export function specialistSchema(summary: { properties: object; required: string[] }) {
  return {
    ...summary, type: 'object', additionalProperties: false, required: [...summary.required, 'inlineFindings'],
    properties: {
      ...summary.properties,
      inlineFindings: {
        type: 'array', maxItems: 3,
        items: {
          type: 'object', additionalProperties: false, required: ['path', 'line', 'evidence', 'en', 'ko'],
          properties: { path: { type: 'string' }, line: { type: 'integer' }, evidence: { type: 'string' }, en: { type: 'string' }, ko: { type: 'string' } }
        }
      }
    }
  };
}

const safeField = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 600 && value.trim().length > 0 && !privateSensitiveText(value) && !/[<>\r\n]/.test(value);
const plain = (value: string) => value.replace(/@/g, '＠').replace(/[\\`*_\[\]()#!|~]/g, '\\$&').replace(/https?:\/\//gi, 'https[:]//');

function renamedType(file: ChangedFile, target: number): { previous: string; current: string } | undefined {
  let position = 0;
  let previous: string | undefined;
  for (const line of (file.patch ?? '').split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { position = Number(hunk[1]); previous = undefined; continue; }
    if (!position) continue;
    if (line.startsWith('-')) {
      previous = /^-\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)?.[1];
      continue;
    }
    if (line.startsWith('+') && position === target) {
      const current = /^\+\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)?.[1];
      if (previous && current && previous !== current) return { previous, current };
      return;
    }
    if (line.startsWith('+') || line.startsWith(' ')) position++;
    previous = undefined;
  }
}

function matchingTypeAlias(file: ChangedFile, originalPath: string, rename: { previous: string; current: string }): boolean {
  if (!/\.[cm]?tsx?$/.test(file.filename) || file.filename === originalPath) return false;
  for (const hunk of (file.patch ?? '').split(/^@@ .*@@.*$/m).slice(1)) {
    const source = hunk.split('\n').filter(line => line.startsWith(' ') || line.startsWith('+')).map(line => line.slice(1)).join('\n');
    for (const match of source.matchAll(/(?:^|\n)\s*export\s+(type\s+)?\{([^{}]*)\}\s+from\s+(['"])(\.[^'"\n]*)\3/g)) {
      const importedPath = posix.normalize(posix.join(posix.dirname(file.filename), match[4]));
      if (importedPath !== originalPath && importedPath !== originalPath.replace(/\.[cm]?tsx?$/, '')) continue;
      for (const specifier of match[2].split(',')) {
        const alias = /^\s*(type\s+)?([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(specifier);
        if (alias && (match[1] || alias[1]) && alias[2] === rename.current && alias[3] === rename.previous) return true;
      }
    }
  }
  return false;
}

function contradictedMissingAlias(finding: Finding, file: ChangedFile, files: ChangedFile[]): boolean {
  if (!/\b(?:without|missing|no)\s+(?:an?\s+)?(?:matching\s+)?(?:type\s+)?(?:compatibility\s+)?(?:alias|re-export)\b/i.test(finding.en)) return false;
  const rename = renamedType(file, finding.line);
  if (!rename || !(finding.en.match(/[A-Za-z_$][\w$]*/g) ?? []).includes(rename.previous)) return false;
  return files.some(candidate => matchingTypeAlias(candidate, file.filename, rename));
}

function validateFindings(report: object, files: ChangedFile[]): Finding[] {
  const value = (report as { inlineFindings?: unknown }).inlineFindings;
  if (!Array.isArray(value)) return [];
  const findings: Finding[] = [];
  for (const item of value.slice(0, 3)) {
    if (!item || typeof item.path !== 'string' || !Number.isSafeInteger(item.line) || item.line < 1 ||
        !safeField(item.en) || !safeField(item.ko) || !/[가-힣]/.test(item.ko) || typeof item.evidence !== 'string') continue;
    const file = files.find(file => file.filename === item.path);
    const line = file && addedLineText(file.patch ?? '', item.line);
    if (!line?.trim() || line !== item.evidence || findings.some(f => f.path === item.path && f.line === item.line)) continue;
    if (file && contradictedMissingAlias(item, file, files)) continue;
    findings.push(item);
  }
  return findings;
}

export function specialistRole(target: Target, bot: string): Role | undefined {
  const role = target.advisoryIdentity;
  if (role && role !== 'triage' && target.advisory === role && bot === `oddmash-${role}[bot]`) return role;
}

export const verifiedReviewer = /^oddmash-(?:lead|impact|qa|release|docs|architect)\[bot\]$/;

const genericFindingWords = new Set(['about', 'against', 'affects', 'from', 'into', 'might', 'should', 'their', 'this', 'when', 'which', 'with', 'would']);

function findingWords(text: string) {
  const english = text.split('\n<details>', 1)[0].replace(/^<!--.*-->$/gm, '');
  return (english.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter(word => !genericFindingWords.has(word));
}

export function sameFindingText(left: string, right: string): boolean {
  const a = findingWords(left);
  const b = findingWords(right);
  const aWords = new Set(a);
  const bWords = new Set(b);
  const common = [...aWords].filter(word => bWords.has(word)).length;
  if (common < 5 || common * 3 < Math.min(aWords.size, bWords.size) * 2) return false;
  const comparable = b.join(' ');
  return a.some((_, index) => index <= a.length - 3 && ` ${comparable} `.includes(` ${a.slice(index, index + 3).join(' ')} `));
}

export async function publishSpecialistFindings(api: Api, target: Target, bot: string, head: string, report: object, files: ChangedFile[], current: () => Promise<boolean>) {
  const role = specialistRole(target, bot);
  if (!role || !target.number || !/^[a-f0-9]{40}$/i.test(head)) return;
  const findings = validateFindings(report, files);
  if (!findings.length) return;
  const path = `/repos/${target.repository}/pulls/${target.number}/comments`;
  const existing = new Set<string>();
  const currentFindings: { path: string; line: number; body: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api<{ body: string; user: { login: string; type: string }; path: string; line: number; side?: string; commit_id: string; in_reply_to_id?: number }[]>(`${path}?per_page=100&page=${page}`);
    for (const item of batch) {
      if (item.user.type !== 'Bot' || !verifiedReviewer.test(item.user.login) || item.in_reply_to_id) continue;
      const marker = /^<!-- oddmash-finding:([a-f0-9]{24}) -->/.exec(item.body);
      if (!marker) continue;
      if (item.user.login === bot) existing.add(marker[1]);
      if (item.commit_id === head && item.side !== 'LEFT' && Number.isSafeInteger(item.line)) currentFindings.push(item);
    }
    if (batch.length < 100) break;
    if (page === 10) { console.warn('Specialist inline comment lookup incomplete'); return; }
  }
  for (const finding of findings) {
    const id = createHash('sha256').update(JSON.stringify([role, head, finding.path, finding.line])).digest('hex').slice(0, 24);
    if (existing.has(id) || currentFindings.some(item =>
      item.path === finding.path && item.line === finding.line && sameFindingText(item.body, finding.en))) continue;
    if (!await current()) return;
    const body = `<!-- oddmash-finding:${id} -->\n<!-- oddmash-specialist:${role} -->\n${plain(finding.en)}\n\n<details>\n<summary>한국어 (Korean)</summary>\n\n${plain(finding.ko)}\n\n</details>`;
    try {
      await api(path, { method: 'POST', body: JSON.stringify({ body, commit_id: head, path: finding.path, line: finding.line, side: 'RIGHT' }) });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'GitHub request failed (422)') throw error;
      console.warn('Specialist inline anchor rejected by GitHub');
    }
  }
}
