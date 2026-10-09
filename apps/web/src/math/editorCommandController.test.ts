/** Uses a minimal field model to prove command discovery, anchors, placeholders, repair, and cancellation. */
import type { MathfieldElement } from 'mathlive';
import { describe, expect, it, vi } from 'vitest';

import { EditorCommandController } from './editorCommandController';

function commandField(source: string, overrides: Record<string, unknown> = {}) {
  const insert = vi.fn();
  const field = {
    getValue: (range: [number, number] | { ranges: [number, number][] }) => {
      const offsets = Array.isArray(range) ? range : range.ranges[0];
      return source.slice(offsets?.[0] ?? 0, offsets?.[1] ?? source.length);
    },
    insert,
    lastOffset: source.length,
    macros: {},
    mode: 'math',
    position: source.length,
    selection: { direction: 'none', ranges: [[0, source.length]] },
    selectionIsCollapsed: false,
    ...overrides,
  } as unknown as MathfieldElement;
  return { field, insert };
}

describe('active editor command controller', () => {
  it('finds the active bounded command and expands argument macros', () => {
    const { field } = commandField(String.raw`x+\sqrt`, {
      macros: { pair: { args: 2, def: '#1+#2' } },
    });
    const controller = new EditorCommandController(field);

    expect(controller.activeLatexCommand()).toBe(String.raw`\sqrt`);
    expect(controller.macroCommandCompletion(String.raw`\pair`)).toBe(
      String.raw`\placeholder{}+\placeholder{}`,
    );
    expect(controller.macroCommandCompletion(String.raw`\missing`)).toBeNull();
  });

  it('clamps and consumes a command transaction anchor', () => {
    const { field } = commandField('abc');
    const controller = new EditorCommandController(field);
    controller.beginTransaction(20);

    controller.restoreTransactionStartPosition();
    expect(field.position).toBe(3);

    field.position = 1;
    controller.restoreTransactionStartPosition();
    expect(field.position).toBe(1);
  });

  it('repairs an empty command argument and retains a fallback completion', () => {
    const { field, insert } = commandField(String.raw`\sqrt{}`);
    const controller = new EditorCommandController(field);

    expect(controller.repairEmptyArguments()).toBe(false);
    expect(insert).toHaveBeenCalledWith(String.raw`\sqrt{\placeholder{}}`, {
      focus: true,
      format: 'latex',
      insertionMode: 'replaceSelection',
      mode: 'math',
      selectionMode: 'placeholder',
      silenceNotifications: true,
    });
    expect(controller.unselectableCompletion).toBe(
      String.raw`\sqrt{\placeholder{}}`,
    );
  });
});
