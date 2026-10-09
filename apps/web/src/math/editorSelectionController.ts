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
  depth?: number;
  left: number;
  right: number;
  top: number;
}

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
    const info = this.#field.getElementInfo(offset);
    const bounds = info?.bounds;
    return bounds === undefined
      ? undefined
      : {
          bottom: bounds.bottom,
          depth: info?.depth ?? 0,
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
      const info = this.#field.getElementInfo(offset);
      const bounds = info?.bounds;
      geometry[offset] =
        bounds === undefined
          ? undefined
          : {
              bottom: bounds.bottom,
              depth: info?.depth ?? 0,
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
   * One box here is not a real character: the box reported for a row's first
   * offset actually belongs to the line-break marker in front of it, and that
   * box is as wide as the whole block. If it is left in, it wins any click near
   * the right of a row and the caret lands at the start of the row instead.
   * `startFollowsBreak` says whether this row has one.
   *
   * That box used to be spotted by height, by ignoring anything more than twice
   * the height of the shortest box on the row. That does not work for
   * mathematics, where a fraction is tall and its digits are small: one small
   * box drops the limit below every real character, so the whole row is thrown
   * away and every click on it lands on whatever is left. Identifying the
   * marker by name needs no height limit at all.
   */
  #scanRange(
    point: Point,
    start: number,
    end: number,
    startFollowsBreak: boolean,
  ): number | null {
    const measured: { bounds: OffsetBounds; offset: number }[] = [];
    for (let offset = start; offset <= end; offset += 1) {
      const bounds = this.#boundsForOffset(offset);
      if (bounds === undefined || !Number.isFinite(bounds.right)) continue;
      measured.push({ bounds, offset });
    }
    if (measured.length === 0) return null;

    const markerOffset = startFollowsBreak ? start : null;
    const onRow = measured.filter(({ offset }) => offset !== markerOffset);
    if (onRow.length === 0) return measured[0]?.offset ?? null;

    const rowLeft = Math.min(...onRow.map(({ bounds }) => bounds.left));
    const shallowestDepth = Math.min(
      ...onRow.map(({ bounds }) => bounds.depth ?? 0),
    );
    const hasNestedOffset = onRow.some(
      ({ bounds }) => (bounds.depth ?? 0) > shallowestDepth,
    );
    let nearestOffset: number | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const { bounds, offset } of measured) {
      // The row's first offset is still a real caret position, at the left
      // edge of the row. It is only the marker's own box that is unusable.
      const structural = offset === markerOffset;
      const caretX = structural ? rowLeft : bounds.right;
      const band = structural ? (onRow[0]?.bounds ?? bounds) : bounds;
      const verticalGap =
        point.y < band.top
          ? band.top - point.y
          : point.y > band.bottom
            ? point.y - band.bottom
            : 0;
      const horizontalGap = Math.abs(caretX - point.x);
      // A root/group boundary can cover an entire nested construct. It is a
      // valid caret only at its own edge; away from that edge, prefer the
      // deeper atom whose geometry represents what the user clicked.
      const containerPenalty =
        hasNestedOffset &&
        (bounds.depth ?? 0) === shallowestDepth &&
        horizontalGap > 4
          ? Math.max(12, (bounds.bottom - bounds.top) / 2)
          : 0;
      const distance = horizontalGap + verticalGap * 2 + containerPenalty;
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

  /**
   * Which row a click is in, and the range of offsets that row can hold.
   *
   * Every answer about that click is kept inside this range. Which row you
   * clicked is something you can see, so it is decided first, from the
   * line-break markers alone. Which character you clicked has to be measured,
   * and measuring can pick the wrong row: click past the end of a short row and
   * the nearest character on screen is the one below it, which used to move the
   * caret down a row.
   */
  #rowForPoint(
    point: Point,
  ): { lineEnd: number; lineIndex: number; lineStart: number } | null {
    const markerElements = [
      ...(this.#field.shadowRoot?.querySelectorAll('.mixed-text-line-break') ??
        []),
    ];
    const breaks = this.lineBreakOffsets();
    if (markerElements.length !== breaks.length) return null;
    const lineIndex = markerElements.filter(
      (marker) => point.y >= marker.getBoundingClientRect().y,
    ).length;
    return {
      lineEnd: breaks[lineIndex] ?? this.#field.lastOffset,
      lineIndex,
      lineStart: lineIndex === 0 ? 0 : (breaks[lineIndex - 1] ?? -1) + 1,
    };
  }

  /**
   * The offsets a row begins and ends at, for selecting a whole line at once.
   *
   * The end is the offset of the row's break sentinel rather than one past it,
   * so selecting the range takes the writing on the line and leaves the break
   * itself alone: replacing the selection rewrites that line instead of joining
   * it to the next one.
   */
  lineRangeAtPoint(point: Point): { end: number; start: number } | null {
    const row = this.#rowForPoint(point);
    return row === null ? null : { end: row.lineEnd, start: row.lineStart };
  }

  offsetAtPoint(point: Point): number | null {
    const row = this.#rowForPoint(point);
    if (row === null) return null;
    const { lineEnd, lineIndex, lineStart } = row;

    // MathLive lays a field out as one row and knows nothing about the visual
    // breaks that wrap it, so its hit-test cannot answer for a wrapped row.
    // Unwrapping the breaks to ask it anyway held up for prose but not for a
    // row carrying math, where the collapsed row's vertical midline no longer
    // falls on the text: every click on such a row came back as the end of the
    // line. Measuring the rendered geometry needs no such translation.
    const scanned = this.#scanRange(point, lineStart, lineEnd, lineIndex > 0);
    // An empty line has no measurable atom of its own; its start is the only
    // caret position it can hold.
    if (scanned === null) return lineStart;
    return Math.max(lineStart, Math.min(scanned, lineEnd));
  }

  nearestOffsetAtPoint(point: Point): number | null {
    const base = this.#field.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) return this.offsetAtPoint(point);
    // Whatever the search below picks, it cannot leave the row that was
    // clicked. On its own the search would: past the end of a short row the
    // closest character on screen is the one below, so it wins on distance.
    const row = this.#rowForPoint(point);
    const withinRow = (offset: number | null): number | null =>
      offset === null || row === null
        ? offset
        : Math.max(row.lineStart, Math.min(offset, row.lineEnd));
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestPlainOffset: number | null = null;
    const consider = (x: number, y: number, plainOffset?: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
        return;
      }
      const distance = Math.abs(x - point.x) + Math.abs(y - point.y) * 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
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
        return withinRow(
          Math.max(0, Math.min(renderedOffset, this.#field.lastOffset)),
        );
      }
    }
    if (
      mapsDirectlyToPlainText &&
      nearestPlainOffset !== null &&
      plainOffset === plainValue.length
    ) {
      return withinRow(
        Math.max(0, Math.min(nearestPlainOffset, this.#field.lastOffset)),
      );
    }
    return withinRow(this.offsetAtPoint(point));
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
    const offset = this.nearestOffsetAtPoint(point);
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
    if (anchor === focus) {
      this.clearPointerSelection();
      return;
    }
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
    // MathLive rebuilds the field while a drag is in progress. Caught
    // mid-rebuild the line breaks have not been marked yet and every line reads
    // as one, which draws a single box across all of them, as wide as the
    // widest line and reaching far past the writing it claims to mark.
    //
    // A reading that finds fewer lines than the block has is a half-built tree,
    // and drawing from it treats the whole block as one line: a single box as
    // wide as the widest line and as tall as all of them, reaching far past the
    // writing it claims to mark.
    //
    // Two counts, because neither is sufficient alone. The sentinels live in
    // the field's value and survive a rebuild of the markup that paints them,
    // but the value itself is momentarily single-line just after a switch out
    // of the source view, before the sentinels are applied. The copy beside the
    // field carries the last committed shape of the block, which covers that
    // window. Taking the larger only ever rejects: a copy that lags an
    // uncommitted edit reports fewer lines and cannot veto anything, while a
    // copy reporting more means the field has not caught up yet, which is
    // precisely the reading that must not be drawn from.
    const expectedLines = Math.max(
      breaks.length + 1,
      this.#committedLineCount(),
    );
    if (lines.length < expectedLines) return;

    // Which line a point is on is decided by where it is, not by counting
    // sentinels. The offsets are momentarily empty while the field's value is
    // rebuilt, and a line index derived from them then collapses to zero for
    // both ends of the range: one wide band is painted across the first line
    // while the field's own selection correctly covers the lines below it.
    // A pointer's vertical position cannot collapse that way.
    const lineAtPoint = (point: Point, fallback: number) => {
      const index = lines.findIndex(
        (bounds) =>
          bounds !== null && point.y >= bounds.top && point.y <= bounds.bottom,
      );
      if (index >= 0) return index;
      const painted = lines
        .map((bounds, at) => ({ at, bounds }))
        .filter(
          (
            entry,
          ): entry is {
            at: number;
            bounds: NonNullable<typeof entry.bounds>;
          } => entry.bounds !== null,
        );
      if (painted.length === 0) return fallback;
      const first = painted[0];
      const last = painted.at(-1);
      if (first !== undefined && point.y < first.bounds.top) return first.at;
      if (last !== undefined && point.y > last.bounds.bottom) return last.at;
      return fallback;
    };
    const resolvedStart = lineAtPoint(startPoint, startLine);
    const resolvedEnd = lineAtPoint(endPoint, endLine);
    const firstLine = Math.min(resolvedStart, resolvedEnd);
    const lastLine = Math.max(resolvedStart, resolvedEnd);

    const spans: { left: number; line: number; right: number }[] = [];
    for (let line = firstLine; line <= lastLine; line += 1) {
      const bounds = lines[line];
      if (bounds === null || bounds === undefined) continue;
      spans.push({
        left:
          firstLine === lastLine
            ? Math.min(startPoint.x, endPoint.x)
            : line === resolvedStart
              ? startPoint.x
              : bounds.left,
        line,
        right:
          firstLine === lastLine
            ? Math.max(startPoint.x, endPoint.x)
            : line === resolvedEnd
              ? endPoint.x
              : bounds.right,
      });
    }
    this.#paintLineSpans(lines, spans);
  }

  /**
   * Draws the field's current selection, wherever it came from.
   *
   * The pointer path above knows where the drag began and ended, which a
   * keyboard or a command transaction never tells us. This one asks the writing
   * instead: MathLive marks each selected glyph `ML__selected`, and those
   * elements are laid out where they are actually painted, on the line they
   * belong to. Its own reading of the same atoms is not - see the note beside
   * `--selection-background-color` in `board-content.css` - so the glyph boxes
   * are the only trustworthy account of what is selected.
   */
  showSelection(): void {
    const root = this.#field.shadowRoot;
    if (root === null || root === undefined) return;
    const lines = this.#renderedLineBounds();
    if (lines.length < Math.max(1, this.#committedLineCount())) return;
    // Leaves only: a selected fraction marks itself and everything inside it,
    // and the outer box spans both of its rows.
    const boxes = [...root.querySelectorAll('.ML__selected')]
      .filter((element) => element.querySelector('.ML__selected') === null)
      .map((element) => element.getBoundingClientRect())
      .filter((bounds) => bounds.width > 0 && bounds.height > 0);
    if (boxes.length === 0) {
      this.clearPointerSelection();
      return;
    }
    const extents = new Map<number, { left: number; right: number }>();
    for (const box of boxes) {
      const middle = (box.top + box.bottom) / 2;
      let line = -1;
      let nearest = Number.POSITIVE_INFINITY;
      lines.forEach((bounds, index) => {
        if (bounds === null) return;
        const distance =
          middle < bounds.top
            ? bounds.top - middle
            : middle > bounds.bottom
              ? middle - bounds.bottom
              : 0;
        if (distance < nearest) {
          nearest = distance;
          line = index;
        }
      });
      if (line < 0) continue;
      const extent = extents.get(line);
      extents.set(
        line,
        extent === undefined
          ? { left: box.left, right: box.right }
          : {
              left: Math.min(extent.left, box.left),
              right: Math.max(extent.right, box.right),
            },
      );
    }
    this.#paintLineSpans(
      lines,
      [...extents.entries()]
        .map(([line, extent]) => ({ ...extent, line }))
        .sort((first, second) => first.line - second.line),
    );
  }

  /** Replaces the overlay with one rectangle per line of the given spans. */
  #paintLineSpans(
    lines: (OffsetBounds | null)[],
    spans: { left: number; line: number; right: number }[],
  ): void {
    this.clearPointerSelection();
    // The overlay belongs to the editor's own box, which is absolutely
    // positioned and scaled by the camera exactly as the writing is. Highlights
    // written in that box's coordinates are carried by the same pan and zoom
    // that move the text. Measured against the shared container instead, they
    // stayed behind the moment the board was panned, and sitting in normal flow
    // beside the block they could push the next line down.
    const host = this.#selectionOverlay.parentElement;
    if (host === null) return;
    const overlayParentBounds = host.getBoundingClientRect();
    // The measurements below are painted screen rectangles, so they already
    // carry the camera's scale. The overlay is inside the scaled box, which
    // applies that scale again, so it is divided out here exactly once.
    const scale =
      host.offsetWidth > 0 ? overlayParentBounds.width / host.offsetWidth : 1;
    const toLocal = (value: number) => (scale > 0 ? value / scale : value);

    for (const { left, line, right } of spans) {
      const bounds = lines[line];
      if (bounds === null || bounds === undefined) continue;
      const rectLeft = Math.max(bounds.left, left);
      const rectWidth = Math.max(0, Math.min(bounds.right, right) - rectLeft);
      // A line the selection spans but which paints nothing gets no rectangle,
      // rather than an empty box floating where no writing is.
      if (rectWidth <= 0) continue;
      const rectangle = this.#document.createElement('span');
      rectangle.className = 'inline-math-editor__selection-rect';
      Object.assign(rectangle.style, {
        height: `${toLocal(bounds.bottom - bounds.top)}px`,
        left: `${toLocal(rectLeft - overlayParentBounds.left)}px`,
        top: `${toLocal(bounds.top - overlayParentBounds.top)}px`,
        width: `${toLocal(rectWidth)}px`,
      });
      this.#selectionOverlay.append(rectangle);
    }
  }

  /**
   * Lines in the block as last committed, read from the copy beside the field.
   *
   * That copy is rewritten only when an edit commits, so it holds still while
   * the field's own markup and value are being rebuilt underneath a drag.
   */
  #committedLineCount(): number {
    const rendered = this.#document.querySelector(
      `[data-mixed-text-id="${CSS.escape(this.#elementId)}"] .ML__base`,
    );
    if (!(rendered instanceof HTMLElement)) return 1;
    return rendered.querySelectorAll('.mixed-text-line-break').length + 1;
  }

  #renderedLineBounds(): ({
    bottom: number;
    left: number;
    right: number;
    top: number;
  } | null)[] {
    // The field being selected in, not the inactive copy beside it. The copy is
    // a separate box that need not sit where the field sits, and measuring one
    // while positioning against the other put the highlight beside the writing
    // rather than on it. Readings taken while the field is rebuilding are
    // rejected by the caller instead.
    const rendered = this.#field.shadowRoot?.querySelector('.ML__base');
    if (!(rendered instanceof HTMLElement)) return [];
    const lines: DOMRect[][] = [[]];
    // Selecting the block makes MathLive rebuild it with the selected run
    // wrapped, which buries the break spans a level or two down. Read as top
    // children only, the six-line block then reported one line and every
    // highlight was withheld. Descending only where a break actually hides
    // leaves an unselected block measured exactly as before.
    const walk = (element: Element): void => {
      for (const child of element.children) {
        if (child.classList.contains('mixed-text-line-break')) {
          lines.push([]);
          continue;
        }
        if (child.querySelector('.mixed-text-line-break') !== null) {
          walk(child);
          continue;
        }
        const bounds = child.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) lines.at(-1)?.push(bounds);
      }
    };
    walk(rendered);
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
