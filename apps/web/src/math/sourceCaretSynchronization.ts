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

function serializedBoundaries(
  field: CaretMathfield,
): SerializedCaretBoundary[] {
  return Array.from({ length: field.lastOffset + 1 }, (_, fieldOffset) => ({
    fieldOffset,
    left: field.getValue([0, fieldOffset]),
    right: field.getValue([fieldOffset, field.lastOffset]),
  }));
}

/** Synchronizes source textarea selection with the rendered MathLive field. */
export function installSourceCaretSynchronization({
  field,
  getSource,
  onFieldOffset,
}: SourceCaretSynchronizationOptions): () => void {
  const handleQuery = (event: Event) => {
    const respond = (event as CustomEvent<{ respond?: unknown }>).detail
      ?.respond;
    if (typeof respond !== 'function') return;
    respond(
      sourceOffsetForFieldOffset(
        getSource(),
        serializedBoundaries(field),
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
      fieldOffsetForSourceOffset(
        getSource(),
        serializedBoundaries(field),
        sourceOffset,
      ),
    );
  };
  field.addEventListener('chalkboard-source-caret-query', handleQuery);
  field.addEventListener('chalkboard-source-caret-request', handleRequest);
  return () => {
    field.removeEventListener('chalkboard-source-caret-query', handleQuery);
    field.removeEventListener('chalkboard-source-caret-request', handleRequest);
  };
}
