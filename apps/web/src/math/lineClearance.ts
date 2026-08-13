/**
 * Per-line vertical clearance for multi-line mixed blocks.
 *
 * A block is one MathLive render, and its lines are anonymous block boxes
 * divided by the zero-height break spans this codebase inserts. MathLive sizes
 * a formula's line with a strut, but it emits exactly one strut pair per render
 * because it assumes a field holds a single formula. Nothing gives an
 * individual line its own height, so each line falls back to whatever its
 * inline boxes report, and those under-report on purpose: `ML__left-right`
 * carries `margin-top: -depth`, which cancels its depth out of the line box,
 * and glyph ink overshoots KaTeX's metric boxes everywhere else. A tall run
 * therefore draws straight through the lines above and below it.
 *
 * The fix measures what is painted and pushes the neighbouring lines apart by
 * the excess. Only non-text runs are measured. An ordinary text line is already
 * spaced correctly by `line-height`, and its font box overhangs that box in
 * both directions, so measuring text would widen every gap in every block and
 * quietly change the line-spacing setting's meaning.
 */

/**
 * Read by the break-span rules in `board-content.css` and in the editor's
 * shadow stylesheet. Both must resolve the same property or a block and the
 * same block being edited would space their lines differently.
 */
export const LINE_CLEARANCE_PROPERTY = '--line-clearance';

/** The break-span rules, written once so the two document trees cannot drift. */
export const LINE_BREAK_CSS = `
  .mixed-text-line-break {
    display: block !important;
    width: 0 !important;
    height: var(${LINE_CLEARANCE_PROPERTY}, 0px) !important;
    overflow: hidden !important;
  }
  .mixed-text-line-break + .mixed-text-line-break {
    height: calc(
      var(--mixed-line-spacing, 1.2em) + var(${LINE_CLEARANCE_PROPERTY}, 0px)
    ) !important;
  }`;

/** Below this the excess is measurement noise rather than a collision. */
const CLEARANCE_EPSILON_EM = 0.01;

type LineExtent = { bottom: number; top: number };

/**
 * Sets each break span's clearance so no line's ink reaches into its
 * neighbours.
 *
 * `scale` is the camera zoom, because rectangles are read after the board's
 * transform while `font-size` is not. Dividing it out lets the clearance be
 * stored in `em`, which then survives zooming without being recomputed.
 */
export function applyLineClearance(root: ParentNode, scale: number): void {
  const base = root.querySelector<HTMLElement>('.ML__base');
  if (base === null) return;
  const breaks = [
    ...base.querySelectorAll<HTMLElement>('.mixed-text-line-break'),
  ];
  if (breaks.length === 0) return;

  // Cleared first so every measurement below describes the same untouched
  // block, which is what makes repeated runs settle on one answer instead of
  // compounding. Reading a rectangle afterwards flushes this.
  for (const node of breaks) node.style.removeProperty(LINE_CLEARANCE_PROPERTY);

  const pixelsPerEm =
    Number.parseFloat(window.getComputedStyle(base).fontSize) *
    (scale === 0 ? 1 : scale);
  if (!Number.isFinite(pixelsPerEm) || pixelsPerEm <= 0) return;

  const baseRect = base.getBoundingClientRect();
  // One boundary per line edge: the block's own top, then every break, then the
  // block's bottom. Line `i` occupies `boundaries[i]` to `boundaries[i + 1]`.
  const boundaries = [
    baseRect.top,
    ...breaks.map((node) => node.getBoundingClientRect().top),
    baseRect.bottom,
  ];

  const extents: LineExtent[] = breaks.map(() => ({
    bottom: -Infinity,
    top: Infinity,
  }));
  extents.push({ bottom: -Infinity, top: Infinity });

  let line = 0;
  for (const node of base.querySelectorAll('*')) {
    if (node.classList.contains('mixed-text-line-break')) {
      line += 1;
      continue;
    }
    if (
      node.classList.contains('ML__text') ||
      node.classList.contains('ML__pstrut')
    ) {
      continue;
    }
    const rect = node.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) continue;
    const extent = extents[line];
    if (extent === undefined) continue;
    extent.top = Math.min(extent.top, rect.top);
    extent.bottom = Math.max(extent.bottom, rect.bottom);
  }

  breaks.forEach((node, index) => {
    // A break's own top is the boundary between the lines it separates, so both
    // sides are measured against the same edge.
    const boundary = boundaries[index + 1];
    const above = extents[index];
    const below = extents[index + 1];
    if (boundary === undefined || above === undefined || below === undefined) {
      return;
    }
    const overflowBelow =
      above.bottom === -Infinity ? 0 : Math.max(0, above.bottom - boundary);
    const overflowAbove =
      below.top === Infinity ? 0 : Math.max(0, boundary - below.top);
    const clearance = (overflowBelow + overflowAbove) / pixelsPerEm;
    if (clearance <= CLEARANCE_EPSILON_EM) return;
    node.style.setProperty(
      LINE_CLEARANCE_PROPERTY,
      `${clearance.toFixed(3)}em`,
    );
  });
}
