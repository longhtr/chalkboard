/**
 * Requests future typing color from the active MathLive field. A custom event
 * is used because the imperative field, rather than React, owns typing style.
 */
export function requestEquationTypingColor(color: string): void {
  const field = document.querySelector<HTMLElement>('math-field');
  if (field === null) return;
  field.dispatchEvent(
    new CustomEvent('chalkboard-typing-color-request', {
      detail: { color },
    }),
  );
  if (!field.matches(':focus-within')) {
    window.requestAnimationFrame(() => field.focus({ preventScroll: true }));
  }
}
