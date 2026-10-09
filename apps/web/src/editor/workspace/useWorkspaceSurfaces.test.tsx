/** Proves board-surface focus restoration, modal Escape handling, and listener teardown. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import { useWorkspaceSurfaces } from './useWorkspaceSurfaces';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('workspace surface visibility', () => {
  it('restores board-menu focus after the last board surface closes', () => {
    const menuButton = document.createElement('button');
    menuButton.setAttribute('aria-label', 'Open board menu');
    document.body.append(menuButton);
    const focus = vi.spyOn(menuButton, 'focus');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const view = renderHook(() => useWorkspaceSurfaces());

    act(() => view.result.current.setObjectNavigatorOpen(true));
    act(() => view.result.current.closeObjectNavigator());

    expect(focus).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it('does not restore menu focus after an automatic surface closes', () => {
    const menuButton = document.createElement('button');
    menuButton.setAttribute('aria-label', 'Open board menu');
    document.body.append(menuButton);
    const focus = vi.spyOn(menuButton, 'focus');
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame');
    const view = renderHook(() => useWorkspaceSurfaces());

    act(() => {
      view.result.current.suppressNextBoardMenuFocusRestoration();
      view.result.current.setObjectNavigatorOpen(true);
    });
    act(() => view.result.current.closeObjectNavigator());

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('closes modal surfaces on Escape and tears down its window listener', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const view = renderHook(() => useWorkspaceSurfaces());
    act(() => {
      view.result.current.setExportOpen(true);
      view.result.current.setLatexCheatsheetOpen(true);
      view.result.current.setShortcutsOpen(true);
    });
    const keydownRegistration = [...addEventListener.mock.calls]
      .reverse()
      .find(([type]) => type === 'keydown');
    expect(keydownRegistration).toBeDefined();

    const escape = new KeyboardEvent('keydown', {
      cancelable: true,
      key: 'Escape',
    });
    act(() => window.dispatchEvent(escape));

    expect(escape.defaultPrevented).toBe(true);
    expect(view.result.current.exportOpen).toBe(false);
    expect(view.result.current.latexCheatsheetOpen).toBe(false);
    expect(view.result.current.shortcutsOpen).toBe(false);

    act(() => view.result.current.setExportOpen(true));
    const activeRegistration = [...addEventListener.mock.calls]
      .reverse()
      .find(([type]) => type === 'keydown');
    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      'keydown',
      requiredTestValue(activeRegistration, 'active keydown registration')[1],
      true,
    );
  });
});
