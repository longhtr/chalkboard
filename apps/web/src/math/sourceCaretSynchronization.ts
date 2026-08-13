/**
 * Synchronizes source-view selection with rendered MathLive caret-point requests
 * while guarding against feedback loops and stale animation frames.
 */
import {
  fieldOffsetForSourceOffset,
  sourceOffsetForFieldOffset,
  type SerializedCaretBoundary,
} from './sourceCaretMapping';

interface CaretMathfield extends HTMLElement {
  lastOffset: number;
  position: number;
  getValue(range: [number, number]): string;
}

interface SourceCaretSynchronizationOptions {
  field: CaretMathfield;
  getSource(): string;
  onFieldOffset(fieldOffset: number): void;
}

/**
 * Every field offset paired with the source on each side of it.
 *
 * Each entry serializes a prefix and a suffix of the document, so building the
 * table costs on the order of one full serialization per offset: a block of a
 * thousand characters serializes a million of them. The table depends only on
 * the document, while a caret query and a caret request arrive separately and
 * repeat for every click and keystroke made in source view, so it is built once
 * per document instead of once per event.
 */
function boundaryTable(field: CaretMathfield): {
  invalidate(): void;
  read(): SerializedCaretBoundary[];
} {
  let cached: {
    boundaries: SerializedCaretBoundary[];
    lastOffset: number;
  } | null = null;
  return {
    invalidate() {
      cached = null;
    },
    read() {
      const lastOffset = field.lastOffset;
      if (cached !== null && cached.lastOffset === lastOffset) {
        return cached.boundaries;
      }
      const boundaries = Array.from(
        { length: lastOffset + 1 },
        (_entry, fieldOffset) => ({
          fieldOffset,
          left: field.getValue([0, fieldOffset]),
          right: field.getValue([fieldOffset, lastOffset]),
        }),
      );
      cached = { boundaries, lastOffset };
      return boundaries;
    },
  };
}

/** Synchronizes source textarea selection with the rendered MathLive field. */
export function installSourceCaretSynchronization({
  field,
  getSource,
  onFieldOffset,
}: SourceCaretSynchronizationOptions): () => void {
  const boundaries = boundaryTable(field);
  const handleInput = () => boundaries.invalidate();
  const handleQuery = (event: Event) => {
    const respond = (event as CustomEvent<{ respond?: unknown }>).detail
      ?.respond;
    if (typeof respond !== 'function') return;
    respond(
      sourceOffsetForFieldOffset(
        getSource(),
        boundaries.read(),
        field.position,
      ),
    );
  };
  const handleRequest = (event: Event) => {
    const sourceOffset = (event as CustomEvent<{ sourceOffset?: unknown }>)
      .detail?.sourceOffset;
    if (typeof sourceOffset !== 'number' || !Number.isInteger(sourceOffset)) {
      return;
    }
    onFieldOffset(
      fieldOffsetForSourceOffset(getSource(), boundaries.read(), sourceOffset),
    );
  };
  field.addEventListener('input', handleInput);
  field.addEventListener('chalkboard-source-caret-query', handleQuery);
  field.addEventListener('chalkboard-source-caret-request', handleRequest);
  return () => {
    field.removeEventListener('input', handleInput);
    field.removeEventListener('chalkboard-source-caret-query', handleQuery);
    field.removeEventListener('chalkboard-source-caret-request', handleRequest);
  };
}
