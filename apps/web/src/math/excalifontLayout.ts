/** Excalifont-specific corrections for MathLive vertical operators and exported PDF/SVG layout. */
// MathLive positions vertical constructs using fixed KaTeX layout metrics. The
// Excalifont ink does not always occupy those boxes like the KaTeX outlines do,
// so adjust only the affected visual runs without changing the source or the
// Classic face set.
const LOWER_OPERATOR_LIMIT_SELECTOR =
  '.ML__op-group:has(.ML__large-op) .ML__vlist > .ML__center:first-child > span:last-child[style*="font-size"]';

// An underset is an over-under stack whose first centered run is script-sized.
// Exclude large operators and SVG accents, which need independent geometry.
const LOWER_OVERUNDER_SELECTOR =
  '.ML__vlist:not(:has(.ML__large-op, svg)) > .ML__center:first-child > span:last-child[style*="font-size"]';

// Shift the underbrace SVG and its caption by the same distance. Targeting the
// centered boxes (rather than their differently sized children) preserves the
// existing brace-to-caption gap.
const UNDERBRACE_GLYPH_SELECTOR =
  '.ML__vlist:has(> .ML__center:first-child svg) > .ML__center:first-child';
const UNDERBRACE_LABEL_SELECTOR =
  '.ML__vlist:has(> .ML__center:nth-child(2) .ML__vlist > .ML__center:first-child svg) > .ML__center:first-child';

type ExcalifontAccent = 'hat' | 'vec';

const ACCENT_BY_GLYPH: Readonly<Record<string, ExcalifontAccent>> = {
  '^': 'hat',
  '⃗': 'vec',
};

const HAT_ACCENT_SELECTOR = '[data-excalifont-accent="hat"]';
const VECTOR_ACCENT_SELECTOR = '[data-excalifont-accent="vec"]';

/** Adds semantic hooks without changing the MathLive source or selection map. */
export function decorateExcalifontLayout(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.ML__accent-body').forEach((element) => {
    const accent = ACCENT_BY_GLYPH[element.textContent ?? ''];
    if (accent === undefined) element.removeAttribute('data-excalifont-accent');
    else element.dataset.excalifontAccent = accent;
  });
}

/** Adds the same hooks to MathLive's inactive serialized markup. */
export function decorateExcalifontStaticMarkup(markup: string): string {
  return markup.replace(
    /(<span class="ML__accent-body(?: ML__accent-combining-char)?"[^>]*)(>)(\^|⃗)(<\/span>)/g,
    (_match, opening: string, _end: string, glyph: string, closing: string) =>
      `${opening} data-excalifont-accent="${ACCENT_BY_GLYPH[glyph]}">${glyph}${closing}`,
  );
}

/** Light-DOM operator-limit corrections for static Excalifont equations. */
export const EXCALIFONT_OPERATOR_LAYOUT_CSS = `${LOWER_OPERATOR_LIMIT_SELECTOR} {
  position: relative;
  top: -0.8em;
}

${LOWER_OVERUNDER_SELECTOR} {
  position: relative;
  top: 0.3em;
}

${UNDERBRACE_GLYPH_SELECTOR} {
  transform: translateY(0.2em);
}

${UNDERBRACE_LABEL_SELECTOR} {
  transform: translateY(0.1em);
}

${VECTOR_ACCENT_SELECTOR} {
  left: -0.32em;
  top: -0.02em;
}

${HAT_ACCENT_SELECTOR} {
  position: relative;
  top: -0.05em;
}`;

/** Shadow-DOM operator-limit corrections for active Excalifont fields. */
export const EXCALIFONT_OPERATOR_SHADOW_LAYOUT_CSS = `:host([data-workspace-font='excalifont']) ${LOWER_OPERATOR_LIMIT_SELECTOR} {
  position: relative;
  top: -0.8em;
}

:host([data-workspace-font='excalifont']) ${LOWER_OVERUNDER_SELECTOR} {
  position: relative;
  top: 0.3em;
}

:host([data-workspace-font='excalifont']) ${UNDERBRACE_GLYPH_SELECTOR} {
  transform: translateY(0.2em);
}

:host([data-workspace-font='excalifont']) ${UNDERBRACE_LABEL_SELECTOR} {
  transform: translateY(0.1em);
}

:host([data-workspace-font='excalifont']) ${VECTOR_ACCENT_SELECTOR} {
  left: -0.32em;
  top: -0.02em;
}

:host([data-workspace-font='excalifont']) ${HAT_ACCENT_SELECTOR} {
  position: relative;
  top: -0.05em;
}`;
