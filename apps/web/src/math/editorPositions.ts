/**
 * Pure conversions among source indices, MathLive offsets, logical caret
 * positions, line breaks, and selection ranges. All offsets are clamped before use.
 */
function sortedUniqueOffsets(offsets: readonly number[]): number[] {
  return [...new Set(offsets)]
    .filter((offset) => Number.isInteger(offset) && offset >= 0)
    .sort((left, right) => left - right);
}

/** Convert a MathLive offset into an offset that excludes internal markers. */
export function logicalOffsetFromFieldOffset(
  fieldOffset: number,
  invisibleMarkerOffsets: readonly number[],
): number {
  const normalizedOffset = Math.max(0, Math.trunc(fieldOffset));
  const hiddenBefore = sortedUniqueOffsets(invisibleMarkerOffsets).filter(
    (offset) => offset < normalizedOffset,
  ).length;
  return Math.max(0, normalizedOffset - hiddenBefore);
}

/** Convert a marker-free history offset back into the MathLive atom domain. */
export function fieldOffsetFromLogicalOffset(
  logicalOffset: number,
  invisibleMarkerOffsets: readonly number[],
  lastFieldOffset: number,
): number {
  let fieldOffset = Math.max(0, Math.trunc(logicalOffset));
  for (const markerOffset of sortedUniqueOffsets(invisibleMarkerOffsets)) {
    if (markerOffset > fieldOffset) break;
    fieldOffset += 1;
  }
  return Math.min(fieldOffset, Math.max(0, Math.trunc(lastFieldOffset)));
}

/** Returns the zero-based visual line containing a MathLive field offset. */
export function lineIndexForFieldOffset(
  fieldOffset: number,
  lineBreakOffsets: readonly number[],
): number {
  const line = sortedUniqueOffsets(lineBreakOffsets).findIndex(
    (lineEnd) => fieldOffset <= lineEnd,
  );
  return line < 0 ? sortedUniqueOffsets(lineBreakOffsets).length : line;
}
