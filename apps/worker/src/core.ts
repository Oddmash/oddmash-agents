import { createHash } from 'node:crypto';

export type ChangedFile = { filename: string; previous_filename?: string; patch?: string; status: string; additions?: number; deletions?: number };
export type KoreanFinding = { rule: string; evidence: string; recommendation: string; verification: string };
export type BlockingEvidence = { excerpt: string; impact: string; requirement: string };
export type Finding = { path: string; line: number; side?: 'LEFT' | 'RIGHT'; severity: 'high' | 'medium' | 'low'; confidence: 'high' | 'medium'; rule: string; evidence: string; recommendation: string; verification: string; blockingEvidence?: BlockingEvidence; suggestion?: string; korean?: KoreanFinding; relatedLocations?: { path: string; line: number }[] };
export type ReviewContext = { repository: string; number: number; head: string; title: string; files: ChangedFile[]; guidance: Record<string, string>; checks: { name: string; status: string; conclusion: string | null }[]; omitted: string[]; relatedBaseFiles?: Record<string, string>; changedHeadFiles?: Record<string, string>; focus?: string[]; feedback?: string[]; confirmedEmpty?: true };

export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
export type ReviewFollowUp = { advisory: boolean; incompleteCoverage: boolean; invalidEvidence: boolean; maintainerFindings?: boolean; confirmedEmpty?: true };

export function isMaintainerReviewAuthor(author?: { id: number; login: string }): boolean {
  return author?.id === 135234546 && author.login === 'qtaghdi';
}

export function publicationFollowUp(followUp: ReviewFollowUp, assessment: ReviewDecision, author?: { id: number; login: string }): ReviewFollowUp {
  return assessment === 'REQUEST_CHANGES' && isMaintainerReviewAuthor(author) ? { ...followUp, maintainerFindings: true } : followUp;
}

function isConfirmedEmpty(context: ReviewContext, findings: Finding[]): boolean {
  return context.confirmedEmpty === true && context.files.length === 0 && context.omitted.length === 0 && findings.length === 0;
}

export function reviewFollowUp(context: ReviewContext, findings: Finding[], modelValid: boolean): ReviewFollowUp {
  if (isConfirmedEmpty(context, findings)) return { advisory: false, incompleteCoverage: false, invalidEvidence: false, confirmedEmpty: true };
  return { advisory: findings.some(finding => !isBlockingFinding(context, finding)), incompleteCoverage: !context.files.length || context.omitted.length > 0, invalidEvidence: !modelValid };
}

export function reviewOutcome(event: ReviewDecision, followUp?: ReviewFollowUp): { label: string; title: string } {
  if (event === 'APPROVE') return { label: 'review: approved', title: 'Review approved' };
  if (event === 'REQUEST_CHANGES') return { label: 'review: changes requested', title: 'Changes requested' };
  if (followUp?.maintainerFindings) return { label: 'review: needs human', title: 'Actionable findings for maintainer decision' };
  if (!followUp || followUp.incompleteCoverage || followUp.invalidEvidence) return { label: 'review: needs human', title: 'Review coverage or evidence incomplete' };
  if (followUp.confirmedEmpty) return { label: 'review: follow-up', title: 'No changed files' };
  return { label: 'review: follow-up', title: followUp.advisory ? 'Advisory findings to consider' : 'Review approval pending checks' };
}

export function checksPassed(checks: ReviewContext['checks']): boolean {
  if (!checks.length || checks.some(check => check.status !== 'completed' || !['success', 'skipped'].includes(check.conclusion ?? ''))) return false;
  if (checks.some(check => check.conclusion === 'skipped')) return checks.some(check => /^(?:CI \/ )?verify$/.test(check.name) && check.conclusion === 'success');
  return checks.every(check => check.conclusion === 'success');
}

export function isBlockingFinding(context: ReviewContext, finding: Finding): boolean {
  return finding.confidence === 'high' && ['high', 'medium'].includes(finding.severity) && validatedBlockingEvidence(finding, context.files) !== undefined;
}

export function reviewAssessment(context: ReviewContext, findings: Finding[], modelValid: boolean): ReviewDecision {
  if (!modelValid || !context.files.length) return 'COMMENT';
  if (findings.some(finding => isBlockingFinding(context, finding))) return 'REQUEST_CHANGES';
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

const confidentialPath = /(?:^|\/)(?:\.aws|\.ssh|\.vercel|\.kube|\.docker|\.npmrc|\.pypirc|\.netrc|certs?|certificates|data|dumps|uploads|logs|fixtures|credentials?|secrets?|keys?)(?:\/|$)|\.(?:crt|cer|keystore|jks|kdbx|env|tfvars|tfstate|sqlite|sqlite3|csv)$/i;
const ordinaryManifest = /^(?:\.github\/workflows\/(?:ci|verify|test|build|lint|typecheck|deploy|release|prepare-release|pages)\.ya?ml|(?:package|tsconfig(?:\.[a-z]+)?|vercel)\.json|(?:next|vite|vitest|eslint|prettier|tailwind|postcss)\.config\.[cm]?[jt]s|(?:Dockerfile|docker-compose\.ya?ml|compose\.ya?ml))$/i;
const confidentialName = /(?:^|\/)[^/]*(?:secret|credential|private[-_]?key|service[-_]?account)[^/]*(?:\/|$)/i;
const ordinaryAuthSource = /^src\/(?:(?:auth(?:entication|orization)?|security)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+|(?:auth(?:entication|orization)?|security))\.[cm]?[jt]sx?$/i;
const ordinaryReviewWebhook = /^(?:src\/webhook-review\.ts|tests\/webhook-review\.test\.ts)$/;
const qualityPath = (path: string) => ordinaryReviewWebhook.test(path) || ordinaryManifest.test(path) || (ordinaryAuthSource.test(path) && !/(?:^|[-_./])(?:token|webhook|firebase|deploy|vercel)(?:[-_./]|$)/i.test(path));
const explicitlyConfidential = (path: string) => sensitivePath.test(path) || confidentialPath.test(path) || confidentialName.test(path) || privateSensitiveText(path);

function sensitiveReviewPatch(patch: string, filename: string, privateReview: boolean, quality: boolean): boolean {
  if (!privateReview || !quality || !/\.[cm]?[jt]sx?$/i.test(filename)) {
    return privateReview || quality ? privateSensitiveText(patch) : sensitiveValue.test(patch);
  }
  // A standalone environment lookup names a setting without supplying its value.
  const reference = /^[ +\-][ \t]*(?:const|let)[ \t]+[a-z_$][\w$]*[ \t]*=[ \t]*process\.env\.([A-Z_][A-Z0-9_]*)[ \t]*;?[ \t]*$/gim;
  return privateSensitiveText(patch.replace(reference, '$1'));
}

export function patchComplete(file: ChangedFile): boolean {
  if (!file.patch) return false;
  let oldRemaining = 0, newRemaining = 0, additions = 0, deletions = 0;
  let sawHunk = false;
  for (const line of file.patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      if (oldRemaining || newRemaining) return false;
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
      sawHunk = true;
      continue;
    }
    if (!sawHunk || line.startsWith('\\')) continue;
    if (!oldRemaining && !newRemaining && line === '') continue;
    if (line.startsWith('+')) { additions++; newRemaining--; }
    else if (line.startsWith('-')) { deletions++; oldRemaining--; }
    else if (line.startsWith(' ')) { oldRemaining--; newRemaining--; }
    else return false;
    if (oldRemaining < 0 || newRemaining < 0) return false;
  }
  return sawHunk && oldRemaining === 0 && newRemaining === 0 && (file.additions === undefined || additions === file.additions) && (file.deletions === undefined || deletions === file.deletions);
}

export type OmissionReason = 'protected' | 'private-policy' | 'sensitive' | 'image' | 'lockfile' | 'missing-patch' | 'incomplete-patch' | 'budget' | 'file-limit' | 'pagination' | 'file-list-metadata' | 'guidance-unavailable';
export type OmissionDetail = { reason: OmissionReason; path?: string; count?: number };

export function selectFiles(files: ChangedFile[], budget = 45_000, privateReview = false, purpose: 'strict' | 'quality' = 'strict'): { files: ChangedFile[]; omitted: string[]; omissionDetails: OmissionDetail[] } {
  const selected: ChangedFile[] = [];
  const omitted: string[] = [];
  const omissionDetails: OmissionDetail[] = [];
  let remaining = budget;
  const quality = purpose === 'quality';
  for (const file of files) {
    const paths = [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])];
    const protectedPath = paths.some(path => sensitivePath.test(path) || (quality && explicitlyConfidential(path)));
    const privateExcluded = privateReview && paths.some(path => privateSensitiveText(path) || (privateSensitivePath.test(path) && !(quality && qualityPath(path))));
    let reason: OmissionReason | undefined;
    if (protectedPath) reason = 'protected';
    else if (privateExcluded) reason = 'private-policy';
    else if (file.patch && sensitiveReviewPatch(file.patch, file.filename, privateReview, quality)) reason = 'sensitive';
    else if (/(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|uv\.lock|poetry\.lock)$/.test(file.filename) && (!file.patch || !patchComplete(file))) reason = 'lockfile';
    else if (!file.patch) reason = /\.(?:png|jpe?g|webp|gif|avif|ico|bmp|tiff?)$/i.test(file.filename) ? 'image' : 'missing-patch';
    else if (!patchComplete(file)) reason = 'incomplete-patch';
    else if (file.patch.length > remaining) reason = 'budget';
    else if (selected.length >= 40) reason = 'file-limit';
    if (reason) {
      const privateReportPath = privateReview && quality && !protectedPath &&
        (!file.previous_filename || !privateSensitivePath.test(file.previous_filename) || qualityPath(file.previous_filename));
      const hidden = privateReview || reason === 'protected' || reason === 'sensitive' || privateSensitiveText(file.filename);
      omitted.push(privateReview ? 'Omitted private file' : hidden ? 'Omitted protected file' : file.filename);
      // Coverage paths are rendered in the PR only. Private model omissions use anonymous entries.
      const path = (!hidden || privateReportPath) && /^[A-Za-z0-9_./ -]{1,180}$/.test(file.filename) ? file.filename : undefined;
      omissionDetails.push({ reason, ...(path ? { path } : {}) });
      continue;
    }
    selected.push({ filename: file.filename, status: file.status, patch: file.patch! });
    remaining -= file.patch!.length;
  }
  return { files: selected, omitted, omissionDetails };
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

export function deletedLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let position = 0;
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk) { position = Number(hunk[1]); continue; }
    if (!position) continue;
    if (line.startsWith('-')) { lines.add(position); position++; }
    else if (line.startsWith(' ')) position++;
  }
  return lines;
}

export function addedLineText(patch: string, target: number): string | undefined {
  let position = 0;
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { position = Number(hunk[1]); continue; }
    if (!position || line.startsWith('\\')) continue;
    if (line.startsWith('+')) { if (position === target) return line.slice(1); position++; }
    else if (line.startsWith(' ')) position++;
  }
}

function validatedBlockingEvidence(finding: Finding, files: ChangedFile[], privateReview = false): BlockingEvidence | undefined {
  if (finding.side === 'LEFT') return undefined;
  const proof = finding.blockingEvidence;
  if (!proof || typeof proof !== 'object') return undefined;
  const fields = [proof.excerpt, proof.impact, proof.requirement];
  if (!fields.every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000 && !sensitiveValue.test(value) && (!privateReview || !privateSensitiveText(value)))) return undefined;
  const file = files.find(file => file.filename === finding.path);
  if (!file || !patchComplete(file)) return undefined;
  const line = addedLineText(file.patch ?? '', finding.line);
  if (!line || proof.excerpt.trim() !== line.trim() || proof.excerpt.trim().length < 3) return undefined;
  return { excerpt: proof.excerpt, impact: proof.impact, requirement: proof.requirement };
}

export function guidancePaths(files: readonly Pick<ChangedFile, 'filename'>[]): string[] {
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
  const removed = new Map(files.map(file => [file.filename, deletedLines(file.patch ?? '')]));
  const unique = new Set<string>();
  const result: Finding[] = [];
  for (const item of value.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Finding;
    if (f.side !== undefined && f.side !== 'LEFT' && f.side !== 'RIGHT') continue;
    if (typeof f.path !== 'string' || !Number.isInteger(f.line) || !(f.side === 'LEFT' ? removed : known).get(f.path)?.has(f.line)) continue;
    if (!['high', 'medium', 'low'].includes(f.severity) || !['high', 'medium'].includes(f.confidence)) continue;
    if (![f.rule, f.evidence, f.recommendation, f.verification].every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 1000 && !sensitiveValue.test(x) && (!privateReview || !privateSensitiveText(x)))) continue;
    const key = `${f.path}:${f.side ?? 'RIGHT'}:${f.line}:${f.rule.toLowerCase().trim()}`;
    if (unique.has(key)) continue;
    unique.add(key);
    const original = addedLineText(files.find(file => file.filename === f.path)?.patch ?? '', f.line);
    const suggestion = typeof f.suggestion === 'string' && f.confidence === 'high' && /\.(?:tsx?|jsx?|css|scss)$/.test(f.path) && !/(?:^|\/)(?:\.github|scripts|server|auth|security)(?:\/|$)/i.test(f.path) && !ordinaryAuthSource.test(f.path) && !/security|privacy|credential|authorization|authentication/i.test(f.rule) && f.suggestion.trim().length > 0 && f.suggestion.length <= 1000 && f.suggestion.split('\n').length <= 8 && !/```|[\u0000-\u0008\u000b-\u001f\u007f]/.test(f.suggestion) && !sensitiveValue.test(f.suggestion) && (!privateReview || !privateSensitiveText(f.suggestion)) && original !== undefined && f.suggestion !== original ? f.suggestion : undefined;
    const korean = f.korean;
    const translated = korean && typeof korean === 'object' && [korean.rule, korean.evidence, korean.recommendation, korean.verification].every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 1000 && !sensitiveValue.test(x) && (!privateReview || !privateSensitiveText(x)) && /[가-힣]/.test(x)) ? { rule: korean.rule, evidence: korean.evidence, recommendation: korean.recommendation, verification: korean.verification } : undefined;
    const blockingEvidence = validatedBlockingEvidence(f, files, privateReview);
    result.push({ path: f.path, line: f.line, ...(f.side === 'LEFT' ? { side: 'LEFT' as const } : {}), severity: f.severity, confidence: f.confidence, rule: f.rule, evidence: f.evidence, recommendation: f.recommendation, verification: f.verification, ...(blockingEvidence ? { blockingEvidence } : {}), ...(suggestion && f.side !== 'LEFT' ? { suggestion } : {}), ...(translated ? { korean: translated } : {}) });
  }
  return result;
}

const clean = (value: string) => safeText(value).replace(/<(?=[A-Za-z/!?])/g, '&lt;').replace(/@/g, '@\u200b').replace(/\r/g, '').replace(/\n/g, ' ').replace(/\s*[\u2013\u2014\u2015]\s*/g, ' - ');
export function reviewMarker(context: ReviewContext): string {
  const id = createHash('sha256').update(`${context.repository}:${context.number}:${context.head}`).digest('hex').slice(0, 24);
  return `<!-- oddmash-review:${id} -->`;
}

export function findingMarker(context: ReviewContext, finding: Finding): string {
  const id = createHash('sha256').update(`${context.repository}:${context.number}:${context.head}:${finding.path}:${finding.side === 'LEFT' ? 'LEFT:' : ''}${finding.line}:${finding.rule.toLowerCase().trim()}`).digest('hex').slice(0, 24);
  return `<!-- oddmash-finding:${id} -->`;
}

const koreanText = (value: string) => clean(value).replace(/[\[\]`*_!]/g, match => '\\' + match);
const relatedLocations = (finding: Finding) => (finding.relatedLocations ?? []).map(location => `${clean(location.path)}:${location.line}`).join(', ');
const koreanDetails = (lines: string[]) => ['<details>', '<summary>한국어 (Korean)</summary>', '', ...lines, '', '</details>'].join('\n');

export function inlineComment(context: ReviewContext, finding: Finding): string {
  const blocking = isBlockingFinding(context, finding);
  const lines = [findingMarker(context, finding), `**${blocking ? 'BLOCKING' : 'ADVISORY'} / ${finding.severity.toUpperCase()}: ${clean(finding.rule)}**`, '', clean(finding.evidence), '', `${blocking ? 'Fix' : 'Consider'}: ${clean(finding.recommendation)}`];
  lines.push('', `Verify: ${clean(finding.verification)}`);
  const related = relatedLocations(finding);
  if (related) lines.push('', '<!-- oddmash-grouped-finding -->', `Also affects: ${related}. Verify every listed location before resolving.`, `관련 위치: ${related}. 모든 위치를 확인한 뒤 해결 처리하세요.`);
  if (finding.suggestion) lines.push('', '```suggestion', finding.suggestion, '```');
  if (finding.korean) {
    const ko = finding.korean;
    const translated = [koreanText(ko.rule), '', koreanText(ko.evidence), '', `${blocking ? '수정' : '제안'}: ${koreanText(ko.recommendation)}`];
    translated.push('', `확인: ${koreanText(ko.verification)}`);
    lines.push('', koreanDetails(translated));
  }
  return lines.join('\n');
}

const omissionActions: Record<OmissionReason, [string, string]> = {
  protected: ['Confidential path. Inspect the change locally.', '민감 경로입니다. 변경 사항을 로컬에서 확인하세요.'],
  'private-policy': ['Path requires local review. Inspect the change in Files changed.', '수동 검토 대상 경로입니다. Files changed에서 변경 사항을 확인하세요.'],
  sensitive: ['Potentially sensitive content excluded; inspect locally and confirm that no sensitive values are committed.', '민감할 수 있는 내용이 제외되었습니다. 로컬에서 확인하고 민감한 값이 커밋되지 않았는지 검증하세요.'],
  image: ['Image has no text diff; compare before/after captures for layout, readability, and sensitive information.', '이미지의 텍스트 diff가 없습니다. 이전·이후 캡처의 레이아웃, 가독성, 민감한 정보 노출을 확인하세요.'],
  lockfile: ['Generated dependency lockfile lacks a complete text diff. Check the declared dependency changes, frozen installation and relevant dependency verification; passing CI alone does not establish full diff coverage.', '생성된 의존성 잠금 파일의 전체 텍스트 diff가 없습니다. 선언된 의존성 변경, 고정 설치 및 관련 의존성 검증을 확인하세요. CI 통과만으로 전체 diff 검토가 완료된 것은 아닙니다.'],
  'missing-patch': ['GitHub did not provide a text diff; open the file in Files changed and compare the base and head versions.', 'GitHub가 텍스트 diff를 제공하지 않았습니다. Files changed에서 파일의 이전·이후 버전을 비교하세요.'],
  'incomplete-patch': ['GitHub diff is incomplete; inspect the complete file diff and affected behavior.', 'GitHub diff가 불완전합니다. 전체 파일 변경과 영향을 받는 동작을 확인하세요.'],
  budget: ['Review size budget exceeded; inspect the remaining changes and relevant regression tests.', '리뷰 분량 제한을 초과했습니다. 남은 변경 사항과 관련 회귀 테스트를 확인하세요.'],
  'file-limit': ['Review file limit reached; inspect remaining files and their relevant tests.', '리뷰 파일 수 제한에 도달했습니다. 남은 파일과 관련 테스트를 확인하세요.'],
  pagination: ['Files beyond the fetched page were not reviewed; inspect the remaining Files changed entries.', '조회한 페이지 이후의 파일은 검토되지 않았습니다. Files changed의 나머지 파일을 확인하세요.'],
  'guidance-unavailable': ['Organization guidance could not be retrieved; verify the applicable policy before approval.', '조직 지침을 가져오지 못했습니다. 승인 전에 적용 정책을 확인하세요.'],
  'file-list-metadata': ['GitHub file-list metadata was missing or inconsistent; confirm the complete Files changed listing before approval.', 'GitHub 변경 파일 목록의 메타데이터가 없거나 일치하지 않습니다. 승인 전에 Files changed 전체 목록을 확인하세요.']
};

function manualReviewLines(details: OmissionDetail[], language: 0 | 1): string[] {
  const groups = new Map<OmissionReason, { count: number; paths: string[] }>();
  for (const item of details) {
    const group = groups.get(item.reason) ?? { count: 0, paths: [] };
    group.count += item.count ?? 1;
    if (item.path) group.paths.push(item.path);
    groups.set(item.reason, group);
  }
  let remaining = 12;
  return [...groups].map(([reason, group]) => {
    const paths = group.paths.slice(0, remaining);
    remaining -= paths.length;
    const location = paths.length ? paths.map(path => `\`${path}\``).join(', ') : language === 0 ? 'Files requiring separate verification' : '별도 검증이 필요한 파일';
    const unlisted = group.count - paths.length;
    return `- ${location}${unlisted ? ` (${language === 0 ? `${unlisted} unlisted` : `미표시 ${unlisted}개`})` : ''}: ${omissionActions[reason][language]}`;
  });
}

export function formatReport(context: ReviewContext, findings: Finding[], modelValid = true, omissionDetails: OmissionDetail[] = [], inlineCovered = false): string {
  const lines = [reviewMarker(context)];
  if (isConfirmedEmpty(context, findings) && omissionDetails.length === 0) return [...lines,
    'GitHub confirms zero changed files in this PR. There is no source diff to review. No model-based review was required, and no approval or automatic merge authorization was issued.', '',
    koreanDetails(['GitHub에서 이 PR의 변경 파일이 0개임을 확인했습니다. 코드 변경 사항이 없어 모델 기반 리뷰를 수행하지 않았으며 승인하거나 자동 머지를 허용하지 않았습니다.'])].join('\n');
  if (!findings.length && context.files.length && modelValid) lines.push(`No validated findings in ${context.files.length} reviewed ${context.files.length === 1 ? 'file' : 'files'}.`);
  const blockingCount = findings.filter(f => isBlockingFinding(context, f)).length;
  if (inlineCovered && findings.length) lines.push(`${blockingCount} blocking, ${findings.length - blockingCount} advisory. See the inline review threads for details.`);
  for (const f of inlineCovered ? [] : findings) {
    lines.push(`- **${isBlockingFinding(context, f) ? 'BLOCKING' : 'ADVISORY'} / ${f.severity.toUpperCase()}: ${clean(f.rule)}** (${clean(f.path)}:${f.line}): ${clean(f.evidence)} ${isBlockingFinding(context, f) ? 'Fix' : 'Consider'}: ${clean(f.recommendation)} Verify: ${clean(f.verification)}${relatedLocations(f) ? ` Also affects: ${relatedLocations(f)}. Verify every listed location.` : ''}`);
  }
  if (context.omitted.length) lines.push('', '**Manual review coverage**', ...(omissionDetails.length ? manualReviewLines(omissionDetails, 0) : ['- Some changes require manual review; inspect Files changed for unreviewed entries.']));
  if (!context.files.length) lines.push('Automated review was not performed: 0 eligible files. No conclusion can be drawn. Inspect the complete diff before approval.');
  else if (!modelValid) lines.push('The review response contained findings that could not be validated against the changed lines. Compare the reported findings with the exact diff or request a fresh review.');
  const translated = (inlineCovered ? [] : findings).filter(f => f.korean).map(f => `- **${isBlockingFinding(context, f) ? '수정 필수' : '참고 의견'} / ${f.severity.toUpperCase()}: ${koreanText(f.korean!.rule)}** (${clean(f.path)}:${f.line}): ${koreanText(f.korean!.evidence)} ${isBlockingFinding(context, f) ? '수정' : '제안'}: ${koreanText(f.korean!.recommendation)} 확인: ${koreanText(f.korean!.verification)}${relatedLocations(f) ? ` 관련 위치: ${relatedLocations(f)}. 모든 위치를 확인하세요.` : ''}`);
  if (inlineCovered && findings.length) translated.push(`수정 필수 ${blockingCount}건, 참고 의견 ${findings.length - blockingCount}건. 상세 내용은 인라인 리뷰를 확인하세요.`);
  if (!findings.length && context.files.length && modelValid) translated.push(`검토한 파일 ${context.files.length}개에서 확인된 문제는 없습니다.`);
  if (context.omitted.length) translated.push('', '**수동 검토 범위**', ...(omissionDetails.length ? manualReviewLines(omissionDetails, 1) : ['- 일부 변경 사항은 수동 검토가 필요합니다. Files changed에서 미검토 항목을 확인하세요.']));
  if (!context.files.length) translated.push('자동 검토 대상 파일이 0개여서 리뷰를 수행하지 못했습니다. 코드에 대한 결론을 내릴 수 없습니다. 승인 전 전체 diff를 확인하세요.');
  else if (!modelValid) translated.push('리뷰 응답에 변경된 줄을 기준으로 검증할 수 없는 결과가 포함되었습니다. 결과를 실제 diff와 비교하거나 재리뷰를 요청하세요.');
  if (translated.length) lines.push('', koreanDetails(translated));
  return lines.join('\n');
}

export function formatReviewBody(event: ReviewDecision, marker: string, report: string, author?: { id: number; login: string }, followUp?: ReviewFollowUp): string {
  if (event === 'APPROVE') return author?.id === 135234546 && author.login === 'qtaghdi' ? `${marker}\nApproved.` : `${marker}\nThanks for contributing! @qtaghdi, this PR is ready for your review.`;
  if (event === 'REQUEST_CHANGES') return `${marker}\nPlease address the findings before approval.\n\n${report}`;
  if (followUp?.confirmedEmpty && !followUp.incompleteCoverage && !followUp.invalidEvidence && !followUp.advisory && !followUp.maintainerFindings) return `${marker}\nNo changed files (neutral review).\n\n${report}`;
  const reasons: string[] = [];
  if (followUp?.maintainerFindings) reasons.push('Actionable findings remain. For the verified maintainer author, the reviewer reports them without a formal change request or approval. Manual disposition is required; automatic merge is not available.');
  if (followUp?.advisory) reasons.push('Advisory findings are optional recommendations, not confirmed blockers. After verifying the evidence, the maintainer may accept, defer to a separate issue, or decline with rationale. A repeated review is not required solely to dispose of optional advice on the unchanged head.');
  if (followUp?.incompleteCoverage) reasons.push('Manual coverage check required: inspect the unreviewed changes listed below.');
  if (followUp?.invalidEvidence) reasons.push('Review evidence incomplete: validate the findings against the diff or request a fresh review.');
  if (!reasons.length) reasons.push(followUp ? 'Approval pending complete passing checks.' : 'Review follow-up required; inspect the report below.');
  const manual = reviewOutcome(event, followUp).label === 'review: needs human';
  const actions: string[] = [];
  const korean: string[] = [];
  if (followUp?.maintainerFindings) {
    actions.push('Inspect the actionable findings in Files changed and the required CI in Checks. Record the disposition before making a manual merge decision.');
    korean.push('검증된 유지보수 담당자 PR입니다. 변경 요청 대신 수정 권고를 기록하며 승인하지 않습니다. 자동 머지는 제공되지 않습니다. Files changed와 Checks를 확인하고 수동으로 판단하세요.');
  }
  if (manual && (!followUp || followUp.incompleteCoverage)) {
    actions.push('Open the **Files changed** tab and the **Manual review coverage** section below. Verify each omitted change, including any unlisted confidential changes locally. Check the relevant tests and behavior before approving.');
    korean.push('Files changed 탭과 아래 수동 검토 범위를 확인하세요. 누락된 변경을 각각 검증하고, 비공개 경로는 로컬에서 확인하세요. 승인 전 관련 테스트와 동작을 확인하세요.');
  }
  if (manual && (!followUp || followUp.invalidEvidence)) {
    actions.push('Check the **Conversation** review findings against the current **Files changed** diff. Confirm evidence and expected behavior; inspect the relevant test results in **Checks**.');
    korean.push('Conversation 탭의 리뷰 의견을 현재 Files changed diff와 비교하세요. 근거와 기대 동작을 검증하고 Checks에서 관련 테스트 결과를 확인하세요.');
  }
  const advisoryGuidance = followUp?.advisory ? '\n\n<details>\n<summary>참고 의견 처리 (Korean)</summary>\n\n참고 의견은 확인된 머지 차단 결함이 아닙니다. 근거를 확인한 후 반영, 별도 이슈로 연기 또는 사유를 남겨 보류할 수 있습니다. 커밋이 변경되지 않았다면 참고 의견의 처리만을 위해 재리뷰를 반복할 필요는 없습니다. 수동 검토, 필수 CI 및 승인 조건은 그대로 적용됩니다.\n\n</details>' : '';
  const instructions = manual ? `\n\n**Where to check**\n\n${actions.map(action => `- ${action}`).join('\n')}\n\n<details>\n<summary>한국어 (Korean)</summary>\n\n**수동 검토 필요 사유 및 확인 위치**\n\n${korean.map(action => `- ${action}`).join('\n')}\n\n</details>` : '';
  return `${marker}\n${manual ? 'Maintainer review required (`review: needs human`).' : followUp?.advisory ? 'Advisory review complete (optional follow-up).' : 'Review follow-up required.'} No approval was issued.\n\n${reasons.map(reason => `- ${reason}`).join('\n')}${instructions}${advisoryGuidance}\n\n${report}`;
}
