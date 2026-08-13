/**
 * Copies selected board records into bounded browser state and pastes independent
 * identities near the current viewport while preserving relative geometry.
 */
import type { BoardElement } from '@chalkboard/shared';
import {
  useCallback,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

import { bestEffortLocalStorage } from '../../bestEffortStorage';
import { copyTextToClipboard } from '../../clipboard';
import {
  OBJECT_CLIPBOARD_LIMIT_MESSAGE,
  boardElementAdditionFits,
} from '../model/limits';
import type { Tool } from '../interaction/toolModel';
import {
  LOCAL_OBJECT_CLIPBOARD_KEY,
  parseObjectClipboard,
  serializeObjectClipboard,
} from '../local/browserState';

interface ObjectClipboardOptions {
  activeToolRef: RefObject<Tool>;
  commitElements(elements: BoardElement[]): boolean;
  elements: BoardElement[];
  rejectBoardElementLimit(): void;
  reportOperationLimit(message: string): void;
  selectedIdSet: ReadonlySet<string>;
  setActiveTool: Dispatch<SetStateAction<Tool>>;
  setRecentlyCreatedId: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}

/** Copies and pastes bounded internal element snapshots with fresh identities. */
export function useObjectClipboard({
  activeToolRef,
  commitElements,
  elements,
  rejectBoardElementLimit,
  reportOperationLimit,
  selectedIdSet,
  setActiveTool,
  setRecentlyCreatedId,
  setSelectedIds,
}: ObjectClipboardOptions): {
  copySelectedObjects(): Promise<boolean>;
  pasteCopiedObjects(clipboardText?: string): Promise<boolean>;
} {
  const clipboardRef = useRef<{
    elements: BoardElement[];
    pasteCount: number;
  } | null>(null);

  const copySelectedObjects = useCallback(async () => {
    const selected = elements
      .filter(({ id }) => selectedIdSet.has(id))
      .map((element) => ({ ...element }));
    if (selected.length === 0) return false;
    const serialized = serializeObjectClipboard(selected);
    if (serialized === null) {
      reportOperationLimit(OBJECT_CLIPBOARD_LIMIT_MESSAGE);
      return false;
    }
    clipboardRef.current = { elements: selected, pasteCount: 0 };
    bestEffortLocalStorage.setItem(LOCAL_OBJECT_CLIPBOARD_KEY, serialized);
    try {
      await copyTextToClipboard(serialized);
    } catch {
      // Keep the local clipboard as a permission-free fallback.
    }
    return true;
  }, [elements, reportOperationLimit, selectedIdSet]);

  const pasteCopiedObjects = useCallback(
    async (clipboardText?: string) => {
      let clipboard = clipboardRef.current;
      const pastedElements = parseObjectClipboard(clipboardText ?? null);
      if (clipboardText !== undefined) {
        if (pastedElements === null) return false;
        if (
          clipboard === null ||
          JSON.stringify(clipboard.elements) !== JSON.stringify(pastedElements)
        ) {
          clipboard = { elements: pastedElements, pasteCount: 0 };
          clipboardRef.current = clipboard;
        }
      }
      const savedElements = parseObjectClipboard(
        bestEffortLocalStorage.getItem(LOCAL_OBJECT_CLIPBOARD_KEY),
      );
      if (clipboard === null && savedElements !== null) {
        clipboard = { elements: savedElements, pasteCount: 0 };
        clipboardRef.current = clipboard;
      }
      if (clipboard === null || clipboard.elements.length === 0) return false;
      if (
        !boardElementAdditionFits(elements.length, clipboard.elements.length)
      ) {
        rejectBoardElementLimit();
        return false;
      }
      const pasteCount = clipboard.pasteCount + 1;
      clipboardRef.current = { ...clipboard, pasteCount };
      const offset = pasteCount * 20;
      const pasted = clipboard.elements.map((element) => ({
        ...element,
        createdBy: 'local',
        id: crypto.randomUUID(),
        x: element.x + offset,
        y: element.y + offset,
      }));
      if (!commitElements([...elements, ...pasted])) return false;
      setRecentlyCreatedId(null);
      setSelectedIds(pasted.map(({ id }) => id));
      activeToolRef.current = 'selection';
      setActiveTool('selection');
      return true;
    },
    [
      activeToolRef,
      commitElements,
      elements,
      rejectBoardElementLimit,
      setActiveTool,
      setRecentlyCreatedId,
      setSelectedIds,
    ],
  );

  return { copySelectedObjects, pasteCopiedObjects };
}
