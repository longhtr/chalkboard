/** Exhaustive command matching, argument buffering, placeholder filling, escaping, and cancellation cases. */
import { describe, expect, it } from 'vitest';

import {
  addCommandCompletionPlaceholders,
  bufferedCommandCompletion,
  deferredCommandCompletion,
  fillBufferedCommandCompletion,
  fillDeferredCommandCompletion,
  immediateCommandCompletion,
} from './commandCompletion';

describe('addCommandCompletionPlaceholders', () => {
  it.each([
    [String.raw`$ \dot{} $`, String.raw`\dot{\placeholder{}}`],
    [String.raw`$ \underbrace{} $`, String.raw`\underbrace{\placeholder{}}`],
    [String.raw`\sqrt{}`, String.raw`\sqrt{\placeholder{}}`],
    [String.raw`\cancel{}`, String.raw`\cancel{\placeholder{}}`],
    [
      String.raw`\overrightarrow{}`,
      String.raw`\overrightarrow{\placeholder{}}`,
    ],
    [String.raw`\boxed{}`, String.raw`\boxed{\placeholder{}}`],
    [String.raw`\underline{}`, String.raw`\underline{\placeholder{}}`],
  ])('adds an argument to %s', (selection, expected) => {
    expect(addCommandCompletionPlaceholders(selection)).toBe(expected);
  });

  it('adds placeholders to every empty argument', () => {
    expect(addCommandCompletionPlaceholders(String.raw`\mathtip{}{}`)).toBe(
      String.raw`\mathtip{\placeholder{}}{}`,
    );
    expect(
      addCommandCompletionPlaceholders(String.raw`\enclose{}[shadow="none"]{}`),
    ).toBe(String.raw`\enclose{box}[shadow="none"]{\placeholder{}}`);
  });

  it('adds a body to declaration-style completions', () => {
    expect(addCommandCompletionPlaceholders(String.raw`{\displaystyle}`)).toBe(
      String.raw`{\displaystyle\placeholder{}}`,
    );
  });

  it('defers commands whose empty MathLive completion loses its body', () => {
    expect(deferredCommandCompletion(String.raw`\mathbf`)).toEqual({
      template: String.raw`\mathbf{#}`,
    });
    expect(deferredCommandCompletion(String.raw`\textbf`)).toEqual({
      template: String.raw`\mathbf{#}`,
    });
    expect(deferredCommandCompletion(String.raw`\^`)).toEqual({
      template: String.raw`\^{#}`,
    });
    expect(deferredCommandCompletion(String.raw`\bigl`)).toEqual({
      template: String.raw`\bigl#`,
    });
    expect(bufferedCommandCompletion(String.raw`\the`)).toEqual({
      argumentModes: ['raw'],
      template: String.raw`\the{#1}`,
    });
    expect(deferredCommandCompletion(String.raw`\alpha`)).toBeNull();
    expect(bufferedCommandCompletion(String.raw`\color`)).toEqual({
      argumentModes: ['raw', 'math'],
      template: String.raw`\textcolor{#1}{#2}`,
    });
    expect(
      fillBufferedCommandCompletion(String.raw`\textcolor{#1}{#2}`, [
        'red',
        'x',
      ]),
    ).toBe(String.raw`\textcolor{red}{x}`);
    expect(immediateCommandCompletion(String.raw`\pdiff`)).toBe(
      String.raw`\frac{\partial \placeholder{}}{\partial \placeholder{}}`,
    );
    expect(fillDeferredCommandCompletion(String.raw`\mathbf{#}`, 'x')).toBe(
      String.raw`\mathbf{x}`,
    );
  });

  it('does not alter existing placeholders or ordinary selections', () => {
    expect(
      addCommandCompletionPlaceholders(String.raw`\frac{\placeholder{}}{}`),
    ).toBeNull();
    expect(addCommandCompletionPlaceholders('x+{}')).toBeNull();
    expect(addCommandCompletionPlaceholders('plain text')).toBeNull();
  });
});
