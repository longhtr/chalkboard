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

interface EditorSelectionControllerOptions {
  decorateSpecialText: () => void;
  documentTarget?: Document;
  elementId: string;
  field: MathfieldElement;
  getSource: () => string;
  selectionOverlay: HTMLElement;
}

/** Maps MathLive field offsets, logical source offsets, lines, and client points. */
export class EditorSelectionController {
  readonly #decorateSpecialText: () => void;
  readonly #document: Document;
  readonly #elementId: string;
  readonly #field: MathfieldElement;
  readonly #getSource: () => string;
  readonly #selectionOverlay: HTMLElement;

  constructor({
    decorateSpecialText,
    documentTarget = document,
    elementId,
    field,
    getSource,
    selectionOverlay,
  }: EditorSelectionControllerOptions) {
    this.#decorateSpecialText = decorateSpecialText;
    this.#document = documentTarget;
    this.#elementId = elementId;
    this.#field = field;
    this.#getSource = getSource;
    this.#selectionOverlay = selectionOverlay;
  }

  lineBreakOffsets(): number[] {
    const offsets: number[] = [];
    for (let offset = 0; offset < this.#field.lastOffset; offset += 1) {
      if (this.#field.getValue([offset, offset + 1]) === MATHLIVE_LINE_BREAK) {
        offsets.push(offset);
      }
    }
    return offsets;
  }

  invisibleFormattingMarkerOffsets(): number[] {
    const offsets: number[] = [];
    for (let offset = 0; offset < this.#field.lastOffset; offset += 1) {
      const value = this.#field.getValue([offset, offset + 1]);
      if (isTextColorMarker(value) || isTextStyleMarker(value)) {
        offsets.push(offset);
      }
    }
    return offsets;
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
    const base = this.#field.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) return null;
    const decoratedLineLeft = base.getBoundingClientRect().x;

    // MathLive maps points against its original single-row layout. Briefly
    // remove the visual breaks, map this row-relative x-coordinate into that
    // layout, then restore the breaks before the browser can paint.
    markerElements.forEach((marker) =>
      marker.classList.remove('mixed-text-line-break'),
    );
    let mappedPosition: number;
    try {
      const unwrappedLineLeft =
        lineIndex === 0
          ? base.getBoundingClientRect().x
          : (markerElements[lineIndex - 1]?.getBoundingClientRect().x ??
            base.getBoundingClientRect().x);
      const baseBounds = base.getBoundingClientRect();
      mappedPosition = this.#field.getOffsetFromPoint(
        unwrappedLineLeft + point.x - decoratedLineLeft,
        baseBounds.y + baseBounds.height / 2,
      );
    } finally {
      markerElements.forEach((marker) => {
        if (marker.isConnected) marker.classList.add('mixed-text-line-break');
      });
      this.#decorateSpecialText();
    }
    return Math.max(lineStart, Math.min(mappedPosition, lineEnd));
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
    return this.lineBreakOffsets().length === 0
      ? this.#field.getOffsetFromPoint(nearestPoint.x, nearestPoint.y)
      : this.offsetAtPoint(nearestPoint);
  }

  positionAtPoint(point: Point): void {
    const offset =
      this.lineBreakOffsets().length === 0
        ? this.#field.getOffsetFromPoint(point.x, point.y)
        : this.offsetAtPoint(point);
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
