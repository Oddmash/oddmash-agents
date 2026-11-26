import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { JuliyaText } from '@oddmash/juliya/react';
import { Badge, Button, Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@oddmash/ui';
import { jobElapsedMs, type AgentRole, type PublicTarget, type SkipReason } from '@oddmash/agent-operator-contract';
import { executionTone } from './execution-status';
import { korean, translate, type Language, type Message } from './i18n';
import { type ObservedJob, type WorkflowState, type CanvasStage, type CanvasViewport, type CanvasPoint, type CanvasSize, specialistRoles, targetObservations, roleObservations, publicationObservations, publicationPhaseObserved, publicationLink, executionGroups, publicationCounts, latestObservation, canvasSize, canvasNodeSize, canvasNodes, canvasMinScale, canvasMaxScale, canvasDetailScale, fitViewport, panViewport, zoomViewport, workflowEdges } from './workflow-model';
import { stateCounts, wheelZoomEnabled, pointerDragInterrupted, publicationStageObservations, observedStages } from './workflow-model';
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
const time = (value: string | undefined, language: Language) => value ? new Date(value).toLocaleString(language, { dateStyle: 'medium', timeStyle: 'medium' }) : '—';

const LatestDetail = ({ job, language, observedAt, showState = false }: { job?: ObservedJob; language: Language; observedAt: string; showState?: boolean }) => {
  if (!job) return null;
  const t = (key: Message) => translate(language, key);
  const elapsed = jobElapsedMs(job, observedAt);
  const seconds = elapsed === undefined ? undefined : new Intl.NumberFormat(language, { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 1 }).format(elapsed / 1000);
  return <span className="workflow-node-detail">
    <span title={[t('State') + ': ' + stateLabel(language, job.state, job.role), t('Phase') + ': ' + (job.phase ? t(job.phase) : t('Not reported')), ...(job.phaseHistory?.map(entry => t(entry.phase) + ' · ' + time(entry.timestamp, language)) ?? [])].join('\n')}>{showState ? stateLabel(language, job.state, job.role) + ' · ' : t('Phase') + ': '}{job.phase ? t(job.phase) : t('Not reported')}{job.phaseHistory?.length ? ' (' + job.phaseHistory.length + ')' : ''}</span>
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
        <div><strong>{t(stage.phase)}</strong><Badge tone={stage.state === 'failed' ? 'danger' : stage.state === 'running' ? 'info' : 'neutral'}>{w[stage.state]}</Badge></div>
        <time dateTime={stage.timestamp}>{time(stage.timestamp, language)}</time>
        {stage.intervalMs !== undefined && <span className="workflow-stage-interval">{w.interval}: {formatDuration(stage.intervalMs)}</span>}
      </li>)}</ol> : <p>{w.noStages}</p>}
      {state === 'failed' && <p className="workflow-failure-phase">{w.failurePhase}: {job.phase ? t(job.phase) : t('Not reported')}</p>}
    </section>
    <dl className="workflow-facts">
      <div><dt>{t('Phase')}</dt><dd>{job.phase ? t(job.phase) : t('Not reported')}</dd></div>
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

const StageDialog = ({ title, description, language, trigger, children, target, running = false }: { title: ReactNode; description: string; language: Language; trigger: ReactNode; children: ReactNode; target: PublicTarget; running?: boolean }) => {
  const w = words[language];
  return <Dialog>
    <DialogTrigger asChild><button className="workflow-node" data-running={running} type="button">{trigger}</button></DialogTrigger>
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
  return <StageDialog title={renderAgent(role)} description={description} language={language} target={target} running={latest?.state === 'running'} trigger={<>
    <span className="workflow-node-title">{renderAgent(role)}{latest && records.length > (counts[latest.state] ?? 0) && <span className="workflow-other-count" title={w.other} aria-label={w.other + ' ' + (records.length - (counts[latest.state] ?? 0))}>+{records.length - (counts[latest.state] ?? 0)}</span>}</span>
    <span className="workflow-node-status">{latest ? <Badge tone={executionTone(latest.state)}>{stateLabel(language, latest.state, role)} {counts[latest.state]}</Badge> : <Badge tone="neutral">{w.unobserved}</Badge>}</span>
    <LatestDetail job={latest} language={language} observedAt={observedAt}/>
  </>}>
    {records.length ? executionGroups(records).map(group => <section key={group.key}><h4>{w.run} · <code>{group.records[0].correlationId.slice(0, 12)}</code></h4>{group.records.map(job => <JobObservation key={job.correlationId + ':' + job.attempt} job={job} language={language} target={target} observedAt={observedAt}/>)}</section>) : <p>{w.noDetails}</p>}
  </StageDialog>;
};

const isCanvasEvent = (viewport: HTMLElement, target: EventTarget) => target instanceof Node && viewport.contains(target);

const WorkflowCanvas = ({ jobs, language, children }: { jobs: readonly ObservedJob[]; language: Language; children: ReactNode }) => {
  const w = words[language];
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [view, setView] = useState<CanvasViewport>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const manual = useRef(false);
  const pointer = useRef<{ id: number; start: CanvasPoint; original: CanvasViewport; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      if (!next.width || !next.height) return;
      setSize(next);
      setView(current => manual.current ? panViewport(current, { x: 0, y: 0 }, next) : fitViewport(next, true));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const changeZoom = (factor: number) => {
    manual.current = true;
    setView(current => zoomViewport(current, current.scale * factor, { x: size.width / 2, y: size.height / 2 }, size));
  };
  const pan = (delta: CanvasPoint) => {
    manual.current = true;
    setView(current => panViewport(current, delta, size));
  };
  const fit = () => {
    manual.current = true;
    setView(fitViewport(size));
  };

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!wheelZoomEnabled(element.contains(document.activeElement), event.ctrlKey, event.metaKey)) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      manual.current = true;
      setView(current => zoomViewport(current, current.scale * Math.exp(-Math.max(-200, Math.min(200, delta)) * .003), { x: event.clientX - rect.left, y: event.clientY - rect.top }, { width: element.clientWidth, height: element.clientHeight }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  const endPointer = (pointerId: number) => {
    if (pointer.current?.id !== pointerId) return;
    suppressClick.current = pointer.current.moved;
    pointer.current = null;
    setDragging(false);
  };
  const expanded = view.scale >= canvasDetailScale;
  const zoomPercent = Math.round(view.scale * 100);
  const controls = [
    { name: w.panLeft, label: '←', action: () => pan({ x: 64, y: 0 }) },
    { name: w.panUp, label: '↑', action: () => pan({ x: 0, y: 64 }) },
    { name: w.panDown, label: '↓', action: () => pan({ x: 0, y: -64 }) },
    { name: w.panRight, label: '→', action: () => pan({ x: -64, y: 0 }) }
  ];
  return <div className="workflow-canvas">
    <div className="workflow-toolbar">
      <div className="workflow-legend"><span><i className="workflow-line-key"/>{w.templateEdge}</span><span><i className="workflow-line-key observed"/>{w.observedEdge}</span></div>
      <div className="workflow-controls" role="group" aria-label={w.workflow}>
        <Button type="button" size="sm" variant="secondary" aria-label={w.zoomOut} title={w.zoomOut} disabled={view.scale <= canvasMinScale} onClick={() => changeZoom(1 / 1.2)}>−</Button>
        <output className="workflow-zoom-value" aria-live="polite">{zoomPercent}%</output>
        <Button type="button" size="sm" variant="secondary" aria-label={w.zoomIn} title={w.zoomIn} disabled={view.scale >= canvasMaxScale} onClick={() => changeZoom(1.2)}>+</Button>
        <Button type="button" size="sm" variant="secondary" onClick={fit}>{w.fit}</Button>
        <div className="workflow-pan-controls">{controls.map(control => <Button key={control.name} type="button" size="sm" variant="ghost" aria-label={control.name} title={control.name} onClick={control.action}>{control.label}</Button>)}</div>
      </div>
      <JuliyaText as="p" locale={language} id={id} className="workflow-interaction">{w.interaction}</JuliyaText>
    </div>
    <div ref={viewport} className="workflow-viewport" data-dragging={dragging} tabIndex={0} role="region" aria-label={w.workflow} aria-describedby={id}
      onPointerDown={event => {
        if (!isCanvasEvent(event.currentTarget, event.target) || !event.isPrimary || event.button !== 0) return;
        suppressClick.current = false;
        pointer.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, original: view, moved: false };
        if (!(event.target instanceof Element) || !event.target.closest('button')) event.currentTarget.focus({ preventScroll: true });
      }}
      onPointerMove={event => {
        if (!isCanvasEvent(event.currentTarget, event.target)) return;
        const active = pointer.current;
        if (!active || active.id !== event.pointerId) return;
        if (pointerDragInterrupted(event.pointerType, event.buttons)) { endPointer(event.pointerId); return; }
        const delta = { x: event.clientX - active.start.x, y: event.clientY - active.start.y };
        if (!active.moved && Math.hypot(delta.x, delta.y) < 5) return;
        if (!active.moved) {
          active.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          manual.current = true;
        }
        setView(panViewport(active.original, delta, size));
      }}
      onPointerLeave={event => { if (isCanvasEvent(event.currentTarget, event.target) && !pointer.current?.moved) endPointer(event.pointerId); }}
      onPointerUp={event => { if (isCanvasEvent(event.currentTarget, event.target)) endPointer(event.pointerId); }}
      onPointerCancel={event => { if (isCanvasEvent(event.currentTarget, event.target)) endPointer(event.pointerId); }}
      onLostPointerCapture={event => { if (isCanvasEvent(event.currentTarget, event.target)) endPointer(event.pointerId); }}
      onClickCapture={event => { if (isCanvasEvent(event.currentTarget, event.target) && suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const deltas: Record<string, CanvasPoint> = { ArrowLeft: { x: 64, y: 0 }, ArrowRight: { x: -64, y: 0 }, ArrowUp: { x: 0, y: 64 }, ArrowDown: { x: 0, y: -64 } };
        if (deltas[event.key]) pan(deltas[event.key]);
        else if (event.key === '+' || event.key === '=') changeZoom(1.2);
        else if (event.key === '-') changeZoom(1 / 1.2);
        else if (event.key === 'Home') fit();
        else return;
        event.preventDefault();
      }}
      onFocusCapture={event => {
        if (!isCanvasEvent(event.currentTarget, event.target) || !(event.target instanceof HTMLElement) || event.target === event.currentTarget || !event.target.matches('.workflow-node:focus-visible')) return;
        const outer = event.currentTarget.getBoundingClientRect(), inner = event.target.getBoundingClientRect();
        const margin = 12;
        const x = inner.left < outer.left + margin ? outer.left + margin - inner.left : inner.right > outer.right - margin ? outer.right - margin - inner.right : 0;
        const y = inner.top < outer.top + margin ? outer.top + margin - inner.top : inner.bottom > outer.bottom - margin ? outer.bottom - margin - inner.bottom : 0;
        if (x || y) pan({ x, y });
      }}>
      <div className="workflow-lane" data-expanded={expanded} style={{ width: canvasSize.width, height: canvasSize.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className="workflow-edges" aria-hidden="true" width={canvasSize.width} height={canvasSize.height} viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}>
          {workflowEdges(jobs).map(edge => <path key={edge.from + ':' + edge.to} d={edge.path} className={edge.observed ? 'workflow-edge observed' : 'workflow-edge'}/>)}
        </svg>
        {children}
      </div>
    </div>
  </div>;
};

const CanvasNode = ({ stage, heading, children }: { stage: CanvasStage; heading?: string; children: ReactNode }) =>
  <div className="workflow-stage" style={{ left: canvasNodes[stage].x, top: canvasNodes[stage].y, width: canvasNodeSize.width, height: canvasNodeSize.height }}>
    {heading && <span className="workflow-stage-heading">{heading}</span>}
    {children}
  </div>;

export const WorkflowView = ({ target, visibleJobs, observedAt, language, renderAgent }: { target: PublicTarget; visibleJobs: readonly ObservedJob[]; observedAt: string; language: Language; renderAgent: (role: AgentRole) => ReactNode }) => {
  const w = words[language];
  const jobs = targetObservations(target, visibleJobs);
  const publications = publicationObservations(jobs);
  const counts = publicationCounts(publications);
  const publicationPhase = publicationPhaseObserved(jobs);
  const publicationJobs = publicationStageObservations(jobs);
  const latestPublication = latestObservation(publicationJobs);
  const roleProps = { jobs, target, observedAt, language, renderAgent };
  return <div className="workflow-view">
    <JuliyaText as="p" locale={language} className="workflow-note">{w.note}</JuliyaText>
    <WorkflowCanvas key={target.repository + '/' + target.number} jobs={jobs} language={language}>
        <CanvasNode stage="triage" heading={w.triage}><RoleNode role="triage" description={w.triageNote} {...roleProps}/></CanvasNode>
        <CanvasNode stage="reviewer" heading={w.lead}><RoleNode role="reviewer" description={w.leadNote} {...roleProps}/></CanvasNode>
        {specialistRoles.map((role, index) => <CanvasNode key={role} stage={role} heading={index === 0 ? w.specialists : undefined}><RoleNode role={role} description={w.specialistNote} {...roleProps}/></CanvasNode>)}
        <CanvasNode stage="publication" heading={w.publishing}>
          <StageDialog title={w.publishing} description={w.publicationNote} target={target} language={language} trigger={<><strong>{w.publishing}</strong><span className="workflow-node-status">{publications.length ? <Badge tone="success">{w.published} {publications.length}</Badge> : <Badge tone={publicationPhase ? 'info' : 'neutral'}>{publicationPhase ? w.phaseOnly : w.unobserved}</Badge>}</span><LatestDetail job={latestPublication} language={language} observedAt={observedAt} showState/></>}>
            {publicationJobs.length ? <>{publications.length > 0 && <span className="workflow-node-status">{(['review','inline-comment','comment'] as const).map(kind => counts[kind] ? <Badge key={kind} tone="success">{kind === 'review' ? w.reviewPublished : kind === 'inline-comment' ? w.inlinePublished : w.commentPublished} {counts[kind]}</Badge> : null)}</span>}{publicationJobs.map(job => <JobObservation key={job.role + ':' + job.correlationId + ':' + job.attempt} job={job} target={target} language={language} observedAt={observedAt}/>)}</> : <p>{w.noDetails}</p>}
          </StageDialog>
        </CanvasNode>
        <CanvasNode stage="user" heading={w.user}><StageDialog title={w.user} description={w.userNote} target={target} language={language} trigger={<><strong>{w.user}</strong><Badge tone="neutral">{w.unobserved}</Badge></>}><p>{w.userNote}</p></StageDialog></CanvasNode>
    </WorkflowCanvas>
  </div>;
};
