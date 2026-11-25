import { useEffect, useState } from 'react';
import { Alert, Button, Card, Select } from '@oddmash/ui';
import { approvedModelOverrides, modelRoles, type AgentRole, type ModelOverrides, type OperatorModelsResponse } from '@oddmash/agent-operator-contract';
import { ConsoleSkeleton } from './console-skeleton';
import { translate, type Language } from './i18n';

const roles: Record<AgentRole, string> = { reviewer: 'Lead', impact: 'Impact', triage: 'Triage', qa: 'QA', release: 'Release', docs: 'Docs', architect: 'Architect' };
const messages = {
  "Agent models": "에이전트 모델",
  "Choose a deployment-approved model for future webhook and queued jobs. Defaults follow deployment configuration.": "이후 웹훅 및 대기열 실행에 사용할 배포 승인 모델을 선택하세요. 기본값은 배포 설정을 따릅니다.",
  "Model selection unavailable.": "모델 설정을 불러올 수 없습니다.",
  "No alternate models are approved for this deployment.": "이 배포에 승인된 대체 모델이 없습니다.",
  "Inherit": "기본값",
  "Unavailable choice": "승인이 해제된 선택",
  "Choose approved models before saving.": "저장하기 전에 승인된 모델을 선택하세요.",
  "Model settings saved for future jobs.": "이후 실행에 적용할 모델 설정을 저장했습니다.",
  "Unable to save model settings. Your draft is retained.": "모델 설정을 저장하지 못했습니다. 입력값은 유지됩니다.",
  "Model settings changed in another session. Reload before saving.": "다른 세션에서 모델 설정이 변경되었습니다. 입력을 유지하고 최신 설정을 확인하세요.",
  "Reload latest model settings or discard your local choices.": "최신 모델 설정을 불러오거나 내 변경을 취소하세요.",
} as const;

export const ModelSettings = ({ language }: { language: Language }) => {
  const t = (key: keyof typeof messages) => language === 'ko' ? messages[key] : key;
  const [saved, setSaved] = useState<OperatorModelsResponse>();
  const [draft, setDraft] = useState<ModelOverrides>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState('');
  const dirty = !!(saved && draft && modelRoles.some(role => saved.overrides[role] !== draft[role]));
  const valid = !!(draft && saved && approvedModelOverrides(draft, saved.policy));
  const approvedAlternates = !!(saved && modelRoles.some(role => saved.policy[role].allowed.length));

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    setSaved(undefined);
    setDraft(undefined);
    fetch('/api/models', { signal: controller.signal, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('Model settings unavailable'); return response.json() as Promise<OperatorModelsResponse>; })
      .then(value => { if (!controller.signal.aborted) { setSaved(value); setDraft(value.overrides); setNotice(''); setConflict(false); setReview(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
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
      if (response.status === 409) { setConflict(true); setNotice(t('Model settings changed in another session. Reload before saving.')); return; }
      if (!response.ok) throw new Error('Model settings unavailable');
      const record = await response.json() as OperatorModelsResponse;
      setSaved(record); setDraft(record.overrides); setNotice(t('Model settings saved for future jobs.'));
    } catch { setNotice(t('Unable to save model settings. Your draft is retained.')); }
    finally { setBusy(false); }
  };

  const reload = async () => {
    if (busy || !draft) return;
    setBusy(true);
    try {
      const response = await fetch('/api/models', { cache: 'no-store' });
      if (!response.ok) throw new Error('Model settings unavailable');
      const record = await response.json() as OperatorModelsResponse;
      setSaved(record); setConflict(false); setReview(true); setNotice('');
    } catch { setNotice(t('Unable to save model settings. Your draft is retained.')); }
    finally { setBusy(false); }
  };

  return <Card className="settings-panel runtime-controls">
    <h3>{t('Agent models')}</h3>
    <p className="muted">{t('Choose a deployment-approved model for future webhook and queued jobs. Defaults follow deployment configuration.')}</p>
    {failed ? <><Alert tone="danger">{t('Model selection unavailable.')}</Alert><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>{translate(language, 'Refresh')}</Button></> : !saved || !draft ? <ConsoleSkeleton view="controls" language={language}/> : <>
      {!approvedAlternates && <p className="muted">{t('No alternate models are approved for this deployment.')}</p>}
      <fieldset disabled={busy}>
        <legend>{t('Agent models')}</legend>
        <div className="control-inputs">{modelRoles.map(role => {
          const policy = saved.policy[role];
          const current = draft[role];
          const options = [
            { value: 'inherit', label: t('Inherit') + ': ' + (policy.defaultModel ?? translate(language, 'Unknown')) },
            ...policy.allowed.map(model => ({ value: model, label: model })),
            ...(current && !policy.allowed.includes(current) ? [{ value: current, label: current + ' (' + t('Unavailable choice') + ')', disabled: true }] : [])
          ];
          return <div key={role}><label>{roles[role]}</label><Select aria-label={roles[role] + ' ' + t('Agent models')} value={current ?? 'inherit'} options={options} disabled={busy || (!policy.allowed.length && !current)} onValueChange={value => change(role, value)} /></div>;
        })}</div>
      </fieldset>
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
          if (conflict) { setRetry(n => n + 1); return; }
          setDraft(saved.overrides); setReview(false); setNotice('');
        }}>{translate(language, 'Discard changes')}</Button>}
        {!dirty && !conflict && !review && <Button variant="secondary" disabled={busy} onClick={() => setRetry(n => n + 1)}>{translate(language, 'Reload saved settings')}</Button>}
      </div>
      {notice && <p role="status" className="control-notice">{notice}</p>}
      {saved.updatedAt && <small className="muted">{translate(language, 'Updated')}: {new Date(saved.updatedAt).toLocaleString(language)}</small>}
    </>}
  </Card>;
};
