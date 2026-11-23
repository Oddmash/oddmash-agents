import { createHash } from 'node:crypto';

export type ChangedFile = { filename: string; patch?: string; status: string };
export type Finding = { path: string; line: number; severity: 'high' | 'medium' | 'low'; confidence: 'high' | 'medium'; rule: string; evidence: string; recommendation: string; verification: string; suggestion?: string };
export type ReviewContext = { repository: string; number: number; head: string; title: string; files: ChangedFile[]; guidance: Record<string, string>; checks: { name: string; status: string; conclusion: string | null }[]; omitted: string[] };

export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export function checksPassed(checks: ReviewContext['checks']): boolean {
  if (!checks.length || checks.some(check => check.status !== 'completed' || !['success', 'skipped'].includes(check.conclusion ?? ''))) return false;
  if (checks.some(check => check.conclusion === 'skipped')) return checks.some(check => /^(?:CI \/ )?verify$/.test(check.name) && check.conclusion === 'success');
  return checks.every(check => check.conclusion === 'success');
}

export function reviewDecision(context: ReviewContext, findings: Finding[], modelValid: boolean): ReviewDecision {
  if (!modelValid || !context.files.length) return 'COMMENT';
  if (findings.some(finding => finding.confidence === 'high' && ['high', 'medium'].includes(finding.severity))) return 'REQUEST_CHANGES';
  if (findings.length || context.omitted.length || !checksPassed(context.checks)) return 'COMMENT';
  return 'APPROVE';
}

const sensitivePath = /(^|\/)(\.env[^/]*|[^/]*(?:secret|credential|private[-_]?key)[^/]*|[^/]*\.(?:pem|key|p12|pfx))$/i;
const sensitiveValue = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-|AKIA)[A-Za-z0-9_-]{12,}|\b(?:password|api[_-]?key|token|secret|authorization)\s*[:=]\s*["']?[^\s"']{8,})/i;

export function safeText(value: string): string {
  return value.split('\n').map(line => sensitiveValue.test(line) ? '[REDACTED]' : line).join('\n');
}

export function selectFiles(files: ChangedFile[], budget = 45_000): { files: ChangedFile[]; omitted: string[] } {
  const selected: ChangedFile[] = [];
  const omitted: string[] = [];
  let remaining = budget;
  for (const file of files) {
    if (sensitivePath.test(file.filename) || !file.patch || file.patch.length > remaining || selected.length >= 40 || sensitiveValue.test(file.patch)) {
      omitted.push(file.filename);
      continue;
    }
    selected.push({ filename: file.filename, status: file.status, patch: file.patch });
    remaining -= file.patch.length;
  }
  return { files: selected, omitted };
}

export function addedLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let position = 0;
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { position = Number(hunk[1]); continue; }
    if (!position || line.startsWith('\\')) continue;
    if (line.startsWith('+')) { lines.add(position); position++; }
    else if (line.startsWith(' ')) position++;
  }
  return lines;
}

function addedLineText(patch: string, target: number): string | undefined {
  let position = 0;
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { position = Number(hunk[1]); continue; }
    if (!position || line.startsWith('\\')) continue;
    if (line.startsWith('+')) { if (position === target) return line.slice(1); position++; }
    else if (line.startsWith(' ')) position++;
  }
}

export function guidancePaths(files: ChangedFile[]): string[] {
  const paths = new Set(['AGENTS.md']);
  for (const file of files) {
    const parts = file.filename.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) paths.add(`${parts.slice(0, i).join('/')}/AGENTS.md`);
  }
  return [...paths].slice(0, 40);
}

export function validateFindings(value: unknown, files: ChangedFile[]): Finding[] {
  if (!Array.isArray(value)) throw new Error('Invalid findings response');
  const known = new Map(files.map(file => [file.filename, addedLines(file.patch ?? '')]));
  const unique = new Set<string>();
  const result: Finding[] = [];
  for (const item of value.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Finding;
    if (typeof f.path !== 'string' || !Number.isInteger(f.line) || !known.get(f.path)?.has(f.line)) continue;
    if (!['high', 'medium', 'low'].includes(f.severity) || !['high', 'medium'].includes(f.confidence)) continue;
    if (![f.rule, f.evidence, f.recommendation, f.verification].every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 1000 && !sensitiveValue.test(x))) continue;
    const key = `${f.path}:${f.line}:${f.rule.toLowerCase().trim()}`;
    if (unique.has(key)) continue;
    unique.add(key);
    const original = addedLineText(files.find(file => file.filename === f.path)?.patch ?? '', f.line);
    const suggestion = typeof f.suggestion === 'string' && f.confidence === 'high' && /\.(?:tsx?|jsx?|css|scss)$/.test(f.path) && !/(?:^|\/)(?:\.github|scripts|server|auth|security)(?:\/|$)/i.test(f.path) && !/security|privacy|credential|authorization|authentication/i.test(f.rule) && f.suggestion.trim().length > 0 && f.suggestion.length <= 1000 && f.suggestion.split('\n').length <= 8 && !/```|[\u0000-\u0008\u000b-\u001f\u007f]/.test(f.suggestion) && !sensitiveValue.test(f.suggestion) && original !== undefined && f.suggestion !== original ? f.suggestion : undefined;
    result.push({ path: f.path, line: f.line, severity: f.severity, confidence: f.confidence, rule: f.rule, evidence: f.evidence, recommendation: f.recommendation, verification: f.verification, ...(suggestion ? { suggestion } : {}) });
  }
  return result;
}

const clean = (value: string) => safeText(value).replace(/[<>]/g, '').replace(/@/g, '@\u200b').replace(/\r/g, '').replace(/\n/g, ' ').replace(/\s*[\u2013\u2014\u2015]\s*/g, ' - ');
export function reviewMarker(context: ReviewContext): string {
  const id = createHash('sha256').update(`${context.repository}:${context.number}:${context.head}`).digest('hex').slice(0, 24);
  return `<!-- oddmash-review:${id} -->`;
}

export function findingMarker(context: ReviewContext, finding: Finding): string {
  const id = createHash('sha256').update(`${context.repository}:${context.number}:${context.head}:${finding.path}:${finding.line}:${finding.rule.toLowerCase().trim()}`).digest('hex').slice(0, 24);
  return `<!-- oddmash-finding:${id} -->`;
}

export function inlineComment(context: ReviewContext, finding: Finding): string {
  const lines = [findingMarker(context, finding), `**${finding.severity.toUpperCase()}: ${clean(finding.rule)}**`, '', clean(finding.evidence), '', `Fix: ${clean(finding.recommendation)}`];
  if (finding.severity === 'high') lines.push('', `Verify: ${clean(finding.verification)}`);
  if (finding.suggestion) lines.push('', '```suggestion', finding.suggestion, '```');
  return lines.join('\n');
}

export function formatReport(context: ReviewContext, findings: Finding[]): string {
  const lines = [reviewMarker(context)];
  if (!findings.length) lines.push('No actionable findings in the reviewed changes. This is not an approval or proof of correctness.');
  for (const f of findings) {
    lines.push(`- **${f.severity.toUpperCase()}: ${clean(f.rule)}** (${clean(f.path)}:${f.line}): ${clean(f.recommendation)}`);
  }
  if (context.omitted.length) lines.push('Some changes require manual review.');
  return lines.join('\n');
}

export function formatReviewBody(event: ReviewDecision, marker: string, report: string): string {
  if (event === 'APPROVE') return `${marker}\nThanks for contributing! @qtaghdi, this PR is ready for your review.`;
  if (event === 'REQUEST_CHANGES') return `${marker}\nPlease address the findings before approval.\n\n${report}`;
  return `${marker}\nMaintainer review required.\n\n${report}`;
}
