/** Builds the transient equation element shown while MathLive owns the active draft. */
import { useEffect, useState } from 'react';

import { bestEffortLocalStorage } from '../../bestEffortStorage';

/** Active visual editor: rendered MathLive field or canonical source textarea. */
export type EquationEditingView = 'rendered' | 'source';

const LOCAL_EDITING_VIEW_KEY = 'chalkboard:equation-editing-view';
const LEGACY_DISPLAY_MODE_KEY = 'chalkboard:equation-display-mode';

/** Owns rendered/source view switching and its monotonic focus handoff token. */
export function useEquationEditingView() {
  const [editingView, setEditingView] = useState<EquationEditingView>(() => {
    const stored =
      bestEffortLocalStorage.getItem(LOCAL_EDITING_VIEW_KEY) ??
      bestEffortLocalStorage.getItem(LEGACY_DISPLAY_MODE_KEY);
    return stored === 'source' ? 'source' : 'rendered';
  });

  useEffect(() => {
    bestEffortLocalStorage.setItem(LOCAL_EDITING_VIEW_KEY, editingView);
    bestEffortLocalStorage.removeItem(LEGACY_DISPLAY_MODE_KEY);
  }, [editingView]);

  return [editingView, setEditingView] as const;
}
