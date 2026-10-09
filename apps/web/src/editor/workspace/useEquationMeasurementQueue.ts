/**
 * Batches inactive-equation measurements into one animation-frame reducer
 * action and drops queued entries when the owning workspace unmounts.
 */
import { useCallback, useEffect, useRef, type Dispatch } from 'react';

import type { EditorDocumentAction } from '../model/editorState';

/** Batches inactive equation measurements into one animation-frame reducer update. */
export function useEquationMeasurementQueue(
  dispatch: Dispatch<EditorDocumentAction>,
): (id: string, width: number, height: number) => void {
  const measurementsRef = useRef(
    new Map<string, { height: number; id: string; width: number }>(),
  );
  const frameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      measurementsRef.current.clear();
    },
    [],
  );

  return useCallback(
    (id: string, width: number, height: number) => {
      measurementsRef.current.set(id, { height, id, width });
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const measurements = [...measurementsRef.current.values()];
        measurementsRef.current.clear();
        if (measurements.length > 0) {
          dispatch({ type: 'measure-many', measurements });
        }
      });
    },
    [dispatch],
  );
}
