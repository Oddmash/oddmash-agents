import { createHash } from 'node:crypto';

export type ChangedFile = { filename: string; previous_filename?: string; patch?: string; status: string; additions?: number; deletions?: number };
export type KoreanFinding = { rule: string; evidence: string; recommendation: string; verification: string };
export type Finding = { path: string; line: number; severity: 'high' | 'medium' | 'low'; confidence: 'high' | 'medium'; rule: string; evidence: string; recommendation: string; verification: string; suggestion?: string; korean?: KoreanFinding };
export type ReviewContext = { repository: string; number: number; head: string; title: string; files: ChangedFile[]; guidance: Record<string, string>; checks: { name: string; status: string; conclusion: string | null }[]; omitted: string[] };

export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export function checksPassed(checks: ReviewContext['checks']): boolean {
  if (!checks.length || checks.some(check => check.status !== 'completed' || !['success', 'skipped'].includes(check.conclusion ?? ''))) return false;
  if (checks.some(check => check.conclusion === 'skipped')) return checks.some(check => /^(?:CI \/ )?verify$/.test(check.name) && check.conclusion === 'success');
  return checks.every(check => check.conclusion === 'success');
}

export function reviewAssessment(context: ReviewContext, findings: Finding[], modelValid: boolean): ReviewDecision {
  if (!modelValid || !context.files.length) return 'COMMENT';
  if (findings.some(finding => finding.confidence === 'high' && ['high', 'medium'].includes(finding.severity))) return 'REQUEST_CHANGES';
  if (findings.length || context.omitted.length) return 'COMMENT';
  return 'APPROVE';
}

export function reviewDecision(context: ReviewContext, findings: Finding[], modelValid: boolean): ReviewDecision {
  const assessment = reviewAssessment(context, findings, modelValid);
  return assessment === 'APPROVE' && !checksPassed(context.checks) ? 'COMMENT' : assessment;
}

const sensitivePath = /(^|\/)(\.env[^/]*|[^/]*(?:secret|credential|private[-_]?key)[^/]*|[^/]*\.(?:pem|key|p12|pfx))$/i;
const sensitiveValue = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp_|github_pat_|sk-|AKIA)[A-Za-z0-9_-]{12,}|\b(?:password|api[_-]?key|token|secret|authorization)\s*[:=]\s*["']?[^\s"']{8,})/i;

export function safeText(value: string): string {
  return value.split('\n').map(line => sensitiveValue.test(line) ? '[REDACTED]' : line).join('\n');
}

const privateSensitivePath = /(?:^|\/)(?:\.github|\.vercel|\.aws|\.ssh|\.npmrc|\.pypirc|\.netrc|infra|infrastructure|config|configs|\.config|\.kube|\.docker|certs?|certificates|data|dumps|uploads|logs|fixtures|deploy(?:ment)?|auth(?:entication|orization)?|security|credentials?|secrets?|keys?)(?:\/|$)|(?:webhook|private[-_]?key|credential|(?:^|[-_./])(?:token|secret|auth|security|deploy|vercel|firebase|service[-_]?account)(?:[-_./]|$)|\.(?:crt|cer|keystore|jks|kdbx|env|tfvars|tfstate|sqlite|sqlite3|csv)$)/i;
const privateSensitiveValue = /(?:\b(?:gh[opsu]_|github_pat_|xox[baprs]-|sk[-_]|AIza|AKIA|ASIA|ya29\.|glpat-)[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^/\s@]+@|["'][A-Za-z0-9+/_=-]{40,}["'])/i;
export const privateSensitiveText = (value: string) => sensitiveValue.test(value) || privateSensitiveValue.test(value);

export function patchComplete(file: ChangedFile): boolean {
  if (!file.patch) return false;
  const lines = file.patch.split('\n');
  return (file.additions === undefined || lines.filter(line => line.startsWith('+')).length === file.additions) && (file.deletions === undefined || lines.filter(line => line.startsWith('-')).length === file.deletions);
}

export function selectFiles(files: ChangedFile[], budget = 45_000, privateReview = false): { files: ChangedFile[]; omitted: string[] } {
  const selected: ChangedFile[] = [];
  const omitted: string[] = [];
  let remaining = budget;
  for (const file of files) {
    if (sensitivePath.test(file.filename) || (file.previous_filename && sensitivePath.test(file.previous_filename)) || (privateReview && (privateSensitivePath.test(file.filename) || (file.previous_filename && privateSensitivePath.test(file.previous_filename)) || privateSensitiveText(file.filename) || (file.patch && privateSensitiveText(file.patch)))) || !file.patch || !patchComplete(file) || file.patch.length > remaining || selected.length >= 40 || sensitiveValue.test(file.patch)) {
      omitted.push(privateReview ? 'Omitted private file' : file.filename);
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

export function validateFindings(value: unknown, files: ChangedFile[], privateReview = false): Finding[] {
  if (!Array.isArray(value)) throw new Error('Invalid findings response');
  const known = new Map(files.map(file => [file.filename, addedLines(file.patch ?? '')]));
  const unique = new Set<string>();
  const result: Finding[] = [];
  for (const item of value.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Finding;
    if (typeof f.path !== 'string' || !Number.isInteger(f.line) || !known.get(f.path)?.has(f.line)) continue;
    if (!['high', 'medium', 'low'].includes(f.severity) || !['high', 'medium'].includes(f.confidence)) continue;
    if (![f.rule, f.evidence, f.recommendation, f.verification].every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 1000 && !sensitiveValue.test(x) && (!privateReview || !privateSensitiveText(x)))) continue;
    const key = `${f.path}:${f.line}:${f.rule.toLowerCase().trim()}`;
    if (unique.has(key)) continue;
    unique.add(key);
    const original = addedLineText(files.find(file => file.filename === f.path)?.patch ?? '', f.line);
    const suggestion = typeof f.suggestion === 'string' && f.confidence === 'high' && /\.(?:tsx?|jsx?|css|scss)$/.test(f.path) && !/(?:^|\/)(?:\.github|scripts|server|auth|security)(?:\/|$)/i.test(f.path) && !/security|privacy|credential|authorization|authentication/i.test(f.rule) && f.suggestion.trim().length > 0 && f.suggestion.length <= 1000 && f.suggestion.split('\n').length <= 8 && !/```|[\u0000-\u0008\u000b-\u001f\u007f]/.test(f.suggestion) && !sensitiveValue.test(f.suggestion) && (!privateReview || !privateSensitiveText(f.suggestion)) && original !== undefined && f.suggestion !== original ? f.suggestion : undefined;
    const korean = f.korean;
    const translated = korean && typeof korean === 'object' && [korean.rule, korean.evidence, korean.recommendation, korean.verification].every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 1000 && !sensitiveValue.test(x) && (!privateReview || !privateSensitiveText(x)) && /[가-힣]/.test(x)) ? { rule: korean.rule, evidence: korean.evidence, recommendation: korean.recommendation, verification: korean.verification } : undefined;
    result.push({ path: f.path, line: f.line, severity: f.severity, confidence: f.confidence, rule: f.rule, evidence: f.evidence, recommendation: f.recommendation, verification: f.verification, ...(suggestion ? { suggestion } : {}), ...(translated ? { korean: translated } : {}) });
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

const koreanText = (value: string) => clean(value).replace(/[\[\]`*_!]/g, match => '\\' + match);
const koreanDetails = (lines: string[]) => ['<details>', '<summary>한국어 (Korean)</summary>', '', ...lines, '', '</details>'].join('\n');

export function inlineComment(context: ReviewContext, finding: Finding): string {
  const lines = [findingMarker(context, finding), `**${finding.severity.toUpperCase()}: ${clean(finding.rule)}**`, '', clean(finding.evidence), '', `Fix: ${clean(finding.recommendation)}`];
  if (finding.severity === 'high') lines.push('', `Verify: ${clean(finding.verification)}`);
  if (finding.suggestion) lines.push('', '```suggestion', finding.suggestion, '```');
  if (finding.korean) {
    const ko = finding.korean;
    const translated = [koreanText(ko.rule), '', koreanText(ko.evidence), '', `수정: ${koreanText(ko.recommendation)}`];
    if (finding.severity === 'high') translated.push('', `확인: ${koreanText(ko.verification)}`);
    lines.push('', koreanDetails(translated));
  }
  return lines.join('\n');
}

export function formatReport(context: ReviewContext, findings: Finding[], modelValid = true): string {
  const lines = [reviewMarker(context)];
  if (!findings.length) lines.push('No validated findings in the reviewed changes. This is not an approval or proof of correctness.');
  for (const f of findings) {
    lines.push(`- **${f.severity.toUpperCase()}: ${clean(f.rule)}** (${clean(f.path)}:${f.line}): ${clean(f.recommendation)}`);
  }
  if (context.omitted.length) lines.push('Some changes require manual review.');
  if (!context.files.length) lines.push('No changed file could be reviewed.');
  else if (!modelValid) lines.push('The review response contained findings that could not be validated against the changed lines.');
  const translated = findings.filter(f => f.korean).map(f => `- **${f.severity.toUpperCase()}: ${koreanText(f.korean!.rule)}** (${clean(f.path)}:${f.line}): ${koreanText(f.korean!.recommendation)}`);
  if (!findings.length) translated.push('검토한 변경 사항에서 확인된 문제는 없습니다. 승인 또는 정확성을 보장하지 않습니다.');
  if (context.omitted.length) translated.push('일부 변경 사항은 수동 검토가 필요합니다.');
  if (!context.files.length) translated.push('검토할 수 있는 변경 파일이 없습니다.');
  else if (!modelValid) translated.push('리뷰 응답에 변경된 줄을 기준으로 검증할 수 없는 결과가 포함되었습니다.');
  if (translated.length) lines.push('', koreanDetails(translated));
  return lines.join('\n');
}

export function formatReviewBody(event: ReviewDecision, marker: string, report: string): string {
  if (event === 'APPROVE') return `${marker}\nThanks for contributing! @qtaghdi, this PR is ready for your review.`;
  if (event === 'REQUEST_CHANGES') return `${marker}\nPlease address the findings before approval.\n\n${report}`;
  return `${marker}\nMaintainer review required.\n\n${report}`;
}
