import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@oddmash/ui';
import { translate, type Language } from './i18n';

export const useUnsavedGuard = (language: Language) => {
  const [unsaved, setUnsaved] = useState(false);
  const [pending, setPending] = useState<(() => void)>();
  const focusReturn = useRef<HTMLElement|null>(null);
  const t = (message: Parameters<typeof translate>[1]) => translate(language, message);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const guard = (action: () => void) => {
    if (!unsaved) { action(); return; }
    focusReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending(() => action);
  };
  const cancel = () => setPending(undefined);
  const discard = () => {
    const action = pending;
    focusReturn.current = null;
    setPending(undefined);
    setUnsaved(false);
    action?.();
  };
  const dialog = <Dialog open={Boolean(pending)} onOpenChange={open=>{if(!open)cancel();}}>
    <DialogContent className="console-discard-dialog" onCloseAutoFocus={event=>{event.preventDefault();focusReturn.current?.focus();}}>
      <DialogTitle>{t('Unsaved changes')}</DialogTitle>
      <DialogDescription asChild><Alert tone="danger">{t('Leaving will discard your unsaved settings. Stay to save them first.')}</Alert></DialogDescription>
      <div className="control-actions"><Button variant="secondary" onClick={cancel}>{t('Stay')}</Button><Button className="console-logout" variant="secondary" onClick={discard}>{t('Discard and leave')}</Button></div>
    </DialogContent>
  </Dialog>;
  return { unsaved, setUnsaved, guard, dialog };
};
