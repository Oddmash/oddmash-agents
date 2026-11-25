import { useEffect, useState } from 'react';
import { Alert, Button, Card } from '@oddmash/ui';
import { defaultControls, optionalRoles, type ControlsRecord, type OperatorControls, type OptionalRole } from '@oddmash/agent-operator-contract';
import { translate, type Language, type Message } from './i18n';

const roleNames: Record<OptionalRole, string> = { impact: 'Impact', qa: 'QA', release: 'Release', docs: 'Docs', architect: 'Architect' };

export const RuntimeControls = ({ language }: { language: Language }) => {
  const t = (key: Message) => translate(language, key);
  const [saved, setSaved] = useState<ControlsRecord>();
  const [draft, setDraft] = useState<OperatorControls>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Message | ''>('');
  const [failed, setFailed] = useState<'unavailable' | 'unauthorized' | ''>('');
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSaved(undefined); setDraft(undefined); setNotice(''); setFailed(''); setConflict(false);
    fetch('/api/controls', { cache: 'no-store', signal: controller.signal })
      .then(response => { if (response.status === 401 || response.status === 403) throw new Error('unauthorized'); if (!response.ok) throw new Error('Controls unavailable'); return response.json() as Promise<ControlsRecord>; })
      .then(record => { if (!controller.signal.aborted) { setSaved(record); setDraft(record.controls); } })
      .catch(error => { if (!controller.signal.aborted) setFailed(error instanceof Error && error.message === 'unauthorized' ? 'unauthorized' : 'unavailable'); });
    return () => controller.abort();
  }, [retry]);
  const dirty = Boolean(saved && draft && JSON.stringify(saved.controls) !== JSON.stringify(draft));
  const save = async () => {
    if (!saved || !draft || busy || !dirty || conflict) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/controls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, controls: draft }), cache: 'no-store' });
      if (response.status === 409) { setConflict(true); setNotice('Controls changed in another session. Reload before saving.'); return; }
      if (response.status === 401 || response.status === 403) { setNotice('Session expired. Sign in again.'); return; }
      if (!response.ok) throw new Error('Save failed');
      const record = await response.json() as ControlsRecord;
      setSaved(record); setDraft(record.controls); setNotice('Saved for future coordinated reviews.');
    } catch { setNotice('Unable to save runtime controls. Your draft is retained.'); }
    finally { setBusy(false); }
  };
  const reloadRevision = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/controls', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) { setNotice('Session expired. Sign in again.'); return; }
      if (!response.ok) throw new Error('Controls unavailable');
      const record = await response.json() as ControlsRecord;
      setSaved(record); setConflict(false); setNotice('Latest revision loaded. Review your draft before saving.');
    } catch { setNotice('Unable to save runtime controls. Your draft is retained.'); }
    finally { setBusy(false); }
  };
  return <Card className="settings-panel runtime-controls">
    <h3>{t("Runtime controls")}</h3>
    <p className="muted">{t("Restrict optional coordinated reviews. Deployment permissions, configured agents and approval gates remain unchanged.")}</p>
    {failed ? <><Alert tone="danger">{t(failed === 'unauthorized' ? "Session expired. Sign in again." : "Runtime controls unavailable.")}</Alert><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>{t("Refresh")}</Button></> : !draft ? <p role="status" className="muted">{t("Loading status…")}</p> :
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy}><legend>{t("Participation")}</legend>
          <label className="control-check"><input type="checkbox" checked={draft.paused} onChange={event => setDraft({ ...draft, paused: event.target.checked })}/>{t("Pause coordinated specialists")}</label>
          <div className="role-checks">{optionalRoles.map(role => <label key={role} className="control-check"><input type="checkbox" checked={!draft.excludedRoles.includes(role)} disabled={draft.paused} onChange={event => setDraft({ ...draft, excludedRoles: optionalRoles.filter(item => item === role ? !event.target.checked : draft.excludedRoles.includes(item)) })}/>{roleNames[role]}</label>)}</div>
        </fieldset>
        <fieldset disabled={busy}><legend>{t("Review limits")}</legend>
          <div className="control-inputs"><label>{t("Maximum requests (blank uses deployment default)")}<input type="number" min="0" max="5" step="1" value={draft.maxRequests ?? ''} onChange={event => setDraft({ ...draft, maxRequests: event.target.value === '' ? null : event.target.valueAsNumber })}/></label>
          <label>{t("Maximum seconds (blank uses deployment default)")}<input type="number" min="0" max="120" step="1" value={draft.maxMs === null ? '' : draft.maxMs / 1000} onChange={event => setDraft({ ...draft, maxMs: event.target.value === '' ? null : event.target.valueAsNumber * 1000 })}/></label></div>
        </fieldset>
        <p className="muted">{t("Limits are capped by deployment settings. Changes apply to future jobs only.")}</p>
        <div className="control-actions"><Button type="submit" disabled={!dirty || busy || conflict}>{t(busy ? "Saving…" : "Save changes")}</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setDraft(defaultControls())}>{t("Restore defaults")}</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setRetry(value => value + 1)}>{t("Reload saved settings")}</Button>{conflict && <Button type="button" variant="secondary" disabled={busy} onClick={() => void reloadRevision()}>{t("Keep draft and reload revision")}</Button>}</div>
        {notice && <p role="status" className="control-notice">{t(notice)}</p>}
        {saved?.updatedAt && <small className="muted">{t("Updated")}: {new Date(saved.updatedAt).toLocaleString(language)}</small>}
      </form>}
  </Card>;
};
