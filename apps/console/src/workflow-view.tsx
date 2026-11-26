import type { ReactNode } from 'react';
import { JuliyaText } from '@oddmash/juliya/react';
import { Badge, Button, Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@oddmash/ui';
import { jobElapsedMs, type AgentRole, type PublicTarget, type SkipReason, type ExecutionPhase } from '@oddmash/agent-operator-contract';
import { executionTone } from './execution-status';
import { korean, translate, type Language, type Message } from './i18n';
import { type ObservedJob, type WorkflowState, targetObservations, roleObservations, publicationObservations, publicationPhaseObserved, publicationLink, executionGroups, publicationCounts, latestObservation, stateCounts, publicationStageObservations, observedStages, workflowRoleGroups } from './workflow-model';
import './workflow.css';

const words = {
  en: {
    workflow: 'Review workflow', note: 'Template and worker-reported observations for this target. Connections do not establish a single execution sequence.',
    templateEdge: 'Possible path', observedEdge: 'Recorded publication', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit graph', other: 'Other recorded states',
    panLeft: 'Pan left', panRight: 'Pan right', panUp: 'Pan up', panDown: 'Pan down',
    interaction: 'Drag to pan · Focus the graph or hold Ctrl/⌘ while scrolling to zoom · Arrow keys to pan · +/− to zoom · Home to fit',
    triage: 'Issue intake', lead: 'Review', specialists: 'Optional specialists', publishing: 'Publication', user: 'User',
    triageNote: 'Triage is issue-only. PRs can enter Lead directly.', leadNote: 'Lead coordinates PR review and retains formal review responsibility.',
    specialistNote: 'Only relevant specialists are selected; missing observations do not mean skipped.',
    publicationNote: 'A publication phase does not prove that a review was published.',
    userNote: 'User acknowledgement and approval are not captured by execution telemetry.',
    unobserved: 'Not observed', phaseOnly: 'Publishing observed', published: 'Published', reviewPublished: 'Review posted', inlinePublished: 'Inline comment posted', commentPublished: 'Conversation comment posted', target: 'Open target on GitHub',
    close: 'Close', returned: 'Processing completed', triageCompleted: 'Issue triage completed',
    queued: 'Queued', running: 'In progress', failed: 'Failed', stale: 'Stale', skipped: 'Skipped',
    noDetails: 'No retained observations for this stage in the current selection.',
    skip: 'Skip reason', publication: 'Published result', noResult: 'No publication evidence',
    review: 'Review', comment: 'Comment', inlineComment: 'Inline comment', detail: 'Execution details', run: 'Observed execution',
    stages: 'Recorded stages', observed: 'Observed', interval: 'Time until next observation or finish', failurePhase: 'Last reported phase at failure', noStages: 'No stage history retained.'
  },
  ko: {
    workflow: '리뷰 워크플로우', note: '현재 대상의 작업 흐름 템플릿과 워커 관측 기록입니다. 연결선은 하나의 순차 실행을 보장하지 않습니다.',
    templateEdge: '가능한 경로', observedEdge: '실제 게시 기록', zoomIn: '확대', zoomOut: '축소', fit: '화면에 맞춤', other: '다른 상태의 기록',
    panLeft: '왼쪽 이동', panRight: '오른쪽 이동', panUp: '위쪽 이동', panDown: '아래쪽 이동',
    interaction: '드래그로 이동 · 그래프에 초점을 맞추거나 Ctrl/⌘+스크롤로 확대·축소 · 방향키로 이동 · +/− 확대·축소 · Home 화면 맞춤',
    triage: '이슈 접수', lead: '리뷰', specialists: '선택적 전문 검토', publishing: '결과 게시', user: '사용자',
    triageNote: 'Triage는 이슈 전용입니다. PR은 Lead에서 직접 시작할 수 있습니다.', leadNote: 'Lead는 PR 검토를 조정하고 공식 리뷰를 담당합니다.',
    specialistNote: '관련 전문 에이전트만 선택됩니다. 기록이 없는 경우를 건너뜀으로 판단하지 않습니다.',
    publicationNote: '게시 단계 관측만으로 실제 리뷰 게시를 확정하지 않습니다.',
    userNote: '사용자의 확인 및 승인은 실행 기록으로 수집하지 않습니다.',
    unobserved: '관측 없음', phaseOnly: '게시 단계 관측', published: '게시 완료', reviewPublished: '리뷰 게시', inlinePublished: '인라인 댓글 게시', commentPublished: '대화 댓글 게시', target: 'GitHub 대상 보기',
    close: '닫기', returned: '리뷰 처리 완료', triageCompleted: '이슈 분류 완료',
    queued: '대기 중', running: '진행 중', failed: '검토 실패', stale: '갱신 지연', skipped: '검토 건너뜀',
    noDetails: '현재 선택에서 이 단계의 보관 기록이 없습니다.',
    skip: '건너뜀 사유', publication: '게시 결과', noResult: '게시 기록 없음',
    review: '리뷰', comment: '댓글', inlineComment: '인라인 댓글', detail: '실행 상세', run: '관측된 실행',
    stages: '기록된 실행 단계', observed: '관측됨', interval: '다음 관측 또는 종료까지의 시간', failurePhase: '실패 당시 마지막 보고 단계', noStages: '보관된 단계 기록이 없습니다.'
  }
} as const;

const targetUrl = (target: PublicTarget) => 'https://github.com/' + target.repository + '/issues/' + target.number;
const failureReason = (language: Language, reason: string) => Object.hasOwn(korean, reason) ? translate(language, reason as Message) : translate(language, 'unexpected');
const skipReasons: Record<SkipReason, { en: string; ko: string }> = {
  unavailable: { en: 'Agent unavailable', ko: '에이전트 사용 불가' },
  excluded: { en: 'Excluded by operator controls', ko: '운영 설정에서 제외' },
  'request-budget': { en: 'Request budget exhausted', ko: '요청 한도 소진' },
  'time-budget': { en: 'Time budget exhausted', ko: '시간 한도 소진' },
  'target-changed': { en: 'Target revision changed', ko: '대상 변경됨' },
  'not-reached': { en: 'Execution stopped before this stage', ko: '해당 단계에 도달하기 전에 실행 종료' }
};
const stateLabel = (language: Language, state: WorkflowState, role?: AgentRole) => state === 'returned' && role === 'triage' ? words[language].triageCompleted : words[language][state];
const phaseLabels: Record<ExecutionPhase, string> = { 'collecting-changes': 'Collecting changes', 'collecting-context': 'Collecting context', reviewing: 'Reviewing', validating: 'Validating', 'specialist-review': 'Specialist review', publishing: 'Publishing', 'verifying-findings': 'Verifying findings' };
const phaseLabel = (language: Language, phase: ExecutionPhase) => language === 'ko' ? translate(language, phase) : phaseLabels[phase];
const time = (value: string | undefined, language: Language) => value ? new Date(value).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'medium' }) : '—';

const LatestDetail = ({ job, language, observedAt, showState = false }: { job?: ObservedJob; language: Language; observedAt: string; showState?: boolean }) => {
  if (!job) return null;
  const t = (key: Message) => translate(language, key);
  const elapsed = jobElapsedMs(job, observedAt);
  const seconds = elapsed === undefined ? undefined : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 1 }).format(elapsed / 1000);
  return <span className="workflow-node-detail">
    <span title={[t('State') + ': ' + stateLabel(language, job.state, job.role), t('Phase') + ': ' + (job.phase ? phaseLabel(language, job.phase) : t('Not reported')), ...(job.phaseHistory?.map(entry => phaseLabel(language, entry.phase) + ' · ' + time(entry.timestamp, language)) ?? [])].join('\n')}>{showState ? stateLabel(language, job.state, job.role) + ' · ' : t('Phase') + ': '}{job.phase ? phaseLabel(language, job.phase) : t('Not reported')}{job.phaseHistory?.length ? ' (' + job.phaseHistory.length + ')' : ''}</span>
    <span title={t('Elapsed') + ': ' + (seconds ?? '—') + ' · ' + t('Updated') + ': ' + time(job.updatedAt, language)}>{t('Attempt')} {job.attempt} {seconds && '· ' + seconds} · <time dateTime={job.updatedAt}>{new Date(job.updatedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</time></span>
  </span>;
};

const JobObservation = ({ job, target, language, observedAt }: { job: ObservedJob; target: PublicTarget; language: Language; observedAt: string }) => {
  const w = words[language];
  const t = (key: Message) => translate(language, key);
  const duration = jobElapsedMs(job, observedAt);
  const state = job.state;
  const href = publicationLink(target, job);
  const stages = observedStages(job);
  const formatDuration = (ms: number) => new Intl.NumberFormat(language, { style: 'unit', unit: 'second', maximumFractionDigits: 1 }).format(ms / 1000);
  return <article className="workflow-observation">
    <div className="workflow-observation-heading"><Badge tone={executionTone(state)}>{stateLabel(language, state, job.role) ?? w.unobserved}</Badge><span>{t('Attempt')} {job.attempt}</span></div>
    <section className="workflow-stage-history">
      <h5>{w.stages} <span>{stages.length}</span></h5>
      {stages.length ? <ol className="workflow-timeline">{stages.map((stage, index) => <li key={stage.timestamp + ':' + index} data-stage-state={stage.state}>
        <span className="workflow-timeline-marker" aria-hidden="true"/>
        <div><strong>{phaseLabel(language, stage.phase)}</strong><Badge tone={stage.state === 'failed' ? 'danger' : stage.state === 'running' ? 'info' : 'neutral'}>{w[stage.state]}</Badge></div>
        <time dateTime={stage.timestamp}>{time(stage.timestamp, language)}</time>
        {stage.intervalMs !== undefined && <span className="workflow-stage-interval">{w.interval}: {formatDuration(stage.intervalMs)}</span>}
      </li>)}</ol> : <p>{w.noStages}</p>}
      {state === 'failed' && <p className="workflow-failure-phase">{w.failurePhase}: {job.phase ? phaseLabel(language, job.phase) : t('Not reported')}</p>}
    </section>
    <dl className="workflow-facts">
      <div><dt>{t('Phase')}</dt><dd>{job.phase ? phaseLabel(language, job.phase) : t('Not reported')}</dd></div>
      <div><dt>{t('Queued at')}</dt><dd>{time(job.queuedAt, language)}</dd></div>
      <div><dt>{t('Started at')}</dt><dd>{time(job.startedAt, language)}</dd></div>
      <div><dt>{t('Finished at')}</dt><dd>{time(job.finishedAt, language)}</dd></div>
      <div><dt>{t('Updated')}</dt><dd>{time(job.updatedAt, language)}</dd></div>
      <div><dt>{t('Elapsed')}</dt><dd>{duration === undefined ? '—' : formatDuration(duration)}</dd></div>
      {job.failure && <div><dt>{w.failed}</dt><dd>{failureReason(language, job.failure)}</dd></div>}
      {job.skipReason && <div><dt>{w.skip}</dt><dd>{skipReasons[job.skipReason]?.[language] ?? t('Not reported')}</dd></div>}
      <div><dt>{w.publication}</dt><dd>{job.publication ? <>{job.publication.kind === 'review' ? w.review : job.publication.kind === 'inline-comment' ? w.inlineComment : w.comment} · {time(job.publication.at, language)} {href && <a href={href} target="_blank" rel="noreferrer">{w.target}</a>}</> : w.noResult}</dd></div>
    </dl>
  </article>;
};

const StageDialog = ({ title, description, language, trigger, children, target, running = false, publication = false }: { title: ReactNode; description: string; language: Language; trigger: ReactNode; children: ReactNode; target: PublicTarget; running?: boolean; publication?: boolean }) => {
  const w = words[language];
  return <Dialog>
    <DialogTrigger asChild><button className={publication ? "workflow-node workflow-publication" : "workflow-node"} data-running={running} type="button">{trigger}</button></DialogTrigger>
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
  const latest = latestObservation(records);
  const counts = stateCounts(records);
  const failed = records.filter(job => job.state === 'failed');
  const latestFailure = latestObservation(failed);
  return <StageDialog title={renderAgent(role)} description={description} language={language} target={target} running={latest?.state === 'running'} trigger={<>
    <span className="workflow-node-title">{renderAgent(role)}{latest && records.length > (counts[latest.state] ?? 0) && <span className="workflow-other-count" title={w.other} aria-label={w.other + ' ' + (records.length - (counts[latest.state] ?? 0))}>+{records.length - (counts[latest.state] ?? 0)}</span>}</span>
    <span className="workflow-node-status">{latest ? <Badge tone={executionTone(latest.state)}>{stateLabel(language, latest.state, role)} {counts[latest.state]}</Badge> : <Badge tone="neutral">{w.unobserved}</Badge>}</span>
    <LatestDetail job={latest} language={language} observedAt={observedAt}/>{latestFailure && <span className="workflow-node-failure">{w.failed} {failed.length} · {latestFailure.phase ? phaseLabel(language, latestFailure.phase) : translate(language, 'Not reported')}</span>
  </>}>
    {records.length ? executionGroups(records).map(group => <section key={group.key}><h4>{w.run} · <code>{group.records[0].correlationId.slice(0, 12)}</code></h4>{group.records.map(job => <JobObservation key={job.correlationId + ':' + job.attempt} job={job} language={language} target={target} observedAt={observedAt}/>)}</section>) : <p>{w.noDetails}</p>}
  </StageDialog>;
};

export const WorkflowView = ({ target, visibleJobs, observedAt, language, renderAgent }: { target: PublicTarget; visibleJobs: readonly ObservedJob[]; observedAt: string; language: Language; renderAgent: (role: AgentRole) => ReactNode }) => {
  const w = words[language];
  const jobs = targetObservations(target, visibleJobs);
  const publications = publicationObservations(jobs);
  const counts = publicationCounts(publications);
  const publicationPhase = publicationPhaseObserved(jobs);
  const publicationJobs = publicationStageObservations(jobs);
  const { observed, unobserved } = workflowRoleGroups(jobs);
  const roleProps = { jobs, target, observedAt, language, renderAgent };
  return <div className="workflow-view">
    <div className="workflow-summary"><strong>{w.workflow}</strong><span>{language === 'ko' ? '관측된 실행' : 'Observed executions'} {jobs.length}</span></div>
    <div className="workflow-grid">
      {observed.map(role => <RoleNode key={role} role={role} description={role === 'triage' ? w.triageNote : role === 'reviewer' ? w.leadNote : w.specialistNote} {...roleProps}/>)}
      <StageDialog publication title={w.publishing} description={w.publicationNote} target={target} language={language} trigger={<>
        <span className="workflow-node-title"><span className="workflow-publication-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 12l4 4L19 6M5 20h14"/></svg></span><strong>{w.publishing}</strong></span>
        <span className="workflow-node-status">{publications.length ? <Badge tone="success">{w.published} {publications.length}</Badge> : <Badge tone={publicationPhase ? 'info' : 'neutral'}>{publicationPhase ? w.phaseOnly : w.unobserved}</Badge>}</span>
        <LatestDetail job={latestObservation(publicationJobs)} language={language} observedAt={observedAt} showState/>
      </>}>
        {publicationJobs.length ? <>{publications.length > 0 && <span className="workflow-node-status">{(['review','inline-comment','comment'] as const).map(kind => counts[kind] ? <Badge key={kind} tone="success">{kind === 'review' ? w.reviewPublished : kind === 'inline-comment' ? w.inlinePublished : w.commentPublished} {counts[kind]}</Badge> : null)}</span>}{publicationJobs.map(job => <JobObservation key={job.role + ':' + job.correlationId + ':' + job.attempt} job={job} target={target} language={language} observedAt={observedAt}/>)}</> : <p>{w.noDetails}</p>}
      </StageDialog>
    </div>
    {unobserved.length > 0 && <details className="workflow-unobserved"><summary>{w.unobserved} ({unobserved.length})</summary><div className="workflow-grid">{unobserved.map(role => <RoleNode key={role} role={role} description={role === 'triage' ? w.triageNote : role === 'reviewer' ? w.leadNote : w.specialistNote} {...roleProps}/>)}</div></details>}
    <JuliyaText as="p" locale={language} className="workflow-note">{language === 'ko' ? '실제 관측 기록입니다. 실행 완료는 승인이나 순차 실행을 의미하지 않습니다.' : 'Recorded observations only. Completion does not establish approval or a sequential run.'}</JuliyaText>
  </div>;
};
