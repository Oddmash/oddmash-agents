import type { ReactNode } from 'react';
import { Badge, Button, Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@oddmash/ui';
import { jobElapsedMs, type AgentRole, type PublicTarget } from '@oddmash/agent-operator-contract';
import { korean, translate, type Language, type Message } from './i18n';
import { type ObservedJob, type WorkflowState, specialistRoles, targetObservations, roleObservations, stateCounts, publicationObservations, publicationPhaseObserved, publicationLink, executionGroups } from './workflow-model';
import './workflow.css';

const words = {
  en: {
    workflow: 'Review workflow', note: 'Template • observations for this target, not a single guaranteed execution sequence.',
    triage: 'Issue intake', lead: 'Review', specialists: 'Optional specialists', publishing: 'Publication', user: 'User',
    triageNote: 'Triage is issue-only. PRs can enter Lead directly.', leadNote: 'Lead coordinates PR review and retains formal review responsibility.',
    specialistNote: 'Only relevant specialists are selected; missing observations do not mean skipped.',
    publicationNote: 'A publication phase does not prove that a review was published.',
    userNote: 'User acknowledgement and approval are not captured by execution telemetry.',
    unobserved: 'Not observed', phaseOnly: 'Publishing observed', published: 'Published', target: 'Open target on GitHub',
    close: 'Close', returned: 'Processing completed', triageCompleted: 'Issue triage completed',
    queued: 'Queued', running: 'In progress', failed: 'Failed', stale: 'Stale', skipped: 'Skipped',
    noDetails: 'No retained observations for this stage in the current selection.',
    skip: 'Skip reason', publication: 'Published result', noResult: 'No publication evidence',
    review: 'Review', comment: 'Comment', inlineComment: 'Inline comment', detail: 'Execution details', run: 'Observed execution'
  },
  ko: {
    workflow: '리뷰 워크플로우', note: '작업 흐름 템플릿 · 현재 선택에서 관측된 기록이며 하나의 순차 실행을 보장하지 않습니다.',
    triage: '이슈 접수', lead: '리뷰', specialists: '선택적 전문 검토', publishing: '결과 게시', user: '사용자',
    triageNote: 'Triage는 이슈 전용입니다. PR은 Lead에서 직접 시작할 수 있습니다.', leadNote: 'Lead는 PR 검토를 조정하고 공식 리뷰를 담당합니다.',
    specialistNote: '관련 전문 에이전트만 선택됩니다. 기록이 없는 경우를 건너뜀으로 판단하지 않습니다.',
    publicationNote: '게시 단계 관측만으로 실제 리뷰 게시를 확정하지 않습니다.',
    userNote: '사용자의 확인 및 승인은 실행 기록으로 수집하지 않습니다.',
    unobserved: '관측 없음', phaseOnly: '게시 단계 관측', published: '게시 완료', target: 'GitHub 대상 보기',
    close: '닫기', returned: '리뷰 처리 완료', triageCompleted: '이슈 분류 완료',
    queued: '대기 중', running: '진행 중', failed: '검토 실패', stale: '갱신 지연', skipped: '검토 건너뜀',
    noDetails: '현재 선택에서 이 단계의 보관 기록이 없습니다.',
    skip: '건너뜀 사유', publication: '게시 결과', noResult: '게시 기록 없음',
    review: '리뷰', comment: '댓글', inlineComment: '인라인 댓글', detail: '실행 상세', run: '관측된 실행'
  }
} as const;

const tones = { running: 'active', queued: 'info', returned: 'success', failed: 'danger', stale: 'warning', skipped: 'neutral', published: 'success' } as const;
const order: readonly WorkflowState[] = ['running', 'queued', 'failed', 'stale', 'skipped', 'returned', 'published'];
const targetUrl = (target: PublicTarget) => 'https://github.com/' + target.repository + '/issues/' + target.number;
const failureReason = (language: Language, reason: string) => Object.hasOwn(korean, reason) ? translate(language, reason as Message) : translate(language, 'unexpected');
const skipReasons: Record<string, { en: string; ko: string }> = {
  unavailable: { en: 'Agent unavailable', ko: '에이전트 사용 불가' },
  excluded: { en: 'Excluded by operator controls', ko: '운영 설정에서 제외' },
  'request-budget': { en: 'Request budget exhausted', ko: '요청 한도 소진' },
  'time-budget': { en: 'Time budget exhausted', ko: '시간 한도 소진' },
  'target-changed': { en: 'Target revision changed', ko: '대상 변경됨' },
  'coordination-disabled': { en: 'Coordination disabled', ko: '협업 검토 비활성' },
  'not-reached': { en: 'Execution stopped before this stage', ko: '해당 단계에 도달하기 전에 실행 종료' }
};
const stateLabel = (language: Language, state: WorkflowState, role?: AgentRole) => state === 'returned' && role === 'triage' ? words[language].triageCompleted : words[language][state];
const time = (value: string | undefined, language: Language) => value ? new Date(value).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'medium' }) : '—';

const JobObservation = ({ job, target, language, observedAt }: { job: ObservedJob; target: PublicTarget; language: Language; observedAt: string }) => {
  const w = words[language];
  const t = (key: Message) => translate(language, key);
  const duration = jobElapsedMs(job, observedAt);
  const state = job.state as WorkflowState;
  const href = publicationLink(target, job);
  return <article className="workflow-observation">
    <div className="workflow-observation-heading"><Badge tone={tones[state] ?? 'neutral'}>{stateLabel(language, state, job.role) ?? w.unobserved}</Badge><span>{t('Attempt')} {job.attempt}</span></div>
    <dl className="workflow-facts">
      <div><dt>{t('Phase')}</dt><dd>{job.phase ? t(job.phase) : t('Not reported')}</dd></div>
      <div><dt>{t('Queued at')}</dt><dd>{time(job.queuedAt, language)}</dd></div>
      <div><dt>{t('Started at')}</dt><dd>{time(job.startedAt, language)}</dd></div>
      <div><dt>{t('Finished at')}</dt><dd>{time(job.finishedAt, language)}</dd></div>
      <div><dt>{t('Updated')}</dt><dd>{time(job.updatedAt, language)}</dd></div>
      <div><dt>{t('Elapsed')}</dt><dd>{duration === undefined ? '—' : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', maximumFractionDigits: 1 }).format(duration / 1000)}</dd></div>
      {job.failure && <div><dt>{w.failed}</dt><dd>{failureReason(language, job.failure)}</dd></div>}
      {job.skipReason && <div><dt>{w.skip}</dt><dd>{skipReasons[job.skipReason]?.[language] ?? t('Not reported')}</dd></div>}
      <div><dt>{w.publication}</dt><dd>{job.publication ? <>{job.publication.kind === 'review' ? w.review : job.publication.kind === 'inline-comment' ? w.inlineComment : w.comment} · {time(job.publication.at, language)} {href && <a href={href} target="_blank" rel="noreferrer">{w.target}</a>}</> : w.noResult}</dd></div>
    </dl>
    {job.phaseHistory?.length ? <ol className="phase-history">{job.phaseHistory.map((phase, index) => <li key={phase.timestamp + ':' + index}><span>{t(phase.phase)}</span><time dateTime={phase.timestamp}>{time(phase.timestamp, language)}</time></li>)}</ol> : null}
  </article>;
};

const StageDialog = ({ title, description, language, trigger, children, target }: { title: ReactNode; description: string; language: Language; trigger: ReactNode; children: ReactNode; target: PublicTarget }) => {
  const w = words[language];
  return <Dialog>
    <DialogTrigger asChild><button className="workflow-node" type="button">{trigger}</button></DialogTrigger>
    <DialogContent className="workflow-dialog">
      <DialogTitle className="workflow-dialog-title">{title}</DialogTitle>
      <DialogDescription className="muted">{description}</DialogDescription>
      <div className="workflow-dialog-body">{children}</div>
      <footer className="workflow-dialog-footer"><a href={targetUrl(target)} target="_blank" rel="noreferrer">{w.target}</a><DialogClose asChild><Button variant="secondary">{w.close}</Button></DialogClose></footer>
    </DialogContent>
  </Dialog>;
};

const RoleNode = ({ role, description, jobs, target, observedAt, language, renderAgent }: { role: AgentRole; description: string; jobs: readonly ObservedJob[]; target: PublicTarget; observedAt: string; language: Language; renderAgent: (role: AgentRole) => ReactNode }) => {
  const w = words[language];
  const records = roleObservations(role, jobs);
  const counts = stateCounts(records);
  const badges = order.filter(state => counts[state]).map(state => <Badge key={state} tone={tones[state]}>{stateLabel(language, state, role)} {counts[state]}</Badge>);
  return <StageDialog title={renderAgent(role)} description={description} language={language} target={target} trigger={<><span className="workflow-node-title">{renderAgent(role)}</span><span className="workflow-node-status">{badges.length ? badges : <Badge tone="neutral">{w.unobserved}</Badge>}</span></>}>
    {records.length ? executionGroups(records).map(group => <section key={group.key}><h4>{w.run} · <code>{group.records[0].correlationId.slice(0, 12)}</code></h4>{group.records.map(job => <JobObservation key={job.correlationId + ':' + job.attempt} job={job} language={language} target={target} observedAt={observedAt}/>)}</section>) : <p>{w.noDetails}</p>}
  </StageDialog>;
};

export const WorkflowView = ({ target, visibleJobs, observedAt, language, renderAgent }: { target: PublicTarget; visibleJobs: readonly ObservedJob[]; observedAt: string; language: Language; renderAgent: (role: AgentRole) => ReactNode }) => {
  const w = words[language];
  const jobs = targetObservations(target, visibleJobs);
  const publications = publicationObservations(jobs);
  const publicationPhase = publicationPhaseObserved(jobs);
  const roleProps = { jobs, target, observedAt, language, renderAgent };
  return <div className="workflow-view">
    <p className="workflow-note">{w.note}</p>
    <div className="workflow-scroll" tabIndex={0} role="region" aria-label={w.workflow}>
      <div className="workflow-lane">
        <div className="workflow-stage"><span>{w.triage}</span><RoleNode role="triage" description={w.triageNote} {...roleProps}/></div>
        <div className="workflow-stage"><span>{w.lead}</span><RoleNode role="reviewer" description={w.leadNote} {...roleProps}/></div>
        <div className="workflow-stage"><span>{w.specialists}</span>{specialistRoles.map(role => <RoleNode key={role} role={role} description={w.specialistNote} {...roleProps}/>)}</div>
        <div className="workflow-stage"><span>{w.publishing}</span>
          <StageDialog title={w.publishing} description={w.publicationNote} target={target} language={language} trigger={<><strong>{w.publishing}</strong><Badge tone={publications.length ? 'success' : publicationPhase ? 'info' : 'neutral'}>{publications.length ? w.published : publicationPhase ? w.phaseOnly : w.unobserved}</Badge></>}>
            {publications.length ? publications.map(job => <JobObservation key={job.role + ':' + job.correlationId + ':' + job.attempt} job={job} target={target} language={language} observedAt={observedAt}/>) : <p>{publicationPhase ? w.publicationNote : w.noDetails}</p>}
          </StageDialog>
        </div>
        <div className="workflow-stage"><span>{w.user}</span><StageDialog title={w.user} description={w.userNote} target={target} language={language} trigger={<><strong>{w.user}</strong><Badge tone="neutral">{w.unobserved}</Badge></>}><p>{w.userNote}</p></StageDialog></div>
      </div>
    </div>
  </div>;
};
