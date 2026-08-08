/**
 * Owns one active equation session from creation/selection through draft,
 * measurement, crash recovery, commit, cancellation, and external replacement.
 */
import {
  isEquationElement,
  type BoardElement,
  type EquationElement,
  type Point,
} from '@chalkboard/shared';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { bestEffortLocalStorage } from '../../bestEffortStorage';
import { mergeEquationSourceEdit } from '../../math/mergeEquationSourceEdit';
import { isEmptyMixedSource } from '../../math/mixedMath';
import { boardElementChangeFits } from '../model/limits';
import {
  applyEquationEdit,
  type EditingEquation,
} from '../equation/equationEditing';
import { focusEquationEditorAfterControl } from '../equation/equationFontSize';
import {
  finishPendingEquationDraft,
  stagePendingEquationDraft,
} from '../equation/equationRecovery';
import {
  useEquationEditingView,
  type EquationEditingView,
} from '../equation/useEquationEditingView';
import { caretPositionsKey, loadCaretPositions } from '../local/browserState';
import { loadInputMode } from './preferences';

/** Owns the active equation draft and synchronous ref used by event handlers. */
export function useEquationState() {
  const [editingEquation, setEditingEquation] =
    useState<EditingEquation | null>(null);
  const [equationCaretPoint, setEquationCaretPoint] = useState<Point | null>(
    null,
  );
  const [equationCaretPosition, setEquationCaretPosition] = useState<
    number | null
  >(null);
  const [readyEquationSession, setReadyEquationSession] = useState<
    string | null
  >(null);
  const [inputMode, setInputMode] = useState<'math' | 'text'>(loadInputMode);
  const [modeToggleToken, setModeToggleToken] = useState(0);
  const [editingView, setEditingView] = useEquationEditingView();
  const [textStyle, setTextStyle] = useState({ bold: false, italic: false });

  const changeTextStyle = useCallback(
    (style: { bold: boolean; italic: boolean }) => {
      setTextStyle((current) =>
        current.bold === style.bold && current.italic === style.italic
          ? current
          : style,
      );
    },
    [],
  );
  const changeEquationInputMode = useCallback((mode: 'math' | 'text') => {
    setInputMode(mode);
  }, []);
  const selectEquationInputMode = useCallback(
    (mode: 'math' | 'text') => {
      if (mode === inputMode) return;
      if (editingEquation === null) {
        setInputMode(mode);
      } else {
        setModeToggleToken((current) => current + 1);
      }
    },
    [editingEquation, inputMode],
  );
  const requestTextStyle = useCallback(
    (
      request:
        { style: 'regular' } | { enabled: boolean; style: 'bold' | 'italic' },
    ) => {
      setTextStyle((current) =>
        request.style === 'regular'
          ? { bold: false, italic: false }
          : { ...current, [request.style]: request.enabled },
      );
      document.querySelector('math-field')?.dispatchEvent(
        new CustomEvent('chalkboard-text-style-request', {
          detail: {
            enabled: request.style === 'regular' ? true : request.enabled,
            style: request.style,
          },
        }),
      );
    },
    [],
  );
  const toggleTextStyle = useCallback(
    (style: 'bold' | 'italic') => {
      requestTextStyle({ enabled: !textStyle[style], style });
    },
    [requestTextStyle, textStyle],
  );

  return {
    changeEquationInputMode,
    changeTextStyle,
    editingEquation,
    editingView,
    equationCaretPoint,
    equationCaretPosition,
    inputMode,
    modeToggleToken,
    readyEquationSession,
    requestTextStyle,
    selectEquationInputMode,
    setEditingEquation,
    setEditingView,
    setEquationCaretPoint,
    setEquationCaretPosition,
    setInputMode,
    setModeToggleToken,
    setReadyEquationSession,
    textStyle,
    toggleTextStyle,
  };
}

/** Initial caret and new/existing identity for opening an equation session. */
export interface EquationEditStartOptions {
  caretPoint?: Point | null;
  caretPosition?: number | null;
  isNew?: boolean;
}

interface EquationLifecycleOptions {
  caretStorageKey: string;
  cloud: boolean;
  commitElements(elements: BoardElement[]): boolean;
  editingEquation: EditingEquation | null;
  editingView: EquationEditingView;
  elements: BoardElement[];
  pendingLocalBoardId: string | null;
  persistBoard(elements: BoardElement[]): void;
  rejectBoardElementLimit(): void;
  replaceElements(elements: BoardElement[]): void;
  setEditingEquation: Dispatch<SetStateAction<EditingEquation | null>>;
  setEquationCaretPoint: Dispatch<SetStateAction<Point | null>>;
  setEquationCaretPosition: Dispatch<SetStateAction<number | null>>;
  setReadyEquationSession: Dispatch<SetStateAction<string | null>>;
  setRecentlyCreatedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}

/** Coordinates equation begin/change/persist/commit/cancel across board state. */
export function useEquationLifecycle({
  caretStorageKey,
  cloud,
  commitElements,
  editingEquation,
  editingView,
  elements,
  pendingLocalBoardId,
  persistBoard,
  rejectBoardElementLimit,
  replaceElements,
  setEditingEquation,
  setEquationCaretPoint,
  setEquationCaretPosition,
  setReadyEquationSession,
  setRecentlyCreatedId,
  setSelectedIds,
}: EquationLifecycleOptions) {
  const editingSessionRef = useRef<string | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const lastEditorSourceRef = useRef<{
    sessionId: string;
    source: string;
  } | null>(null);
  const caretPositionsRef = useRef(loadCaretPositions(caretStorageKey));

  const beginEquationEdit = useCallback(
    (element: EquationElement, options: EquationEditStartOptions = {}) => {
      const {
        caretPoint = null,
        caretPosition = null,
        isNew = false,
      } = options;
      const sessionId = crypto.randomUUID();
      setRecentlyCreatedId(null);
      setEquationCaretPoint(caretPoint);
      setEquationCaretPosition(caretPosition);
      setReadyEquationSession(null);
      editingSessionRef.current = sessionId;
      lastEditorSourceRef.current = { sessionId, source: element.source };
      setEditingEquation({
        draft: element,
        height: element.height,
        id: element.id,
        initialSource: element.source,
        isNew,
        sessionId,
        source: element.source,
        width: element.width,
      });
      return true;
    },
    [
      setEditingEquation,
      setEquationCaretPoint,
      setEquationCaretPosition,
      setReadyEquationSession,
      setRecentlyCreatedId,
    ],
  );

  const rememberEquationCaret = useCallback(
    (id: string, position: number) => {
      caretPositionsRef.current.set(id, position);
      bestEffortLocalStorage.setItem(
        caretPositionsKey(caretStorageKey),
        JSON.stringify(Object.fromEntries(caretPositionsRef.current)),
      );
    },
    [caretStorageKey],
  );

  const changeEquationSource = useCallback(
    (sessionId: string, source: string, width: number, height: number) => {
      if (editingEquation === null || editingEquation.sessionId !== sessionId) {
        return;
      }
      const previousEditorSource = lastEditorSourceRef.current;
      lastEditorSourceRef.current = { sessionId, source };
      if (
        previousEditorSource?.sessionId === sessionId &&
        previousEditorSource.source === source
      ) {
        stagePendingEquationDraft(pendingLocalBoardId, editingEquation, {
          height,
          source,
          width,
        });
        setEditingEquation((current) =>
          current === null || current.sessionId !== sessionId
            ? current
            : { ...current, height, width },
        );
        return;
      }
      let nextSource = source;
      if (cloud) {
        const currentElement = elements.find(
          (element): element is EquationElement =>
            element.id === editingEquation.id && isEquationElement(element),
        );
        if (currentElement !== undefined) {
          nextSource = mergeEquationSourceEdit(
            editingEquation.source,
            source,
            currentElement.source,
          );
        }
        // A block that is not on the board yet has to be inserted rather than
        // updated, whether it is newly created or was emptied and retyped.
        // Deriving that from the board — not from the session flag — keeps a
        // second insertion from duplicating the element on every keystroke.
        const changedElements = applyEquationEdit(
          elements,
          { ...editingEquation, isNew: currentElement === undefined },
          { height, source: nextSource, width },
        );
        if (changedElements !== elements) replaceElements(changedElements);
      }
      stagePendingEquationDraft(pendingLocalBoardId, editingEquation, {
        height,
        source: nextSource,
        width,
      });
      setEditingEquation((current) =>
        current === null || current.sessionId !== sessionId
          ? current
          : { ...current, height, source: nextSource, width },
      );
    },
    [
      cloud,
      editingEquation,
      elements,
      pendingLocalBoardId,
      replaceElements,
      setEditingEquation,
    ],
  );

  const commitEquationEdit = useCallback(
    (sessionId: string, source: string, width: number, height: number) => {
      if (
        editingEquation === null ||
        editingEquation.sessionId !== sessionId ||
        editingSessionRef.current !== sessionId
      ) {
        return;
      }
      // Editing may already have placed the block on the board, in which case
      // committing must update it rather than add a second copy.
      const changedElements = applyEquationEdit(
        elements,
        {
          ...editingEquation,
          isNew: !elements.some(({ id }) => id === editingEquation.id),
        },
        { height, source, width },
      );
      const changed = changedElements !== elements;
      const committed = !changed || commitElements(changedElements);
      finishPendingEquationDraft(
        pendingLocalBoardId,
        changed && committed ? changedElements : null,
        persistBoard,
      );
      if (isEmptyMixedSource(source)) {
        setSelectedIds((selected) =>
          selected.filter((id) => id !== editingEquation.id),
        );
      } else if (editingEquation.isNew && committed) {
        setRecentlyCreatedId(editingEquation.id);
      }
      editingSessionRef.current = null;
      lastEditorSourceRef.current = null;
      setReadyEquationSession(null);
      setEditingEquation(null);
    },
    [
      commitElements,
      editingEquation,
      elements,
      pendingLocalBoardId,
      persistBoard,
      setEditingEquation,
      setReadyEquationSession,
      setRecentlyCreatedId,
      setSelectedIds,
    ],
  );

  const persistEquationEdit = useCallback(
    (sessionId: string, source: string, width: number, height: number) => {
      if (
        editingEquation === null ||
        editingEquation.sessionId !== sessionId ||
        editingSessionRef.current !== sessionId
      ) {
        return;
      }
      const changedElements = applyEquationEdit(elements, editingEquation, {
        height,
        source,
        width,
      });
      if (boardElementChangeFits(elements.length, changedElements.length)) {
        persistBoard(changedElements);
      } else {
        rejectBoardElementLimit();
      }
    },
    [editingEquation, elements, persistBoard, rejectBoardElementLimit],
  );

  const caretPositionForEquation = useCallback(
    (id: string) => caretPositionsRef.current.get(id) ?? null,
    [],
  );
  const focusActiveEquationEditor = useCallback(() => {
    if (editingEquation === null) return;
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current);
    }
    focusFrameRef.current = focusEquationEditorAfterControl(
      editingSessionRef,
      editingEquation.sessionId,
      editingView,
    );
  }, [editingEquation, editingView]);

  useEffect(
    () => () => {
      editingSessionRef.current = null;
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current);
      }
    },
    [],
  );

  return {
    beginEquationEdit,
    caretPositionForEquation,
    changeEquationSource,
    commitEquationEdit,
    focusActiveEquationEditor,
    persistEquationEdit,
    rememberEquationCaret,
  };
}
