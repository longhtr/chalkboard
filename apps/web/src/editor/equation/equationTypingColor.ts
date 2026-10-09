/**
 * Requests future typing color from the active MathLive field. A custom event
 * is used because the imperative field, rather than React, owns typing style.
 */
import { focusDeliberately } from '../../math/writerFocus';

export function requestEquationTypingColor(color: string): void {
  const field = document.querySelector<HTMLElement>('math-field');
  if (field === null) return;
  field.dispatchEvent(
    new CustomEvent('chalkboard-typing-color-request', {
      detail: { color },
    }),
  );
  // The clicked swatch or remove button may disappear in the same React
  // update. Always complete the handoff in the next frame rather than relying
  // on its transient :focus-within state at dispatch time.
  window.requestAnimationFrame(() =>
    focusDeliberately(field, { preventScroll: true }),
  );
}
