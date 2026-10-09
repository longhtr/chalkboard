/**
 * Maintains an editable title projection. Local titles debounce into IndexedDB;
 * cloud titles are reconciled by their separate authorized REST lifecycle.
 */
import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { normalizedBoardTitle } from '../model/boardTitle';

interface BoardTitleState {
  key: string;
  projection: string;
  title: string;
}

function activeTitleState(
  state: BoardTitleState,
  key: string,
  projectedTitle: string,
): BoardTitleState {
  const projection = normalizedBoardTitle(projectedTitle);
  if (state.key !== key) return { key, projection, title: projection };
  const hasNewProjection = projection !== state.projection;
  const hasNewerAuthority = state.title !== state.projection;
  return hasNewProjection && !hasNewerAuthority
    ? { key, projection, title: projection }
    : state;
}

/** Reconciles external title changes without overwriting a newer local edit. */
export function useBoardTitle(
  key: string,
  projectedTitle: string,
): {
  acceptProjection(title: string): void;
  setTitle: Dispatch<SetStateAction<string>>;
  title: string;
} {
  const normalizedProjection = normalizedBoardTitle(projectedTitle);
  const [state, setState] = useState<BoardTitleState>(() => ({
    key,
    projection: normalizedProjection,
    title: normalizedProjection,
  }));
  const active = activeTitleState(state, key, normalizedProjection);

  const setTitle = useCallback<Dispatch<SetStateAction<string>>>(
    (nextTitle) => {
      setState((current) => {
        const currentActive = activeTitleState(
          current,
          key,
          normalizedProjection,
        );
        return {
          ...currentActive,
          title:
            typeof nextTitle === 'function'
              ? nextTitle(currentActive.title)
              : nextTitle,
        };
      });
    },
    [key, normalizedProjection],
  );

  const acceptProjection = useCallback(
    (acceptedTitle: string) => {
      const accepted = normalizedBoardTitle(acceptedTitle);
      setState((current) => {
        const currentActive = activeTitleState(
          current,
          key,
          normalizedProjection,
        );
        return {
          key,
          projection: accepted,
          title:
            normalizedBoardTitle(currentActive.title) === accepted
              ? accepted
              : currentActive.title,
        };
      });
    },
    [key, normalizedProjection],
  );

  return { acceptProjection, setTitle, title: active.title };
}
