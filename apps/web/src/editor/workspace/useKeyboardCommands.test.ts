/** Proves the stable listener invokes current commands and is installed/removed exactly once per lifetime. */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleKeyboardCommand,
  type KeyboardCommandOptions,
} from '../interaction/keyboardCommands';
import { useKeyboardCommands } from './useKeyboardCommands';

vi.mock('../interaction/keyboardCommands', () => ({
  handleKeyboardCommand: vi.fn(),
}));

const options = (activeTool: KeyboardCommandOptions['activeTool']) => ({
  activeTool,
  bezierHandlePreview: false,
  canDelete: false,
  canNudgeSelection: false,
  currentStrokeColor: '#1f2937',
  editingEquation: false,
  modalOpen: false,
  readOnly: false,
  strokeColors: ['#1f2937'],
  toolOrder: ['selection'] as const,
  addStraightPoint: vi.fn(() => false),
  adjustLineSpacing: vi.fn(),
  adjustTextSize: vi.fn(),
  cancelBezierPreview: vi.fn(),
  copySelectedObjects: vi.fn(),
  deleteSelection: vi.fn(),
  moveToEquation: vi.fn(),
  nudgeSelection: vi.fn(),
  pasteCopiedObjects: vi.fn(),
  requestHistory: vi.fn(),
  selectTool: vi.fn(),
  setTypingColor: vi.fn(),
  toggleEquationEditingView: vi.fn(),
  toggleEquationInputMode: vi.fn(),
  toggleSelectionObjects: vi.fn(),
});

describe('useKeyboardCommands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates window keydown events to the latest controller options', () => {
    const initial = options('selection');
    const { rerender, unmount } = renderHook(
      (value: KeyboardCommandOptions) => useKeyboardCommands(value),
      { initialProps: initial },
    );
    const firstEvent = new KeyboardEvent('keydown', { key: '1' });
    act(() => window.dispatchEvent(firstEvent));
    expect(handleKeyboardCommand).toHaveBeenLastCalledWith(firstEvent, initial);

    const updated = options('hand');
    rerender(updated);
    const secondEvent = new KeyboardEvent('keydown', { key: '2' });
    act(() => window.dispatchEvent(secondEvent));
    expect(handleKeyboardCommand).toHaveBeenLastCalledWith(
      secondEvent,
      updated,
    );

    unmount();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' })));
    expect(handleKeyboardCommand).toHaveBeenCalledTimes(2);
  });
});
