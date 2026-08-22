/** Locks the custom typing-color event name, payload, and browser dispatch target. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import { requestEquationTypingColor } from './equationTypingColor';

describe('requestEquationTypingColor', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('sends the color to the active field and restores focus in a frame', () => {
    const field = document.createElement('math-field');
    const focus = vi.fn();
    field.focus = focus;
    const received = vi.fn();
    field.addEventListener('chalkboard-typing-color-request', received);
    document.body.append(field);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    requestEquationTypingColor('#1971c2');

    expect(received).toHaveBeenCalledOnce();
    const event = requiredTestValue(
      received.mock.calls[0]?.[0],
      'typing-color event',
    );
    if (!(event instanceof CustomEvent)) {
      throw new Error('Expected a custom typing-color event');
    }
    expect(event.detail).toEqual({ color: '#1971c2' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does nothing when no field is mounted', () => {
    expect(() => requestEquationTypingColor('#1971c2')).not.toThrow();
  });
});
