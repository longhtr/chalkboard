/**
 * Structural comparison of published board content against the current board.
 * Key order is not content: an element built locally and the same element read
 * back from Yjs carry their properties in different orders, so comparing raw
 * `JSON.stringify` output reports a difference that does not exist — and because
 * the publication effect re-runs on every acknowledgement, that false difference
 * becomes an unbounded publish/acknowledge loop.
 */
import type { BoardElement } from '@chalkboard/shared';

function orderInsensitiveJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(orderInsensitiveJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([first], [second]) =>
      first < second ? -1 : first > second ? 1 : 0,
    );
  return `{${entries
    .map(
      ([key, entry]) => `${JSON.stringify(key)}:${orderInsensitiveJson(entry)}`,
    )
    .join(',')}}`;
}

export function boardContentEqual(
  previous: { elements: BoardElement[]; title: string },
  elements: BoardElement[],
  title: string,
): boolean {
  return (
    previous.title === title &&
    previous.elements.length === elements.length &&
    previous.elements.every((element, index) => {
      const next = elements[index];
      return (
        next !== undefined &&
        element.id === next.id &&
        (element === next ||
          orderInsensitiveJson(element) === orderInsensitiveJson(next))
      );
    })
  );
}
