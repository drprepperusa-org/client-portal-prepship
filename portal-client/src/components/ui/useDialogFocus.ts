import { useEffect, useRef, type RefObject } from 'react';

const dialogs: HTMLElement[] = [];
let unlockedOverflow = '';
let unlockedPaddingRight = '';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.matches(':disabled') && !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length > 0,
  );
}

/** Shared dialog behavior: focus entry/trap/restore, Escape, and scroll lock. */
export function useDialogFocus(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = containerRef.current;
    if (!panel) return;
    if (!dialogs.length) unlockedOverflow = document.body.style.overflow;
    if (!dialogs.length) {
      unlockedPaddingRight = document.body.style.paddingRight;
      const bodyPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
      }
    }
    dialogs.push(panel);
    document.body.style.overflow = 'hidden';

    const focusFrame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container || dialogs.at(-1) !== panel) return;
      (focusableElements(container)[0] ?? container).focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (dialogs.at(-1) !== panel) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;
      const elements = focusableElements(container);
      if (!elements.length) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown);
      const wasTop = dialogs.at(-1) === panel;
      const index = dialogs.indexOf(panel);
      if (index !== -1) dialogs.splice(index, 1);
      if (!dialogs.length) document.body.style.overflow = unlockedOverflow;
      if (!dialogs.length) document.body.style.paddingRight = unlockedPaddingRight;
      if (wasTop && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [containerRef, open]);
}
