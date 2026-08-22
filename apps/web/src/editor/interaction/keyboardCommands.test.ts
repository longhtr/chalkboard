/** Proves command precedence, platform modifiers, input/modal guards, tool shortcuts, history, and deletion. */
import { describe, expect, it, vi } from 'vitest';

import {
  handleKeyboardCommand,
  type KeyboardCommandOptions,
} from './keyboardCommands';

function options(
  overrides: Partial<KeyboardCommandOptions> = {},
): KeyboardCommandOptions {
  return {
    activeTool: 'selection',
    bezierHandlePreview: false,
    canDelete: false,
    canNudgeSelection: false,
    currentStrokeColor: '#111111',
    editingEquation: false,
    modalOpen: false,
    readOnly: false,
    strokeColors: ['#111111', '#222222', '#333333'],
    toolOrder: ['selection', 'hand', 'shape', 'line', 'equation'],
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
    ...overrides,
  };
}

function press(
  key: string,
  commandOptions: KeyboardCommandOptions,
  init: KeyboardEventInit = {},
  target: HTMLElement | Window = window,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
    key,
  });
  const listener = (received: Event) =>
    handleKeyboardCommand(received as KeyboardEvent, commandOptions);
  target.addEventListener('keydown', listener, { once: true });
  target.dispatchEvent(event);
  return event;
}

describe('workspace keyboard routing', () => {
  it('routes history, tool, clipboard, and delete commands', () => {
    const commandOptions = options({ canDelete: true });

    expect(press('z', commandOptions, { ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(commandOptions.requestHistory).toHaveBeenCalledWith('undo');
    press('z', commandOptions, { ctrlKey: true, shiftKey: true });
    expect(commandOptions.requestHistory).toHaveBeenLastCalledWith('redo');
    press('y', commandOptions, { ctrlKey: true });
    expect(commandOptions.requestHistory).toHaveBeenLastCalledWith('redo');

    press('1', commandOptions, { ctrlKey: true });
    expect(commandOptions.toggleSelectionObjects).toHaveBeenCalledOnce();
    expect(commandOptions.selectTool).not.toHaveBeenCalled();

    press('3', commandOptions, { ctrlKey: true });
    expect(commandOptions.selectTool).toHaveBeenCalledWith('shape');

    press('c', commandOptions, { ctrlKey: true });
    press('v', commandOptions, { ctrlKey: true });
    expect(commandOptions.copySelectedObjects).toHaveBeenCalledOnce();
    expect(commandOptions.pasteCopiedObjects).toHaveBeenCalledOnce();

    press('Delete', commandOptions);
    expect(commandOptions.deleteSelection).toHaveBeenCalledOnce();
  });

  it('nudges a selection by one or ten units without taking editable arrows', () => {
    const commandOptions = options({ canNudgeSelection: true });

    expect(press('ArrowRight', commandOptions).defaultPrevented).toBe(true);
    expect(commandOptions.nudgeSelection).toHaveBeenNthCalledWith(
      1,
      'ArrowRight',
      1,
    );
    expect(
      press('ArrowUp', commandOptions, { shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(commandOptions.nudgeSelection).toHaveBeenNthCalledWith(
      2,
      'ArrowUp',
      10,
    );

    const input = document.createElement('input');
    document.body.append(input);
    expect(press('ArrowLeft', commandOptions, {}, input).defaultPrevented).toBe(
      false,
    );
    expect(commandOptions.nudgeSelection).toHaveBeenCalledTimes(2);
    input.remove();

    const shapeTool = options({
      activeTool: 'shape',
      canNudgeSelection: true,
    });
    expect(press('ArrowDown', shapeTool).defaultPrevented).toBe(false);
    expect(shapeTool.nudgeSelection).not.toHaveBeenCalled();
  });

  it('locks a connected Straight point only during its active drawing gesture', () => {
    const addStraightPoint = vi.fn(() => true);
    const commandOptions = options({ activeTool: 'line', addStraightPoint });

    expect(press(' ', commandOptions, { code: 'Space' }).defaultPrevented).toBe(
      true,
    );
    expect(addStraightPoint).toHaveBeenCalledOnce();

    addStraightPoint.mockReturnValue(false);
    expect(press(' ', commandOptions, { code: 'Space' }).defaultPrevented).toBe(
      false,
    );
  });

  it('does not apply keyboard history while Drag canvas is active', () => {
    const commandOptions = options({ activeTool: 'hand' });

    expect(press('z', commandOptions, { ctrlKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(
      press('z', commandOptions, { ctrlKey: true, shiftKey: true })
        .defaultPrevented,
    ).toBe(false);
    expect(commandOptions.requestHistory).not.toHaveBeenCalled();
  });

  it('leaves editable controls in charge of text history and deletion', () => {
    const commandOptions = options({ canDelete: true });
    const input = document.createElement('input');
    document.body.append(input);

    expect(
      press('z', commandOptions, { ctrlKey: true }, input).defaultPrevented,
    ).toBe(false);
    press('Backspace', commandOptions, {}, input);
    press('=', commandOptions, { altKey: true, code: 'Equal' }, input);
    expect(commandOptions.requestHistory).not.toHaveBeenCalled();
    expect(commandOptions.deleteSelection).not.toHaveBeenCalled();
    expect(commandOptions.adjustTextSize).not.toHaveBeenCalled();
    input.remove();
  });

  it('adjusts text size and line spacing with Alt shortcuts', () => {
    const commandOptions = options();

    press('-', commandOptions, { altKey: true, code: 'Minus' });
    press('=', commandOptions, { altKey: true, code: 'Equal' });
    press('[', commandOptions, { altKey: true, code: 'BracketLeft' });
    press(']', commandOptions, { altKey: true, code: 'BracketRight' });

    expect(commandOptions.adjustTextSize).toHaveBeenNthCalledWith(1, -1);
    expect(commandOptions.adjustTextSize).toHaveBeenNthCalledWith(2, 1);
    expect(commandOptions.adjustLineSpacing).toHaveBeenNthCalledWith(1, -1);
    expect(commandOptions.adjustLineSpacing).toHaveBeenNthCalledWith(2, 1);

    const slider = document.createElement('input');
    slider.className = 'text-size-slider';
    document.body.append(slider);
    press('=', commandOptions, { altKey: true, code: 'Equal' }, slider);
    expect(commandOptions.adjustTextSize).toHaveBeenNthCalledWith(3, 1);
    slider.remove();
  });

  it('routes equation navigation, input mode, and typing colors', () => {
    const commandOptions = options({ activeTool: 'equation' });

    press('ArrowRight', commandOptions, {
      altKey: true,
      code: 'ArrowRight',
    });
    expect(commandOptions.moveToEquation).toHaveBeenCalledWith('ArrowRight');

    press('k', commandOptions, { altKey: true, code: 'KeyK' });
    expect(commandOptions.setTypingColor).toHaveBeenCalledWith('#222222');

    press('m', commandOptions, { ctrlKey: true, code: 'KeyM' });
    expect(commandOptions.toggleEquationInputMode).toHaveBeenCalledOnce();
  });

  it('blocks workspace commands for viewers but permits form controls', () => {
    const commandOptions = options({ readOnly: true });
    expect(press('3', commandOptions, { ctrlKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(commandOptions.selectTool).not.toHaveBeenCalled();

    press('c', commandOptions, { ctrlKey: true });
    expect(commandOptions.copySelectedObjects).toHaveBeenCalledOnce();

    const select = document.createElement('select');
    document.body.append(select);
    expect(press('x', commandOptions, {}, select).defaultPrevented).toBe(false);
    select.remove();
  });
});
