/** Maps a DOM point in generated MathLive markup to plain-text offset without relying on private hierarchy. */
import type { Point } from '@chalkboard/shared';

import {
  MATHLIVE_LINE_BREAK,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_DOLLAR,
} from './mixedMath';

/** Maps a client point in rendered prose to its nearest canonical text offset. */
export function renderedPlainTextOffset(
  container: HTMLElement,
  source: string,
  point: Point,
): number | null {
  if (
    !/^[\x20-\x7e\n]*$/.test(source) ||
    source.includes('$') ||
    source.includes('\\')
  ) {
    return null;
  }
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestOffset: number | null = null;
  let sourceOffset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    if (node instanceof Text) {
      if (node.data === MATHLIVE_LINE_BREAK) {
        sourceOffset += 1;
      } else if (
        node.data !== MATHLIVE_LITERAL_BACKSLASH &&
        node.data !== MATHLIVE_LITERAL_DOLLAR
      ) {
        const parentBounds = node.parentElement?.getBoundingClientRect();
        if (parentBounds !== undefined) {
          for (let offset = 0; offset <= node.length; offset += 1) {
            const range = document.createRange();
            if (offset < node.length) {
              range.setStart(node, offset);
              range.setEnd(node, offset + 1);
            } else if (offset > 0) {
              range.setStart(node, offset - 1);
              range.setEnd(node, offset);
            } else {
              continue;
            }
            const bounds = range.getBoundingClientRect();
            const x = offset < node.length ? bounds.left : bounds.right;
            const y = parentBounds.y + parentBounds.height / 2;
            if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0)
              continue;
            const distance = Math.abs(x - point.x) + Math.abs(y - point.y) * 2;
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestOffset = sourceOffset + offset;
            }
          }
        }
        sourceOffset += node.length;
      }
    }
    node = walker.nextNode();
  }
  return sourceOffset === source.length ? nearestOffset : null;
}
