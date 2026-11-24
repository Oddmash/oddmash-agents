import type { githubApi } from './webhook.ts';
import { crossRepositoryIssueReference } from './auto-merge.ts';

type Api = ReturnType<typeof githubApi>;
type Kind = 'merge' | 'review';
const messages: Record<string, [string, string]> = {
  'automatic merge is disabled': ['Automatic merge is disabled in the current configuration.', '현재 설정에서 자동 머지가 비활성화되어 있습니다.'],
  'private repository requires manual merge': ['This repository requires a manual merge under the current policy.', '현재 정책상 이 저장소는 수동 머지가 필요합니다.'],
  'repository is outside the auto-merge allowlist': ['This repository is outside the automatic merge policy.', '이 저장소는 자동 머지 허용 범위에 포함되지 않습니다.'],
  'PR author is not the authorized maintainer': ['The PR author is not eligible for automatic merge.', 'PR 작성자가 자동 머지 대상이 아닙니다.'],
  'pull request is not open and ready': ['The pull request is closed or a draft. Mark an eligible open PR ready for review before retrying.', 'PR이 닫혔거나 Draft 상태입니다. 열린 PR을 검토 준비 상태로 바꾸고 재시도하세요.'],
  'repository visibility or archive state is ineligible': ['Repository visibility changed or the repository is archived. Confirm the enrolled repository identity and access.', '저장소 공개 상태가 변경되었거나 보관 상태입니다. 등록된 저장소 상태와 접근 권한을 확인하세요.'],
  'base repository identity is ineligible': ['The base repository does not match the enrolled identity. Inspect the target repository before retrying.', '대상 저장소가 등록된 저장소 정보와 다릅니다. PR 대상 저장소를 확인하세요.'],
  'normal merge commits are disabled': ['Normal merge commits are disabled in repository settings. Check the authorized repository merge methods.', '저장소 설정에서 일반 머지 커밋 방식이 비활성화되어 있습니다. 허용된 머지 방식을 확인하세요.'],
  'current head or base commit evidence is incomplete': ['Current head or base commit evidence is incomplete. Wait for GitHub to finish updating the PR.', '현재 PR의 head 또는 base 커밋 정보가 불완전합니다. GitHub 갱신을 기다리세요.'],
  'pull request has manual hold label': ['A manual hold label prevents automatic merge. Check the PR labels and resolve the outstanding concern with a maintainer.', '수동 보류 라벨 때문에 자동 머지가 제한됩니다. PR 라벨과 보류 사유를 유지보수 담당자와 확인하세요.'],
  'fork or source repository mismatch': ['Fork or cross-repository PRs require manual review.', '포크 또는 다른 저장소의 PR은 수동 확인이 필요합니다.'],
  'infrastructure PR must target main': ['Infrastructure repositories use main-only delivery; retarget the PR to main if appropriate.', '인프라 저장소는 main 기준으로 작업합니다. 필요한 경우 PR 대상을 main으로 변경하세요.'],
  'target is not the default main branch': ['The target is not the permitted default branch.', '대상 브랜치가 허용된 기본 브랜치가 아닙니다.'],
  'changed-file count exceeds the auto-merge budget': ['The PR must include 1 to 20 changed files. Split the PR if practical or review manually.', '자동 머지는 변경 파일 1~20개만 허용합니다. 가능하면 PR을 분리하거나 수동 검토하세요.'],
  'repository automatic merge opt-in is not enabled': ['Automatic merge is not enabled for this infrastructure repository. An organization administrator may set the repository custom property oddmash-auto-merge to documentation; all other merge checks still apply.', '이 인프라 저장소의 자동 머지 옵트인이 활성화되지 않았습니다. 조직 관리자가 저장소의 Custom property oddmash-auto-merge를 documentation으로 설정할 수 있으며, 기존 머지 조건은 그대로 적용됩니다.'],
  'repository automatic merge opt-in is unavailable': ['The repository automatic merge setting could not be verified. Check the organization-managed custom property and retry; no automatic merge is authorized.', '저장소 자동 머지 설정을 확인하지 못했습니다. 조직에서 관리하는 Custom property를 확인한 후 재시도하세요. 자동 머지는 승인되지 않았습니다.'],
  'infrastructure documentation opt-in excludes runtime changes': ['The repository opt-in covers ordinary documentation only. Runtime, skill execution and governance changes still require manual review and merge.', '이 저장소의 옵트인은 일반 문서만 허용합니다. 런타임, 스킬 실행 및 거버넌스 변경은 수동 검토 후 머지해야 합니다.'],
  'repository requires root README-only changes': ['Repository-specific rule: Oddmash agent and skill repositories permit only root README documentation for automatic merge. Verify the other changes and merge manually; the restriction is independent of CI and review status.', '저장소별 정책: 에이전트와 스킬 저장소의 자동 머지 대상은 루트 README 문서뿐입니다. 나머지 변경을 검토한 뒤 수동 머지하세요. CI나 리뷰 통과 여부와 별개의 제한입니다.'],
  'changed-file list is incomplete': ['GitHub returned an incomplete changed-file list. Inspect Files changed and retry when complete evidence is available.', '변경 파일 목록이 완전하지 않습니다. Files changed 탭을 확인하고 전체 근거를 확인할 수 있을 때 재시도하세요.'],
  'changed diff exceeds the auto-merge budget': ['The combined diff exceeds the 45,000-character automatic merge budget. Split the change if practical or review and merge manually.', '전체 변경 diff가 자동 머지 한도인 45,000자를 초과했습니다. 가능하면 PR을 분리하거나 수동 검토 후 머지하세요.'],
  'changed diff evidence is incomplete': ['One or more complete file diffs could not be verified. Inspect the full diff before manual approval.', '일부 파일의 전체 diff를 확인할 수 없습니다. 수동 승인 전 전체 변경을 검토하세요.'],
  'changed file operation requires manual merge': ['The change includes a file operation other than an addition or modification, such as removal or rename. Review it manually.', '추가·수정 이외의 파일 작업(삭제 또는 이름 변경 등)이 포함되어 수동 검토가 필요합니다.'],
  'changed content requires confidential manual review': ['Changed content requires confidential local verification. Inspect the diff locally without posting sensitive values.', '변경 내용의 비공개 검증이 필요합니다. 민감한 값을 공유하지 말고 로컬에서 확인하세요.'],
  'protected changed path requires manual merge': ['A changed path is in a protected policy, configuration, operational or security-related category. Inspect Files changed and review the relevant behavior manually.', '정책·설정·운영·보안 관련 보호 경로가 변경되었습니다. Files changed에서 관련 동작을 수동 검토하세요.'],
  'changed file type is outside automatic merge scope': ['A changed file type is not eligible for automatic merge. Review its content and merge manually.', '자동 머지 대상이 아닌 파일 형식이 포함되었습니다. 내용을 검토한 뒤 수동 머지하세요.'],
  'changed test path is outside automatic merge scope': ['A test file is outside the repository-specific eligible test locations. Review it manually.', '저장소별 자동 머지 허용 테스트 경로 외의 파일이 포함되었습니다. 수동 검토하세요.'],
  'test changes are not additive and enabled': ['A test change removes existing lines or introduces a skipped, focused or pending test. Verify test coverage manually.', '테스트가 기존 줄을 제거하거나 건너뛰기·선택 실행·미완료 테스트를 추가합니다. 테스트 범위를 수동 검증하세요.'],
  'changed source path is outside automatic merge scope': ['A source file is outside this repository’s approved automatic merge locations. Inspect Files changed and review manually.', '저장소별 자동 머지 허용 소스 경로 외의 파일이 포함되었습니다. Files changed를 확인하고 수동 검토하세요.'],
  'private strict review coverage is incomplete': ['Private-repository automatic merge requires complete strict review coverage. Verify omitted changes locally and merge manually.', '비공개 저장소 자동 머지는 엄격한 검토 범위가 완전해야 합니다. 누락된 변경을 로컬에서 검증하고 수동 머지하세요.'],
  'target is neither develop nor the default main branch': ['Only develop or the default main branch is eligible. Check the PR base branch.', 'develop 또는 기본 main 브랜치만 허용됩니다. PR 대상 브랜치를 확인하세요.'],
  'merge commit evidence is not ready': ['GitHub has not provided a valid merge commit yet. Wait for mergeability calculation before retrying.', 'GitHub 머지 커밋 정보가 준비되지 않았습니다. 머지 가능성 계산이 완료되면 재시도하세요.'],
  'changed paths or review budget are ineligible': ['Some changed paths or the review size require manual merge.', '변경 파일 범위 또는 검토 규모 때문에 수동 머지가 필요합니다.'],
  'missing single closing issue link': ['Link exactly one eligible same-repository issue using a standalone Refs #N or Closes #N line.', '독립된 Refs #N 또는 Closes #N 줄로 동일 저장소의 적격 이슈 하나를 연결하세요.'],
  'multi-issue release requires manual merge': ['This release correctly links multiple issues. Complete CI and review, then merge manually.', '이 릴리스는 여러 이슈를 정상적으로 연결했습니다. CI와 리뷰 완료 후 수동 머지하세요.'],
  'cross-repository issue reference requires manual merge': ['Automatic merge verifies acceptance criteria through one issue in this PR’s repository. This PR links an issue in a different repository. Keep the reference and merge manually after CI and review pass.', '자동 머지는 이 PR과 같은 저장소의 이슈 하나를 기준으로 완료 조건을 검증합니다. 이 PR은 다른 저장소의 이슈를 연결했습니다. 이슈 연결을 유지하고 CI와 리뷰 통과 후 수동으로 머지하세요.'],
  'integration branch requires Refs': ['Use Refs for integration branches; close completed issues on the default branch only.', '통합 브랜치는 Refs를 사용하고 완료된 이슈는 기본 브랜치에서만 닫으세요.'],
  'missing single issue reference': ['Link exactly one eligible same-repository issue using a standalone Refs #N or Closes #N line.', '독립된 Refs #N 또는 Closes #N 줄로 동일 저장소의 적격 이슈 하나를 연결하세요.'],
  'issue acceptance criteria are ineligible': ['The linked issue and partial PR scope need eligible acceptance criteria.', '연결된 이슈와 부분 작업 범위에 유효한 완료 기준이 필요합니다.'],
  'issue acceptance evidence not verified': ['The linked issue or partial PR scope evidence could not be verified.', '연결된 이슈 또는 부분 작업 범위의 완료 근거가 확인되지 않았습니다.'],
  'issue evidence not verified': ['The linked issue completion evidence could not be verified.', '연결된 이슈의 완료 근거가 확인되지 않았습니다.'],
  'approval has no current acceptance proof; request a fresh review': ['Request a fresh review to verify the current issue and commit.', '현재 이슈와 커밋의 근거를 검증하려면 재리뷰를 요청하세요.'],
  'required branch protection unavailable': ['Required branch protection and its trusted verify check could not be verified. Check the base branch protection settings or merge manually after verification.', '필수 브랜치 보호 규칙과 신뢰할 수 있는 verify 검사를 확인하지 못했습니다. 브랜치 설정을 확인하거나 검증 후 수동 머지하세요.'],
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
  const matching = async (): Promise<Comment[] | undefined> => {
    const found: Comment[] = [];
    for (let page = 1; page <= 10; page++) {
      const comments = await api<Comment[]>(`${path}?per_page=100&page=${page}`);
      found.push(...comments.filter(item => item.user.login === bot && item.body.startsWith(marker)));
      if (comments.length < 100) return found.sort((left, right) => left.id - right.id);
    }
  };
  try {
    const known = await matching();
    if (!known) return;
    const existing = known[0];
    if (completed && !existing) return;
    const current = await api<{ state: string; head: { sha: string }; merged?: boolean; body?: string | null }>(`/repos/${repository}/pulls/${number}`);
    if (current.head.sha !== head || (!completed && current.state !== 'open')) return;
    const [en, ko] = statusText(kind, reason);
    const reference = kind === 'merge' && reason === 'cross-repository issue reference requires manual merge'
      ? crossRepositoryIssueReference(current.body ?? null) : undefined;
    const referenceEn = reference ? `\n\nLinked issue: \`${reference}\`` : '';
    const referenceKo = reference ? `\n\n연결 이슈 \`${reference}\`` : '';
    const links = reason === 'Actions billing or quota block' ? `\n\n[Workflow run${workflowRunUrl ? '' : 's'}](${workflowRunUrl ?? `https://github.com/${repository}/actions`}) · ${billingHelpLink(repository)}` : '';
    const title = completed ? 'Completed' : kind === 'merge' ? 'Auto-merge withheld' : 'Review processing failed';
    const body = `${marker}\n**${title}**\n\n${en}${referenceEn}${links}\n\nCommit: \`${head.slice(0, 12)}\`\n\n<details>\n<summary>한국어 (Korean)</summary>\n\n${ko}${referenceKo}\n\n</details>`;
    if (existing?.body === body) return;
    if (existing) await api(`/repos/${repository}/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    else {
      const fresh = await matching();
      if (!fresh) return;
      if (fresh.length) {
        if (fresh[0].body !== body) await api(`/repos/${repository}/issues/comments/${fresh[0].id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
        return;
      }
      const created = await api<Comment>(path, { method: 'POST', body: JSON.stringify({ body }) });
      if (created.user.login !== bot || created.body !== body || !Number.isSafeInteger(created.id)) return;
      const after = await matching();
      if (!after?.some(item => item.id < created.id && item.body === body)) return;
      const own = await api<Comment>(`/repos/${repository}/issues/comments/${created.id}`);
      if (own.id === created.id && own.user.login === bot && own.body === body) await api(`/repos/${repository}/issues/comments/${created.id}`, { method: 'DELETE' });
    }
  } catch { console.warn('Automation status comment unavailable'); }
}
