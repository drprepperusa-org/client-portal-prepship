import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { Modal } from './Modal';
import { Button } from './Button';

/** Mount only for an open draft; closed forms must not register router blockers. */
export function DraftModal({ dirty, saving, onClose, title, maxWidth, children, discardMessage }: {
  dirty: boolean;
  saving: boolean;
  onClose: () => void;
  title: string;
  maxWidth: number;
  children: (requestClose: () => void) => ReactNode;
  discardMessage?: string;
}) {
  const blocker = useBlocker(dirty || saving);
  const [closeRequested, setCloseRequested] = useState(false);
  const [saveNotice, setSaveNotice] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const confirming = closeRequested || (blocker.state === 'blocked' && !saving);

  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  useEffect(() => {
    if (saving && blocker.state === 'blocked') {
      blocker.reset();
      setSaveNotice(true);
    }
  }, [saving, blocker]);

  useEffect(() => {
    if (!confirming) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => keepButton.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [confirming]);

  function keepEditing() {
    setCloseRequested(false);
    if (blocker.state === 'blocked') blocker.reset();
    requestAnimationFrame(() => previousFocus.current?.focus());
  }

  function requestClose() {
    if (saving) { setSaveNotice(true); return; }
    if (confirming) { keepEditing(); return; }
    if (dirty) setCloseRequested(true);
    else onClose();
  }

  function discard() {
    // Proceed before unmounting the blocker. Closing also clears form-local state.
    if (blocker.state === 'blocked') blocker.proceed();
    onClose();
  }

  return (
    <Modal open onClose={requestClose} title={confirming ? 'Discard unsaved changes?' : title} maxWidth={maxWidth}>
      {confirming && (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">{discardMessage ?? 'Your changes have not been saved. Keep editing to finish, or discard this draft.'}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button ref={keepButton} variant="secondary" onClick={keepEditing}>Keep editing</Button>
            <Button variant="danger" onClick={discard}>Discard changes</Button>
          </div>
        </div>
      )}
      <div hidden={confirming}>
        {saveNotice && saving && <p role="status" className="mb-3 text-sm text-ink-2">Saving. Please wait before leaving this form.</p>}
        <fieldset disabled={saving} className="min-w-0" aria-busy={saving}>
          {children(requestClose)}
        </fieldset>
      </div>
    </Modal>
  );
}
