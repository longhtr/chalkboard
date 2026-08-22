/**
 * Exercises equation session creation, publication, persistence, recovery,
 * commit/cancel, external replacement, selection, and unmount ordering.
 */
import {
  DEFAULT_ELEMENT_STYLE,
  type EquationElement,
} from '@chalkboard/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import {
  reconcileActiveEquationWithRemote,
  useEquationLifecycle,
  useEquationState,
} from './useEquationEditing';

const equation: EquationElement = {
  ...DEFAULT_ELEMENT_STYLE,
  createdBy: 'local',
  fontSize: 28,
  height: 40,
  id: 'equation-1',
  lineSpacing: 1.2,
  rotation: 0,
  source: '$x$',
  type: 'equation',
  width: 80,
  x: 10,
  y: 20,
};

function renderEquationEditing() {
  const commitElements = vi.fn(() => true);
  const persistBoard = vi.fn();
  const setRecentlyCreatedId = vi.fn();
  const setSelectedIds = vi.fn();
  const view = renderHook(() => {
    const state = useEquationState();
    const lifecycle = useEquationLifecycle({
      caretStorageKey: 'test-board',
      cloud: false,
      commitElements,
      editingEquation: state.editingEquation,
      editingView: state.editingView,
      elements: [],
      pendingLocalBoardId: null,
      persistBoard,
      rejectBoardElementLimit: vi.fn(),
      replaceElements: vi.fn(),
      setEditingEquation: state.setEditingEquation,
      setEquationCaretPoint: state.setEquationCaretPoint,
      setEquationCaretPosition: state.setEquationCaretPosition,
      setReadyEquationSession: state.setReadyEquationSession,
      setRecentlyCreatedId,
      setSelectedIds,
    });
    return { ...state, ...lifecycle };
  });
  return {
    commitElements,
    persistBoard,
    setRecentlyCreatedId,
    setSelectedIds,
    view,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workspace equation editing lifecycle', () => {
  it('rebases a local draft over remote collaboration without losing either edit', () => {
    const current = {
      draft: equation,
      height: 44,
      id: equation.id,
      initialSource: 'Shared $ x $',
      isNew: false,
      sessionId: 'session',
      source: 'Shared $ x $B',
      width: 96,
    };
    const remote = {
      ...equation,
      height: 42,
      source: 'Shared $ xq $',
      width: 90,
    };

    const merged = reconcileActiveEquationWithRemote(current, remote);
    expect(merged).toMatchObject({
      collaborationBaseSource: remote.source,
      height: 44,
      initialSource: current.initialSource,
      source: 'Shared $ xq $B',
      width: 96,
    });

    const secondMerge = reconcileActiveEquationWithRemote(merged, {
      ...remote,
      source: 'Shared $ xqr $',
    });
    expect(secondMerge).toMatchObject({
      collaborationBaseSource: 'Shared $ xqr $',
      initialSource: current.initialSource,
      source: 'Shared $ xqr $B',
    });

    expect(
      reconcileActiveEquationWithRemote(secondMerge, {
        ...remote,
        height: 45,
        source: secondMerge.source,
        width: 100,
      }),
    ).toMatchObject({
      collaborationBaseSource: secondMerge.source,
      height: 45,
      initialSource: current.initialSource,
      source: secondMerge.source,
      width: 100,
    });

    expect(
      reconcileActiveEquationWithRemote(merged, {
        ...remote,
        source: 'Shared $ x $B',
      }),
    ).toMatchObject({
      collaborationBaseSource: 'Shared $ x $B',
      initialSource: current.initialSource,
      source: 'Shared $ x $B',
    });
  });

  it('accepts a remote value unchanged when the active draft has no local edit', () => {
    const current = {
      draft: equation,
      height: equation.height,
      id: equation.id,
      initialSource: equation.source,
      isNew: false,
      sessionId: 'session',
      source: equation.source,
      width: equation.width,
    };
    const remote = { ...equation, source: '$x+q$' };

    expect(reconcileActiveEquationWithRemote(current, remote)).toMatchObject({
      collaborationBaseSource: remote.source,
      initialSource: current.initialSource,
      source: remote.source,
    });
  });

  it('rejects stale completion and commits only the active session', () => {
    const { commitElements, setRecentlyCreatedId, view } =
      renderEquationEditing();
    act(() => view.result.current.beginEquationEdit(equation, { isNew: true }));
    const sessionId = requiredTestValue(
      view.result.current.editingEquation?.sessionId,
      'active equation session identifier',
    );

    act(() => view.result.current.commitEquationEdit('stale', '$y$', 90, 45));
    expect(commitElements).not.toHaveBeenCalled();
    expect(view.result.current.editingEquation).not.toBeNull();

    act(() => view.result.current.commitEquationEdit(sessionId, '$y$', 90, 45));
    expect(commitElements).toHaveBeenCalledTimes(1);
    expect(setRecentlyCreatedId).toHaveBeenCalledWith(equation.id);
    expect(view.result.current.editingEquation).toBeNull();
  });

  it('cancels pending editor-focus work on teardown', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(17);
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const { view } = renderEquationEditing();
    act(() => view.result.current.beginEquationEdit(equation));

    act(() => view.result.current.focusActiveEquationEditor());
    view.unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });
});
