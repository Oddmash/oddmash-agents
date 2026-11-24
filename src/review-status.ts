import type { githubApi } from './webhook.ts';

type Api = ReturnType<typeof githubApi>;
type Kind = 'merge' | 'review';
const messages: Record<string, [string, string]> = {
  'automatic merge is disabled': ['Automatic merge is disabled in the current configuration.', '현재 설정에서 자동 머지가 비활성화되어 있습니다.'],
  'private repository requires manual merge': ['This repository requires a manual merge under the current policy.', '현재 정책상 이 저장소는 수동 머지가 필요합니다.'],
  'repository is outside the auto-merge allowlist': ['This repository is outside the automatic merge policy.', '이 저장소는 자동 머지 허용 범위에 포함되지 않습니다.'],
  'PR author is not the authorized maintainer': ['The PR author is not eligible for automatic merge.', 'PR 작성자가 자동 머지 대상이 아닙니다.'],
  'fork or source repository mismatch': ['Fork or cross-repository PRs require manual review.', '포크 또는 다른 저장소의 PR은 수동 확인이 필요합니다.'],
  'target is not the default main branch': ['The target is not the permitted default branch.', '대상 브랜치가 허용된 기본 브랜치가 아닙니다.'],
  'changed-file count exceeds the auto-merge budget': ['The changed-file count exceeds the automatic merge limit.', '변경 파일 수가 자동 머지 한도를 초과했습니다.'],
  'changed paths or review budget are ineligible': ['Some changed paths or the review size require manual merge.', '변경 파일 범위 또는 검토 규모 때문에 수동 머지가 필요합니다.'],
  'missing single closing issue link': ['Link exactly one eligible issue using a standalone Closes #N line.', '독립된 Closes #N 줄로 적격 이슈 하나를 연결하세요.'],
  'issue acceptance criteria are ineligible': ['The linked issue needs eligible explicit acceptance criteria.', '연결된 이슈에 유효한 완료 기준이 필요합니다.'],
  'issue acceptance evidence not verified': ['The linked issue completion evidence could not be verified.', '연결된 이슈의 완료 근거가 확인되지 않았습니다.'],
  'issue evidence not verified': ['The linked issue completion evidence could not be verified.', '연결된 이슈의 완료 근거가 확인되지 않았습니다.'],
  'approval has no current acceptance proof; request a fresh review': ['Request a fresh review to verify the current issue and commit.', '현재 이슈와 커밋의 근거를 검증하려면 재리뷰를 요청하세요.'],
  'required branch protection unavailable': ['Required branch protection could not be verified.', '필수 브랜치 보호 규칙을 확인하지 못했습니다.'],
  'branch is not up to date': ['Update the branch against the current base and request a new review.', '현재 기준 브랜치에 맞게 업데이트하고 재리뷰를 요청하세요.'],
  'candidate is not clean': ['GitHub reports that the PR is not ready to merge.', 'GitHub에서 아직 머지 가능한 상태가 아니라고 보고했습니다.'],
  'current required check evidence is incomplete': ['Required CI checks are incomplete or unsuccessful.', '필수 CI 검사가 완료되지 않았거나 실패했습니다.'],
  'Actions billing or quota block': ['GitHub Actions reports a billing or usage block. Check the workflow run and organization billing settings if authorized, or wait for the next billing cycle. Rerun the existing failed workflow after recovery. Required CI remains enforced.', 'GitHub Actions 결제 또는 사용량 제한이 확인되었습니다. 권한이 있는 경우 워크플로 실행 및 조직 결제 설정을 확인하거나 다음 결제 주기를 기다린 후 기존 실패 워크플로를 재실행하세요. 필수 CI 검사는 유지됩니다.'],
  'required checks failed': ['Required CI checks did not pass. Resolve the failed checks before requesting another review.', '필수 CI 검사가 통과하지 못했습니다. 실패한 검사를 해결한 후 재리뷰를 요청하세요.'],
  'commit statuses are incomplete': ['Commit status checks are incomplete.', '커밋 상태 검사가 완료되지 않았습니다.'],
  'exact-head approval or independent review evidence is incomplete': ['Current approval or required review evidence is incomplete.', '현재 커밋의 승인 또는 필수 리뷰 근거가 부족합니다.'],
  'Mergeability evidence pending': ['GitHub is still calculating mergeability. Retry when ready.', 'GitHub에서 머지 가능 여부를 계산 중입니다. 완료 후 재시도합니다.'],
  'Model quota, rate or credit limit reached; stop and check API billing before retrying': ['Model usage limit reached. Check billing before requesting another review.', '모델 사용량 한도에 도달했습니다. 결제를 확인한 후 재리뷰를 요청하세요.'],
  'Model input budget exceeded': ['The model request exceeds its configured input budget. Split the PR or use a smaller scope before requesting another review.', '모델 입력 한도를 초과했습니다. PR을 나누거나 검토 범위를 줄인 후 재리뷰를 요청하세요.'],
  'review completed': ['Review completed.', '리뷰가 완료되었습니다.'],
  'merge completed': ['Automatic merge completed.', '자동 머지가 완료되었습니다.']
};

export function statusText(kind: Kind, reason: string): [string, string] {
  if (Object.hasOwn(messages, reason)) return messages[reason];
  if (/^GitHub request failed \((?:401|403|404)\)$/.test(reason)) return ['GitHub rejected a required request. Check repository access, permissions or availability.', 'GitHub 요청이 거부되었습니다. 저장소 접근 권한 및 설정을 확인하세요.'];
  if (reason === 'candidate changed' || reason === 'final PR state changed' || reason === 'issue changed during review') return ['The PR or linked issue changed during processing. Request a new review.', '처리 중 PR 또는 연결된 이슈가 변경되었습니다. 재리뷰를 요청하세요.'];
  return kind === 'merge' ? ['Automatic merge could not complete. Check the current PR requirements and retry or merge manually.', '자동 머지를 완료하지 못했습니다. 현재 PR 조건을 확인하고 재시도하거나 수동 머지하세요.'] : ['Review processing failed. Request a new review or check the service logs.', '리뷰 처리에 실패했습니다. 재리뷰를 요청하거나 서비스 로그를 확인하세요.'];
}

export function billingHelpLink(repository: string): string {
  return /^Oddmash\/[A-Za-z0-9_.-]+$/i.test(repository)
    ? '[Organization billing (authorized maintainers)](https://github.com/organizations/Oddmash/settings/billing)'
    : '[GitHub Actions billing guidance](https://docs.github.com/en/billing/concepts/product-billing/github-actions)';
}

export async function publishAutomationStatus(api: Api, repository: string, number: number, bot: string, head: string, kind: Kind, reason: string, completed = false, workflowRunUrl?: string) {
  if (!/^[a-f0-9]{40}$/i.test(head)) return;
  const marker = `<!-- oddmash-automation-status:${kind} -->`;
  const path = `/repos/${repository}/issues/${number}/comments`;
  type Comment = { id: number; body: string; user: { login: string } };
  try {
    let existing: Comment | undefined;
    for (let page = 1; page <= 10; page++) {
      const comments = await api<Comment[]>(`${path}?per_page=100&page=${page}`);
      existing = comments.find(item => item.user.login === bot && item.body.startsWith(marker));
      if (existing || comments.length < 100) break;
      if (page === 10) return;
    }
    if (completed && !existing) return;
    const current = await api<{ state: string; head: { sha: string }; merged?: boolean }>(`/repos/${repository}/pulls/${number}`);
    if (current.head.sha !== head || (!completed && current.state !== 'open')) return;
    const [en, ko] = statusText(kind, reason);
    const links = reason === 'Actions billing or quota block' ? `\n\n[Workflow run${workflowRunUrl ? '' : 's'}](${workflowRunUrl ?? `https://github.com/${repository}/actions`}) · ${billingHelpLink(repository)}` : '';
    const title = completed ? 'Completed' : kind === 'merge' ? 'Auto-merge withheld' : 'Review processing failed';
    const body = `${marker}\n**${title}**\n\n${en}${links}\n\nCommit: \`${head.slice(0, 12)}\`\n\n<details>\n<summary>한국어 (Korean)</summary>\n\n${ko}\n\n</details>`;
    if (existing?.body === body) return;
    if (existing) await api(`/repos/${repository}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    else await api(path, { method: 'POST', body: JSON.stringify({ body }) });
  } catch { console.warn('Automation status comment unavailable'); }
}
