/**
 * Coordinates MathLive selection, source/history positions, and rendered pointer
 * geometry for one field. DOM-specific lookup is isolated behind injected helpers.
 */
import type { Point } from '@chalkboard/shared';
import type { MathfieldElement } from 'mathlive';

import {
  fieldOffsetFromLogicalOffset,
  lineIndexForFieldOffset,
  logicalOffsetFromFieldOffset,
} from './editorPositions';
import {
  isTextColorMarker,
  isTextStyleMarker,
  MATHLIVE_LINE_BREAK,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_DOLLAR,
} from './mixedMath';
import { renderedPlainTextOffset } from './renderedPlainTextOffset';

/** Row width below which the hit-test probe cannot separate its two samples. */
const HIT_TEST_PROBE_WIDTH = 40;

interface OffsetBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/**
 * How much taller than the shortest box on a row a box may be before it is
 * treated as structural rather than as a position on that row. A line-break
 * marker's box spans every row of the block, several times any row's height,
 * while ordinary math on a row stays within a fraction of it.
 */
const STRUCTURAL_HEIGHT_RATIO = 2;

interface EditorSelectionControllerOptions {
  documentTarget?: Document;
  elementId: string;
  field: MathfieldElement;
  getSource: () => string;
  selectionOverlay: HTMLElement;
}

/** Maps MathLive field offsets, logical source offsets, lines, and client points. */
export class EditorSelectionController {
  readonly #document: Document;
  readonly #elementId: string;
  readonly #field: MathfieldElement;
  readonly #getSource: () => string;
  readonly #selectionOverlay: HTMLElement;
  #pointerGeometry: (OffsetBounds | undefined)[] | null = null;
  #hitTestHorizontal: boolean | null = null;
  #sentinelCache: {
    lastOffset: number;
    lineBreaks: number[];
    markers: number[];
  } | null = null;
  #sentinelCacheExpiring = false;

  constructor({
    documentTarget = document,
    elementId,
    field,
    getSource,
    selectionOverlay,
  }: EditorSelectionControllerOptions) {
    this.#document = documentTarget;
    this.#elementId = elementId;
    this.#field = field;
    this.#getSource = getSource;
    this.#selectionOverlay = selectionOverlay;
    field.addEventListener('input', this.#onFieldInput);
  }

  readonly #onFieldInput = (): void => {
    this.#sentinelCache = null;
  };

  /** Releases the field listener this controller added. */
  dispose(): void {
    this.#field.removeEventListener('input', this.#onFieldInput);
    this.#sentinelCache = null;
  }

  /**
   * Both sentinel offset lists, scanned once per document rather than per read.
   *
   * `getValue([offset, offset + 1])` walks the atom tree to find the range
   * before serializing it, so asking it about every offset is quadratic in
   * block length, and `lastOffset` walks the tree too, so re-reading it as the
   * loop bound doubled that. Converting one caret position asks for these lists
   * once and a single view switch converted 43 positions, which is where a
   * large block's switch delay came from.
   *
   * Both lists hold offsets of sentinel *characters*, so they can only change
   * when the document gains or loses atoms. `lastOffset` therefore identifies
   * them, an `input` event drops them for anything that rewrites atoms without
   * changing how many there are, and the cache never outlives the task that
   * filled it, so no mutation can be observed through a stale scan.
   */
  #sentinelOffsets(): { lineBreaks: number[]; markers: number[] } {
    const lastOffset = this.#field.lastOffset;
    const cached = this.#sentinelCache;
    if (cached !== null && cached.lastOffset === lastOffset) return cached;
    const lineBreaks: number[] = [];
    const markers: number[] = [];
    for (let offset = 0; offset < lastOffset; offset += 1) {
      const atom = this.#field.getValue([offset, offset + 1]);
      if (atom === MATHLIVE_LINE_BREAK) {
        lineBreaks.push(offset);
      } else if (isTextColorMarker(atom) || isTextStyleMarker(atom)) {
        markers.push(offset);
      }
    }
    this.#sentinelCache = { lastOffset, lineBreaks, markers };
    if (!this.#sentinelCacheExpiring) {
      this.#sentinelCacheExpiring = true;
      queueMicrotask(() => {
        this.#sentinelCache = null;
        this.#sentinelCacheExpiring = false;
      });
    }
    return this.#sentinelCache;
  }

  /** Drops the sentinel scan after the document is replaced or edited. */
  invalidateDocument(): void {
    this.#sentinelCache = null;
  }

  lineBreakOffsets(): number[] {
    return this.#sentinelOffsets().lineBreaks;
  }

  invisibleFormattingMarkerOffsets(): number[] {
    return this.#sentinelOffsets().markers;
  }

  logicalPositionFromField(position: number): number {
    return logicalOffsetFromFieldOffset(
      position,
      this.invisibleFormattingMarkerOffsets(),
    );
  }

  historyPosition(): number {
    return this.logicalPositionFromField(this.#field.position);
  }

  fieldPositionFromHistory(position: number): number {
    return fieldOffsetFromLogicalOffset(
      position,
      this.invisibleFormattingMarkerOffsets(),
      this.#field.lastOffset,
    );
  }

  constrainPositionToClickedLine(caretPoint: Point | null): void {
    if (caretPoint === null) return;
    const markers = [
      ...(this.#field.shadowRoot?.querySelectorAll('.mixed-text-line-break') ??
        []),
    ];
    const markerOffsets = this.lineBreakOffsets();
    markers.forEach((marker, index) => {
      const offset = markerOffsets[index];
      if (offset === undefined) return;
      const markerY = marker.getBoundingClientRect().y;
      if (caretPoint.y < markerY && this.#field.position > offset) {
        this.#field.position = offset;
      } else if (caretPoint.y > markerY && this.#field.position <= offset) {
        this.#field.position = offset + 1;
      }
    });
  }

  /**
   * The rect MathLive reports for an offset belongs to the element *preceding*
   * it - the one backspace would remove - so that offset's caret sits at the
   * rect's right edge.
   */
  #boundsForOffset(offset: number): OffsetBounds | undefined {
    if (this.#pointerGeometry !== null) return this.#pointerGeometry[offset];
    const bounds = this.#field.getElementInfo(offset)?.bounds;
    return bounds === undefined
      ? undefined
      : {
          bottom: bounds.bottom,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
        };
  }

  /**
   * Freezes offset geometry for the duration of a pointer drag.
   *
   * MathLive re-renders the atoms covered by a selection, and it reports those
   * rebuilt elements at single-row coordinates rather than the wrapped ones on
   * screen. Measuring live during a drag therefore reads valid rects for the
   * unselected tail and displaced ones for everything already selected, which
   * walks the far end of the selection off by a character per move. The
   * document cannot change mid-drag, so one snapshot taken while the selection
   * is still collapsed stays correct and skips the repeated measuring.
   */
  beginPointerGeometry(): void {
    const geometry: (OffsetBounds | undefined)[] = [];
    for (let offset = 0; offset <= this.#field.lastOffset; offset += 1) {
      const bounds = this.#field.getElementInfo(offset)?.bounds;
      geometry[offset] =
        bounds === undefined
          ? undefined
          : {
              bottom: bounds.bottom,
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
            };
    }
    this.#pointerGeometry = geometry;
  }

  endPointerGeometry(): void {
    this.#pointerGeometry = null;
  }

  /**
   * Nearest caret offset in an inclusive range, measured from the field's own
   * geometry. Vertical distance is weighted so stacked constructs - a
   * fraction's two rows share a horizontal span, and a line-break marker
   * carries a full-width box belonging to another row - resolve to the row
   * that was actually clicked.
   *
   */
  #scanRange(point: Point, start: number, end: number): number | null {
    const measured: { bounds: OffsetBounds; offset: number }[] = [];
    let rowHeight = Number.POSITIVE_INFINITY;
    for (let offset = start; offset <= end; offset += 1) {
      const bounds = this.#boundsForOffset(offset);
      if (bounds === undefined || !Number.isFinite(bounds.right)) continue;
      measured.push({ bounds, offset });
      rowHeight = Math.min(rowHeight, bounds.bottom - bounds.top);
    }
    if (measured.length === 0) return null;

    // The rect for a row's first offset belongs to the line-break marker that
    // precedes it, whose box spans the whole block and reaches the widest row's
    // right edge. Left in, it wins any click near a row's right edge and drops
    // the caret at the start of the row instead.
    const onRow = measured.filter(
      ({ bounds }) =>
        bounds.bottom - bounds.top <= rowHeight * STRUCTURAL_HEIGHT_RATIO,
    );
    if (onRow.length === 0) return measured[0]?.offset ?? null;

    const rowLeft = Math.min(...onRow.map(({ bounds }) => bounds.left));
    let nearestOffset: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const { bounds, offset } of measured) {
      const structural =
        bounds.bottom - bounds.top > rowHeight * STRUCTURAL_HEIGHT_RATIO;
      // A row's first offset still holds the caret at the row's left edge; only
      // the marker's own geometry is unusable.
      if (structural && offset !== start) continue;
      const caretX = structural ? rowLeft : bounds.right;
      const band = structural ? (onRow[0]?.bounds ?? bounds) : bounds;
      const verticalGap =
        point.y < band.top
          ? band.top - point.y
          : point.y > band.bottom
            ? point.y - band.bottom
            : 0;
      const distance = Math.abs(caretX - point.x) + verticalGap * 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestOffset = offset;
      }
    }
    return nearestOffset;
  }

  /**
   * Whether MathLive's hit-test actually reads the horizontal coordinate.
   *
   * On Gecko it does not: `getOffsetFromPoint` answers one near-final offset
   * for every point on a row, so a click landed at the end of a line wherever
   * it was aimed, and in a block taller than the window the browser then
   * scrolled the canvas chasing a caret that was never under the pointer.
   *
   * Detected rather than sniffed, by asking for both ends of a row and seeing
   * whether the answers differ. The result is a property of the engine, so it
   * measured once per field on a row wide enough to be conclusive and then
   * reused; an inconclusive field leaves it unmeasured for a later call.
   */
  #hitTestReadsHorizontal(): boolean {
    if (this.#hitTestHorizontal !== null) return this.#hitTestHorizontal;
    const base = this.#field.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) return true;
    const bounds = base.getBoundingClientRect();
    if (bounds.width < HIT_TEST_PROBE_WIDTH || this.#field.lastOffset < 2) {
      return true;
    }
    const middle = bounds.y + bounds.height / 2;
    const atStart = this.#field.getOffsetFromPoint(bounds.left + 1, middle);
    const atEnd = this.#field.getOffsetFromPoint(bounds.right - 1, middle);
    this.#hitTestHorizontal = atStart !== atEnd;
    return this.#hitTestHorizontal;
  }

  offsetAtPoint(point: Point): number | null {
    const markerElements = [
      ...(this.#field.shadowRoot?.querySelectorAll('.mixed-text-line-break') ??
        []),
    ];
    const breaks = this.lineBreakOffsets();
    if (markerElements.length !== breaks.length) return null;

    const lineIndex = markerElements.filter(
      (marker) => point.y >= marker.getBoundingClientRect().y,
    ).length;
    const lineStart = lineIndex === 0 ? 0 : (breaks[lineIndex - 1] ?? -1) + 1;
    const lineEnd = breaks[lineIndex] ?? this.#field.lastOffset;

    // MathLive lays a field out as one row and knows nothing about the visual
    // breaks that wrap it, so its hit-test cannot answer for a wrapped row.
    // Unwrapping the breaks to ask it anyway held up for prose but not for a
    // row carrying math, where the collapsed row's vertical midline no longer
    // falls on the text: every click on such a row came back as the end of the
    // line. Measuring the rendered geometry needs no such translation.
    const scanned = this.#scanRange(point, lineStart, lineEnd);
    // An empty line has no measurable atom of its own; its start is the only
    // caret position it can hold.
    if (scanned === null) return lineStart;
    return Math.max(lineStart, Math.min(scanned, lineEnd));
  }

  nearestOffsetAtPoint(point: Point): number | null {
    const base = this.#field.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) return this.offsetAtPoint(point);
    let nearestPoint = point;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestPlainOffset: number | null = null;
    const consider = (x: number, y: number, plainOffset?: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
        return;
      }
      const distance = Math.abs(x - point.x) + Math.abs(y - point.y) * 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPoint = { x, y };
        nearestPlainOffset = plainOffset ?? null;
      }
    };
    const plainValue = this.#field.value;
    const mapsDirectlyToPlainText =
      /^[\x20-\x7e]*$/.test(plainValue) &&
      !plainValue.includes('\\') &&
      base.textContent === plainValue;
    let plainOffset = 0;
    const walker = this.#document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node !== null) {
      if (
        node instanceof Text &&
        node.data !== MATHLIVE_LINE_BREAK &&
        node.data !== MATHLIVE_LITERAL_BACKSLASH &&
        node.data !== MATHLIVE_LITERAL_DOLLAR
      ) {
        const parentBounds = node.parentElement?.getBoundingClientRect();
        if (parentBounds !== undefined) {
          for (let offset = 0; offset <= node.length; offset += 1) {
            const range = this.#document.createRange();
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
            consider(
              offset < node.length ? bounds.left : bounds.right,
              parentBounds.y + parentBounds.height / 2,
              mapsDirectlyToPlainText ? plainOffset + offset : undefined,
            );
          }
        }
        if (mapsDirectlyToPlainText) plainOffset += node.length;
      }
      node = walker.nextNode();
    }
    const renderedBase = this.#document.querySelector(
      `[data-mixed-text-id="${CSS.escape(this.#elementId)}"] .ML__base`,
    );
    if (renderedBase instanceof HTMLElement) {
      const renderedOffset = renderedPlainTextOffset(
        renderedBase,
        this.#getSource(),
        point,
      );
      if (renderedOffset !== null) {
        return Math.max(0, Math.min(renderedOffset, this.#field.lastOffset));
      }
    }
    if (
      mapsDirectlyToPlainText &&
      nearestPlainOffset !== null &&
      plainOffset === plainValue.length
    ) {
      return Math.max(0, Math.min(nearestPlainOffset, this.#field.lastOffset));
    }
    return this.offsetForPoint(nearestPoint);
  }

  /**
   * Caret offset for a client point. An unbroken field is one row, which the
   * hit-test already maps directly; only wrapped rows need the row-relative
   * translation `offsetAtPoint` performs.
   */
  offsetForPoint(point: Point): number | null {
    return this.lineBreakOffsets().length === 0 &&
      this.#hitTestReadsHorizontal()
      ? this.#field.getOffsetFromPoint(point.x, point.y)
      : this.offsetAtPoint(point);
  }

  positionAtPoint(point: Point): void {
    const offset = this.offsetForPoint(point);
    if (offset !== null) this.#field.position = offset;
  }

  clearPointerSelection(): void {
    this.#selectionOverlay.replaceChildren();
  }

  showPointerSelection(
    anchor: number,
    anchorPoint: Point,
    focus: number,
    focusPoint: Point,
  ): void {
    this.clearPointerSelection();
    if (anchor === focus) return;
    const breaks = this.lineBreakOffsets();
    const lineForOffset = (offset: number) =>
      lineIndexForFieldOffset(offset, breaks);
    const isForward = anchor < focus;
    const start = isForward ? anchor : focus;
    const end = isForward ? focus : anchor;
    const startPoint = isForward ? anchorPoint : focusPoint;
    const endPoint = isForward ? focusPoint : anchorPoint;
    const startLine = lineForOffset(start);
    const endLine = lineForOffset(end);
    const lines = this.#renderedLineBounds();
    const renderedElement = this.#document.querySelector(
      `[data-mixed-text-id="${CSS.escape(this.#elementId)}"]`,
    );
    if (renderedElement instanceof HTMLElement) {
      renderedElement.before(this.#selectionOverlay);
    }
    const overlayParentBounds =
      this.#selectionOverlay.parentElement?.getBoundingClientRect();
    if (overlayParentBounds === undefined) return;

    for (let line = startLine; line <= endLine; line += 1) {
      const bounds = lines[line];
      if (bounds === null || bounds === undefined) continue;
      const left =
        startLine === endLine
          ? Math.min(startPoint.x, endPoint.x)
          : line === startLine
            ? startPoint.x
            : bounds.left;
      const right =
        startLine === endLine
          ? Math.max(startPoint.x, endPoint.x)
          : line === endLine
            ? endPoint.x
            : bounds.right;
      const rectangle = this.#document.createElement('span');
      rectangle.className = 'inline-math-editor__selection-rect';
      Object.assign(rectangle.style, {
        height: `${bounds.bottom - bounds.top}px`,
        left: `${Math.max(bounds.left, left) - overlayParentBounds.left}px`,
        top: `${bounds.top - overlayParentBounds.top}px`,
        width: `${Math.max(0, Math.min(bounds.right, right) - Math.max(bounds.left, left))}px`,
      });
      this.#selectionOverlay.append(rectangle);
    }
  }

  #renderedLineBounds(): ({
    bottom: number;
    left: number;
    right: number;
    top: number;
  } | null)[] {
    const rendered = this.#document.querySelector(
      `[data-mixed-text-id="${CSS.escape(this.#elementId)}"] .ML__base`,
    );
    if (!(rendered instanceof HTMLElement)) return [];
    const lines: DOMRect[][] = [[]];
    for (const child of rendered.children) {
      if (child.classList.contains('mixed-text-line-break')) {
        lines.push([]);
        continue;
      }
      const bounds = child.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) lines.at(-1)?.push(bounds);
    }
    return lines.map((bounds) => {
      if (bounds.length === 0) return null;
      const left = Math.min(...bounds.map(({ left }) => left));
      const right = Math.max(...bounds.map(({ right }) => right));
      const top = Math.min(...bounds.map(({ top }) => top));
      const bottom = Math.max(...bounds.map(({ bottom }) => bottom));
      return { bottom, left, right, top };
    });
  }
}
