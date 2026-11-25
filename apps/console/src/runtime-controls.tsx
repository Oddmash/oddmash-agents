import { useEffect, useState } from 'react';
import { Alert, Button, Card } from '@oddmash/ui';
import { defaultControls, optionalRoles, type ControlsRecord, type OperatorControls, type OptionalRole } from '@oddmash/agent-operator-contract';
import { displayLimit, readLimitInput, validControlLimits, controlsDirty, reviewRetainedDraft } from './control-draft';
import { ModelSettings } from './model-settings';
import { ConsoleSkeleton } from './console-skeleton';
import { translate, type Language, type Message } from './i18n';

const roleNames: Record<OptionalRole, string> = { impact: 'Impact', qa: 'QA', release: 'Release', docs: 'Docs', architect: 'Architect' };

export const RuntimeControls = ({ language, defaults }: { language: Language; defaults: { maxRequests?: number; maxMs?: number } }) => {
  const t = (key: Message) => translate(language, key);
  const [saved, setSaved] = useState<ControlsRecord>();
  const [draft, setDraft] = useState<OperatorControls>();
  const [emptyLimit, setEmptyLimit] = useState<'requests' | 'seconds' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Message | ''>('');
  const [failed, setFailed] = useState<'unavailable' | 'unauthorized' | ''>('');
  const [conflict, setConflict] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSaved(undefined); setDraft(undefined); setNotice(''); setFailed(''); setConflict(false); setNeedsReview(false);
    fetch('/api/controls', { cache: 'no-store', signal: controller.signal })
      .then(response => { if (response.status === 401 || response.status === 403) throw new Error('unauthorized'); if (!response.ok) throw new Error('Controls unavailable'); return response.json() as Promise<ControlsRecord>; })
      .then(record => { if (!controller.signal.aborted) { setSaved(record); setDraft(record.controls); } })
      .catch(error => { if (!controller.signal.aborted) setFailed(error instanceof Error && error.message === 'unauthorized' ? 'unauthorized' : 'unavailable'); });
    return () => controller.abort();
  }, [retry]);
  const dirty = Boolean(saved && draft && controlsDirty(saved.controls, draft));
  const valid = draft ? validControlLimits(draft, defaults) : false;
  const save = async () => {
    if (!saved || !draft || busy || !dirty || !valid || conflict || needsReview) return;
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
    if (busy || !draft) return;
    setBusy(true);
    try {
      const response = await fetch('/api/controls', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) { setNotice('Session expired. Sign in again.'); return; }
      if (!response.ok) throw new Error('Controls unavailable');
      const record = await response.json() as ControlsRecord;
      const recovery = reviewRetainedDraft(record, draft);
      setSaved(recovery.saved); setDraft(recovery.draft); setConflict(false); setNeedsReview(recovery.needsReview); setNotice('Latest revision loaded. Review your draft before saving.');
    } catch { setNotice('Unable to reload saved revision. Your draft is retained.'); }
    finally { setBusy(false); }
  };
  return <><Card className="settings-panel runtime-controls">
    <h3>{t("Runtime controls")}</h3>
    <p className="muted">{t("Restrict optional coordinated reviews. Deployment permissions, configured agents and approval gates remain unchanged.")}</p>
    {failed ? <><Alert tone="danger">{t(failed === 'unauthorized' ? "Session expired. Sign in again." : "Runtime controls unavailable.")}</Alert><Button variant="secondary" onClick={() => setRetry(value => value + 1)}>{t("Refresh")}</Button></> : !draft ? <ConsoleSkeleton view="controls" language={language}/> :
      <form onSubmit={event => event.preventDefault()}>
        <fieldset disabled={busy}><legend>{t("Participation")}</legend>
          <label className="control-check"><input type="checkbox" checked={draft.paused} onChange={event => setDraft({ ...draft, paused: event.target.checked })}/>{t("Pause coordinated specialists")}</label>
          <div className="role-checks">{optionalRoles.map(role => <label key={role} className="control-check"><input type="checkbox" checked={!draft.excludedRoles.includes(role)} disabled={draft.paused} onChange={event => setDraft({ ...draft, excludedRoles: optionalRoles.filter(item => item === role ? !event.target.checked : draft.excludedRoles.includes(item)) })}/>{roleNames[role]}</label>)}</div>
        </fieldset>
        <fieldset disabled={busy}><legend>{t("Review limits")}</legend>
          <div className="control-inputs"><label>{t("Maximum requests")}<input type="number" min="0" max={defaults.maxRequests ?? 5} step="1" placeholder={t("Unknown")} value={emptyLimit === 'requests' ? '' : displayLimit(draft.maxRequests, defaults.maxRequests)} onBlur={() => setEmptyLimit(null)} onChange={event => { const empty = event.target.value === '' && !event.target.validity.badInput; setEmptyLimit(empty ? 'requests' : null); setDraft({ ...draft, maxRequests: readLimitInput(event.target.value, event.target.valueAsNumber, event.target.validity.badInput) }); }}/></label>
          <label>{t("Maximum seconds")}<input type="number" min="0" max={defaults.maxMs === undefined ? 120 : defaults.maxMs / 1000} step="0.001" placeholder={t("Unknown")} value={emptyLimit === 'seconds' ? '' : displayLimit(draft.maxMs, defaults.maxMs, 1000)} onBlur={() => setEmptyLimit(null)} onChange={event => { const empty = event.target.value === '' && !event.target.validity.badInput; setEmptyLimit(empty ? 'seconds' : null); setDraft({ ...draft, maxMs: readLimitInput(event.target.value, event.target.valueAsNumber, event.target.validity.badInput, 1000) }); }}/></label></div>
        </fieldset>
        <p className="muted">{t("Clear a limit to inherit its deployment default. Save to apply to future jobs only.")}</p>
        {!valid && <Alert tone="danger">{t("Enter valid limits within the deployment defaults.")}</Alert>}
        {dirty && <p role="status" className="muted">{t("Unsaved changes. Save to apply.")}</p>}
        {needsReview && saved && <div className="conflict-review"><h3>{t("Latest saved settings")}</h3><p>{t("Pause coordinated specialists")}: {t(saved.controls.paused ? "Enabled" : "Disabled")}</p><p>{t("Participation")}: {optionalRoles.filter(role => !saved.controls.excludedRoles.includes(role)).map(role => roleNames[role]).join(', ') || t("Disabled")}</p><p>{t("Review limits")}: {saved.controls.maxRequests ?? t("Deployment default")} / {saved.controls.maxMs === null ? t("Deployment default") : saved.controls.maxMs / 1000 + 's'}</p><Button type="button" variant="secondary" disabled={busy} onClick={() => { setNeedsReview(false); setNotice('Draft confirmed. Save to apply your changes.'); }}>{t("Use my draft")}</Button></div>}
        <div className="control-actions"><Button type="button" onClick={() => void save()} disabled={!dirty || !valid || busy || conflict || needsReview}>{t(busy ? "Saving…" : "Save changes")}</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => { setEmptyLimit(null); setDraft(defaultControls()); setNotice(saved && controlsDirty(saved.controls, defaultControls()) ? "Defaults staged. Save to apply." : ""); }}>{t("Restore defaults")}</Button><Button type="button" variant="secondary" disabled={busy || dirty} onClick={() => setRetry(value => value + 1)}>{t("Reload saved settings")}</Button>{dirty && !conflict && <Button type="button" variant="secondary" disabled={busy} onClick={() => { setEmptyLimit(null); if (saved) setDraft(saved.controls); setNeedsReview(false); setNotice(""); }}>{t("Discard changes")}</Button>}{conflict && <Button type="button" variant="secondary" disabled={busy} onClick={() => void reloadRevision()}>{t("Keep draft and reload revision")}</Button>}</div>
        {notice && <p role="status" className="control-notice">{t(notice)}</p>}
        {saved?.updatedAt && <small className="muted">{t("Updated")}: {new Date(saved.updatedAt).toLocaleString(language)}</small>}
      </form>}
  </Card><ModelSettings language={language}/></>;
};
