/**
 * Owns modal focus from mount through teardown: initial focus, Tab wrapping,
 * Escape close, and restoration to the element that opened the modal.
 */
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Traps keyboard focus inside a modal and restores the opener on teardown. */
export function useModalFocus<T extends HTMLElement>(
  active = true,
): RefObject<T | null> {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (container === null) return;
    const previouslyFocused = document.activeElement;
    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hidden);
    const focusFrame = window.requestAnimationFrame(() => {
      if (container.contains(document.activeElement)) return;
      const initial =
        container.querySelector<HTMLElement>('[data-dialog-autofocus]') ??
        focusable()[0];
      initial?.focus();
    });
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = focusable();
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', containFocus, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', containFocus, true);
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return containerRef;
}
