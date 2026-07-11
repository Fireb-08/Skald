import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

// Dialogs can open confirmations above themselves. Document-level handlers all
// receive the same key event, so a small ownership stack ensures only the most
// recently opened modal traps Tab or consumes Escape.
const modalStack: symbol[] = [];

/** Shared modal keyboard contract: initial focus, Tab containment, Escape, restore. */
export function useModalFocus<T extends HTMLElement>(onClose: () => void, escapeEnabled = true) {
  const modalRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const modalIdRef = useRef(Symbol('onyx-modal'));
  closeRef.current = onClose;
  useEffect(() => {
    const modalId = modalIdRef.current;
    modalStack.push(modalId);
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const focusFrame = requestAnimationFrame(() => modal?.querySelector<HTMLElement>(FOCUSABLE)?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (!modalRef.current || modalStack[modalStack.length - 1] !== modalId) return;
      if (event.key === 'Escape' && escapeEnabled) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) { event.preventDefault(); modalRef.current.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // If focus has escaped the modal (e.g. it landed on document.body after a
      // backdrop click), neither first/last check matches and the browser would
      // advance focus out of the modal on this Tab. Pull it back to the first
      // focusable so the trap holds regardless of where activeElement currently is.
      if (!modalRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      cancelAnimationFrame(focusFrame);
      const stackIndex = modalStack.lastIndexOf(modalId);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      if (previous?.isConnected) previous.focus();
    };
  }, [escapeEnabled]);
  return modalRef;
}
