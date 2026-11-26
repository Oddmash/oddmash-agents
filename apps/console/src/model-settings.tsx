import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, Select } from '@oddmash/ui';
import { approvedModelOverrides, modelRoles, type AgentRole, type AgentSettings, type ModelOverrides, type OperatorModelsResponse } from '@oddmash/agent-operator-contract';
import { modelSelectionAvailable, reconcileModelDraft } from './model-settings-draft';
import { translate, type Language, type Message } from './i18n';
import './agent-settings.css';

const roles: Record<AgentRole, string> = { reviewer: 'Lead', impact: 'Impact', triage: 'Triage', qa: 'QA', release: 'Release', docs: 'Docs', architect: 'Architect' };
const messages = {
  "Agent models": "에이전트 모델",
  "Choose a deployment-approved model for future webhook and queued jobs. Defaults follow deployment configuration.": "이후 웹훅 및 대기열 실행에 사용할 배포 승인 모델을 선택하세요. 기본값은 배포 설정을 따릅니다.",
  "Model selection unavailable.": "모델 설정을 불러올 수 없습니다.",
  "No alternate models are approved for this deployment.": "이 배포에 승인된 대체 모델이 없습니다.",
  "No alternate approved for this agent.": "이 에이전트에 승인된 대체 모델이 없습니다.",
  "Model for future jobs": "이후 작업에 사용할 모델",
  "Observed deployment model": "관측된 배포 모델",
  "Observed worker configuration is read-only. Model choices are staged until saved.": "관측된 워커 설정은 읽기 전용입니다. 모델 선택은 저장해야 반영됩니다.",
  "Inherit": "기본값",
  "Unavailable choice": "승인이 해제된 선택",
  "Choose approved models before saving.": "저장하기 전에 승인된 모델을 선택하세요.",
  "Discard draft and reload saved settings": "입력을 취소하고 최신 저장 설정 불러오기",
  "Model settings saved for future jobs.": "이후 실행에 적용할 모델 설정을 저장했습니다.",
  "Unable to reload saved model settings. Your draft is retained.": "저장된 모델 설정을 불러오지 못했습니다. 입력값은 유지됩니다.",
  "Unable to save model settings. Your draft is retained.": "모델 설정을 저장하지 못했습니다. 입력값은 유지됩니다.",
  "Model availability could not be verified for the configured API project. Your draft is retained.": "설정된 API 프로젝트에서 모델 사용 가능 여부를 확인하지 못했습니다. 입력값은 유지됩니다.",
  "Model settings changed in another session. Reload before saving.": "다른 세션에서 모델 설정이 변경되었습니다. 입력을 유지하고 최신 설정을 확인하세요.",
} as const;

const StatusValue = ({ value, language, yes = 'Enabled', no = 'Disabled' }: { value: boolean | undefined; language: Language; yes?: Message; no?: Message }) => <Badge tone={value === true ? 'success' : value === false && no === 'Incomplete' ? 'warning' : 'neutral'}>{translate(language, value === undefined ? 'Unknown' : value ? yes : no)}</Badge>;

export const ModelSettings = ({ language, agents, updatedAt, renderAgent }: { language: Language; agents?: readonly AgentSettings[]; updatedAt?: string; renderAgent: (role: AgentRole) => ReactNode }) => {
  const t = (key: keyof typeof messages) => language === 'ko' ? messages[key] : key;
  const [saved, setSaved] = useState<OperatorModelsResponse>();
  const [draft, setDraft] = useState<ModelOverrides>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'unavailable' | 'unauthorized' | ''>('');
  const [retry, setRetry] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState<keyof typeof messages | ''>('');
  const dirty = !!(saved && draft && modelRoles.some(role => saved.overrides[role] !== draft[role]));
  const valid = !!(draft && saved && approvedModelOverrides(draft, saved.policy));
  const approvedAlternates = !!(saved && modelRoles.some(role => saved.policy[role].allowed.length));

  useEffect(() => {
    const controller = new AbortController();
    setFailed('');
    setSaved(undefined);
    setDraft(undefined);
    fetch('/api/models', { signal: controller.signal, cache: 'no-store' })
      .then(response => { if (response.status === 401 || response.status === 403) throw new Error('unauthorized'); if (!response.ok) throw new Error('Model settings unavailable'); return response.json() as Promise<OperatorModelsResponse>; })
      .then(value => { if (!controller.signal.aborted) { setSaved(value); setDraft(value.overrides); setNotice(''); setConflict(false); setReview(false); } })
      .catch(error => { if (!controller.signal.aborted) setFailed(error instanceof Error && error.message === 'unauthorized' ? 'unauthorized' : 'unavailable'); });
    return () => controller.abort();
  }, [retry]);

  const change = (role: AgentRole, value: string) => setDraft(old => {
    if (!old) return old;
    const next = { ...old };
    if (value === 'inherit') delete next[role]; else next[role] = value;
    return next;
  });

  const save = async () => {
    if (!saved || !draft || !dirty || !valid || busy || conflict || review) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, overrides: draft }), cache: 'no-store' });
      if (response.status === 409) { setConflict(true); setNotice('Model settings changed in another session. Reload before saving.'); return; }
      if (response.status === 422) { setNotice('Model availability could not be verified for the configured API project. Your draft is retained.'); return; }
      if (!response.ok) throw new Error('Model settings unavailable');
      const record = await response.json() as OperatorModelsResponse;
      setSaved(record); setDraft(record.overrides); setNotice('Model settings saved for future jobs.');
    } catch { setNotice('Unable to save model settings. Your draft is retained.'); }
    finally { setBusy(false); }
  };

  const reload = async (discard = false) => {
    if (busy || !draft) return;
    setBusy(true);
    try {
      const response = await fetch('/api/models', { cache: 'no-store' });
      if (!response.ok) throw new Error('Model settings unavailable');
      const record = await response.json() as OperatorModelsResponse;
      const recovery = reconcileModelDraft(record, draft, discard);
      setSaved(recovery.saved); setDraft(recovery.draft); setConflict(false); setReview(recovery.needsReview); setNotice('');
    } catch { setNotice('Unable to reload saved model settings. Your draft is retained.'); }
    finally { setBusy(false); }
  };

  return <Card className="settings-panel runtime-controls agent-settings-panel">
    <h3>{translate(language, 'Agent configuration')}</h3>
    <p className="muted">{t('Choose a deployment-approved model for future webhook and queued jobs. Defaults follow deployment configuration.')}</p>
    <p className="muted">{t('Observed worker configuration is read-only. Model choices are staged until saved.')}{updatedAt && <> · {translate(language, 'Updated')}: {new Date(updatedAt).toLocaleString(language)}</>}</p>
    {failed && <><Alert tone="danger">{failed === 'unauthorized' ? translate(language, 'Session expired. Sign in again.') : t('Model selection unavailable.')}</Alert><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>{translate(language, 'Refresh')}</Button></>}
    {saved && !approvedAlternates && <p className="muted">{t('No alternate models are approved for this deployment.')}</p>}
    {!failed && !saved && <p className="muted" role="status">{translate(language, 'Loading status…')}</p>}
    <ul className="agent-settings-rows">{modelRoles.map(role => {
      const agent = agents?.find(item => item.role === role);
      const policy = saved?.policy[role];
      const current = draft?.[role];
      const options = policy ? [
        { value: 'inherit', label: t('Inherit') + ': ' + (policy.defaultModel ?? translate(language, 'Unknown')) },
        ...policy.allowed.map(model => ({ value: model, label: model })),
        ...(current && !policy.allowed.includes(current) ? [{ value: current, label: current + ' (' + t('Unavailable choice') + ')', disabled: true }] : [])
      ] : [];
      return <li key={role} className="agent-settings-row">
        <div className="agent-settings-identity">{renderAgent(role)}</div>
        <div className="agent-settings-observed">
          <div><small>{translate(language, 'State')}</small><StatusValue value={agent?.enabled} language={language}/></div>
          <div><small>{translate(language, 'Configuration')}</small><StatusValue value={agent?.configured} language={language} yes="Present" no="Incomplete"/></div>
          <div><small>{translate(language, 'Auto-merge:')}</small><StatusValue value={agent?.autoMerge} language={language}/></div>
        </div>
        <div className="agent-settings-model">
          <small>{t('Observed deployment model')}: <code>{agent?.model ?? translate(language, 'Unknown')}</code></small>
          <span className="agent-settings-model-label">{t('Model for future jobs')}</span>
          {policy && draft ? modelSelectionAvailable(policy.allowed, current) ? <Select aria-label={roles[role] + ' ' + t('Agent models')} value={current ?? 'inherit'} options={options} disabled={busy} onValueChange={value => change(role, value)}/> : <><code className="agent-settings-inherited">{t('Inherit')}: {policy.defaultModel ?? translate(language, 'Unknown')}</code><small>{t('No alternate approved for this agent.')} <code>{role.toUpperCase()}_OPERATOR_ALLOWED_MODELS</code></small></> : failed ? <span className="muted">{translate(language, 'Unknown')}</span> : <span className="skeleton-line" aria-hidden="true"/>}
        </div>
      </li>;
    })}</ul>
    {saved && draft && <>
      {!valid && <Alert tone="danger">{t('Choose approved models before saving.')}</Alert>}
      {dirty && <p role="status" className="muted">{translate(language, 'Unsaved changes. Save to apply.')}</p>}
      {review && <div className="conflict-review"><h3>{translate(language, 'Latest saved settings')}</h3>
        {modelRoles.map(role => <p key={role}>{roles[role]}: {saved.overrides[role] ?? t('Inherit') + ': ' + (saved.policy[role].defaultModel ?? translate(language, 'Unknown'))}</p>)}
        <Button variant="secondary" disabled={busy} onClick={() => setReview(false)}>{translate(language, 'Use my draft')}</Button></div>}
      <div className="control-actions">
        <Button onClick={() => void save()} disabled={!dirty || !valid || busy || conflict || review}>{translate(language, busy ? 'Saving…' : 'Save changes')}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setDraft({})}>{translate(language, 'Restore defaults')}</Button>
        {conflict && <Button variant="secondary" disabled={busy} onClick={() => void reload()}>{translate(language, 'Keep draft and reload revision')}</Button>}
        {(dirty || review || conflict) && <Button variant="secondary" disabled={busy} onClick={() => {
          if (conflict) { void reload(true); return; }
          setDraft(saved.overrides); setReview(false); setNotice('');
        }}>{conflict ? t('Discard draft and reload saved settings') : translate(language, 'Discard changes')}</Button>}
        {!dirty && !conflict && !review && <Button variant="secondary" disabled={busy} onClick={() => setRetry(n => n + 1)}>{translate(language, 'Reload saved settings')}</Button>}
      </div>
      {notice && <p role="status" className="control-notice">{t(notice)}</p>}
      {saved.updatedAt && <small className="muted">{translate(language, 'Updated')}: {new Date(saved.updatedAt).toLocaleString(language)}</small>}
    </>}
  </Card>;
};
