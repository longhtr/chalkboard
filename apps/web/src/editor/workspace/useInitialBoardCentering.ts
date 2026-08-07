/** Centers the camera once around initial content without overriding later user pan or zoom. */
import { elementBounds, type BoardElement } from '@chalkboard/shared';
import { useEffect, useRef } from 'react';

interface InitialBoardCenteringOptions {
  centerAtVerticalStart(bounds: ReturnType<typeof elementBounds>): void;
  contentReady: boolean;
  elements: BoardElement[];
  viewportReady: boolean;
}

/** Centers loaded content once per board after storage and viewport become ready. */
export function useInitialBoardCentering({
  centerAtVerticalStart,
  contentReady,
  elements,
  viewportReady,
}: InitialBoardCenteringOptions): void {
  const centeredRef = useRef(false);

  useEffect(() => {
    if (centeredRef.current || !viewportReady || !contentReady) return;
    centeredRef.current = true;
    const highest = elements.reduce<BoardElement | undefined>(
      (candidate, element) => {
        if (candidate === undefined) return element;
        const candidateBounds = elementBounds(candidate);
        const bounds = elementBounds(element);
        return bounds.y < candidateBounds.y ||
          (bounds.y === candidateBounds.y && bounds.x < candidateBounds.x)
          ? element
          : candidate;
      },
      undefined,
    );
    if (highest !== undefined) {
      centerAtVerticalStart(elementBounds(highest));
    }
  }, [centerAtVerticalStart, contentReady, elements, viewportReady]);
}
