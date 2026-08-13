/** Excalifont-specific corrections for MathLive vertical operators and exported PDF/SVG layout. */
// MathLive positions vertical constructs using fixed KaTeX layout metrics. The
// Excalifont ink does not always occupy those boxes like the KaTeX outlines do,
// so adjust only the affected visual runs without changing the source or the
// Classic face set.
const LOWER_OPERATOR_LIMIT_SELECTOR =
  '.ML__op-group:has(.ML__large-op) .ML__vlist > .ML__center:first-child > span:last-child[style*="font-size"]';

// The upper limit of a stacked operator, which is a different element from the
// side-set limit an integral uses: a sum stacks lower limit, symbol and upper
// limit as three rows, so the upper one is the last. The script-size guard is
// what keeps the middle row, the symbol itself, out of both selectors when an
// operator carries only one limit.
const UPPER_OPERATOR_LIMIT_SELECTOR =
  '.ML__op-group:has(.ML__large-op) .ML__vlist > .ML__center:last-child > span:last-child[style*="font-size"]';
// Positive moves the limit down, toward its symbol.
const UPPER_OPERATOR_LIMIT_OFFSET = '0.18em';

// How far the lower limit of a sum or product is pulled back toward its
// symbol. MathLive leaves an Excalifont operator's lower limit sitting well
// below where the KaTeX metrics put it; negative moves it up, so a smaller
// magnitude sits the limit lower. Shared by the light and shadow rules so the
// inactive block and the field being edited cannot drift apart.
const LOWER_OPERATOR_LIMIT_OFFSET = '-0.5em';

// An underset is an over-under stack whose first centered run is script-sized.
// Exclude large operators and SVG accents, which need independent geometry.
//
// A fraction is built from the same over-under vlist, and a nested one puts a
// script-sized run in that first centered row, so it matched too and every
// nested fraction had a row pushed down into its own rule. A fraction's vlist
// is the only one whose table is a direct child of `.ML__mfrac`; an underset's
// sits under `.ML__base` or `.ML__op-group`, including when the underset is
// itself inside a fraction.
const FRACTION_OWN_VLIST_SELECTOR =
  '.ML__mfrac > .ML__vlist-t > .ML__vlist-r > .ML__vlist';
const LOWER_OVERUNDER_SELECTOR =
  `.ML__vlist:not(:has(.ML__large-op, svg)):not(${FRACTION_OWN_VLIST_SELECTOR})` +
  ' > .ML__center:first-child > span:last-child[style*="font-size"]';

// Shift the underbrace SVG and its caption by the same distance. Targeting the
// centered boxes (rather than their differently sized children) preserves the
// existing brace-to-caption gap.
const UNDERBRACE_GLYPH_SELECTOR =
  '.ML__vlist:has(> .ML__center:first-child svg) > .ML__center:first-child';
const UNDERBRACE_LABEL_SELECTOR =
  '.ML__vlist:has(> .ML__center:nth-child(2) .ML__vlist > .ML__center:first-child svg) > .ML__center:first-child';

// Excalifont's operator symbol sits higher in its box than the KaTeX outline
// MathLive lays out for: the same sigma starts about 0.4em further up, which
// is the end that collides with a fraction rule above it. Lower the symbol
// alone; its limits are placed correctly against the surrounding text.
//
// Offset rather than transformed: the symbol is an inline box, so a transform
// on it is ignored while computed style still reports the matrix.
const OPERATOR_SYMBOL_SELECTOR = '.ML__op-symbol';

// The upper limit of an operator, raised clear of the taller Excalifont
// symbol. Its row carries an inline offset, so this composes with a transform;
// the row is a block, so the transform applies.
const OPERATOR_UPPER_LIMIT_SELECTOR =
  '.ML__op-group .ML__msubsup .ML__vlist > span:last-child';

// Integral-family operators only. The glyph is the sole way to tell them from
// a sum or product, so they are tagged where accents already are, in both the
// live tree and the serialized markup.
const INTEGRAL_GLYPHS = new Set(['∫', '∬', '∭', '∮', '∯', '∰']);

// Two parts of the family need more than the shared correction.
//
// The repeated and contour signs carry ink further right than a single
// integral, so the integrand sits hard against the subscript and the two read
// as one run. Widening the operator's own box moves the integrand off it and
// leaves the subscript against the sign it belongs to.
const WIDE_INTEGRAL_GLYPHS = new Set(['∬', '∭', '∮']);
// The closed surface and volume signs sit lower in their box than the rest.
const RAISED_INTEGRAL_GLYPHS = new Set(['∯', '∰']);
// Set-style large operators, which take their own size and no vertical
// correction. The shared symbol offset below is tuned for a sigma, whose ink
// fills its box top to bottom; these sit lower in theirs, so the same push
// down left them below the line they should sit on.
const SET_OPERATOR_GLYPHS = new Set([
  '⊓',
  '⊔',
  '⊎',
  '⨅',
  '⨆',
  '⨄',
  // Amalgamation and its large form. `\amalg` draws U+2A3F, not the U+2210
  // that `\coprod` draws, so both are listed rather than assumed to be one.
  '⨿',
  '∐',
]);

type IntegralVariant = 'raised' | 'wide';

function integralVariant(glyph: string): IntegralVariant | undefined {
  if (WIDE_INTEGRAL_GLYPHS.has(glyph)) return 'wide';
  if (RAISED_INTEGRAL_GLYPHS.has(glyph)) return 'raised';
  return undefined;
}

const INTEGRAL_SELECTOR = "[data-excalifont-op='integral']";
// The operator's own box, which the integrand follows. Its limits sit inside
// that box, so widening it moves the integrand without moving them.
const WIDE_INTEGRAL_BODY_SELECTOR =
  ".ML__op-group:has([data-excalifont-op-variant='wide'])";
const RAISED_INTEGRAL_SELECTOR = "[data-excalifont-op-variant='raised']";
const WIDE_INTEGRAL_SELECTOR = "[data-excalifont-op-variant='wide']";
const SET_OPERATOR_SELECTOR = "[data-excalifont-op-variant='set']";

// MathLive spaces the limits off the symbol with an inline `margin-right`,
// which is the gap that leaves them stranded to its right.
const INTEGRAL_SYMBOL_MARGIN = '0.16em';
// Each written once for both the light and shadow rules, so an inactive block
// and the field being edited cannot drift apart.
const INTEGRAL_SYMBOL_SCALE = '1.25em';
const WIDE_INTEGRAL_BODY_GAP = '0.18em';
const RAISED_INTEGRAL_RISE = '0.28em';
// These operators take no vertical correction at all: the shared offset below
// pushes every symbol down to keep a sigma clear of a fraction rule above it,
// and that is the whole reason this family read as too low. Exempting them
// leaves MathLive's own layout intact, limits included, rather than moving the
// symbol away from limits that stay where they were.
const SET_OPERATOR_TOP = '0em';
// Excalifont draws this family heavier than the sigma the shared sizes are set
// against, so they read as oversized beside it.
const SET_OPERATOR_SCALE = '0.85em';
// These glyphs come from a size face with no bold cut, and font synthesis is
// off, so weight has to be added by stroking the outline. The stroke is
// centred on the edge, so it closes the counters if pushed far.
const SET_OPERATOR_STROKE = '0.4px';
// Moves a repeated or contour sign toward the limits that follow it, closing
// the gap the shared right margin leaves without moving the limits themselves.
const WIDE_INTEGRAL_SHIFT = '0.18em';
// How far the upper limit is lifted clear of the taller Excalifont symbol.
// Negative is upward, so a smaller magnitude sits the limit lower.
const OPERATOR_UPPER_LIMIT_RISE = '-0.12em';
const OPERATOR_SYMBOL_TOP = '0.15em';

// The bar of an evaluation bound, as in `\left. F \right|_a^b`.
//
// MathLive builds a tall delimiter by stacking repeats of one glyph, so the
// only thing separating an evaluation bar from a closing bracket of the same
// height is which glyph was stacked. Tag it where the integrals are tagged
// rather than trying to name it in a selector.
const EVALUATION_BAR_GLYPHS = new Set(['∣', '|', '‖', '∥']);
// A stacked delimiter is padded with zero-width struts. They are not
// whitespace, so trimming leaves them behind and the delimiter stops looking
// like one made only of bars.
const INVISIBLE_PADDING = /[\s\u200B-\u200F\u2060-\u206F\uFEFF]/gu;
const EVALUATION_BAR_SELECTOR = "[data-excalifont-delim='bar']";
// Grown about its own middle, so the bar reaches past the expression at both
// ends the way a hand-drawn one does.
const EVALUATION_BAR_SCALE = '1.5';
const PLAIN_BAR_SCALE = '1.12';
const PLAIN_BAR_SELECTOR = "[data-excalifont-delim='bar-plain']";
// A matrix delimiter is stretched to the table box, which carries the row
// padding above and below the writing, so the bar reaches past the rows it
// encloses. Drawn back rather than lengthened.
const MATRIX_BAR_SELECTOR = "[data-excalifont-delim='bar-matrix']";
const MATRIX_BAR_SCALE = '0.9';

type ExcalifontAccent =
  'ddddot' | 'dddot' | 'ddot' | 'dot' | 'hat' | 'ring' | 'vec';

// The three and four dot accents are combining marks with no advance width,
// so MathLive centres an empty box and the ink lands to the right of the
// letter, further right the more dots there are. The two dot accent is an
// ordinary spacing glyph and is already centred, as is a single dot.
const ACCENT_BY_GLYPH: Readonly<Record<string, ExcalifontAccent>> = {
  '\u00A8': 'ddot',
  '\u02D9': 'dot',
  '\u02DA': 'ring',
  '\u20DB': 'dddot',
  '\u20DC': 'ddddot',
  '^': 'hat',
  '⃗': 'vec',
};

const HAT_ACCENT_SELECTOR = '[data-excalifont-accent="hat"]';
const VECTOR_ACCENT_SELECTOR = '[data-excalifont-accent="vec"]';
const DOT_ACCENT_SELECTOR =
  '[data-excalifont-accent="dot"], [data-excalifont-accent="ddot"]';
const RING_ACCENT_SELECTOR = '[data-excalifont-accent="ring"]';
// A single dot alone sits right of where the two dot accent does, which is the
// placement every other accent shares, so only it is pulled back.
const SINGLE_DOT_ACCENT_SELECTOR = '[data-excalifont-accent="dot"]';
const SINGLE_DOT_ACCENT_SHIFT = '-0.1em';
// The dot and ring accents sit a little low against the taller Excalifont
// letters, and the ring a little left of where its own ink reads as centred.
const DOT_ACCENT_RISE = '-0.04em';
const RING_ACCENT_RISE = '-0.04em';
const RING_ACCENT_SHIFT = '0.04em';
const DDDOT_ACCENT_SELECTOR = '[data-excalifont-accent="dddot"]';
const DDDDOT_ACCENT_SELECTOR = '[data-excalifont-accent="ddddot"]';
// The four dot row is wider than the three dot row, so it needs more pull.
const DDDOT_ACCENT_SHIFT = '-0.22em';
// Drawn larger, and dropped toward the letter. The sideways pull is in the
// accent's own em, so it grows with the size and keeps the row centred.
const DDDOT_ACCENT_SCALE = '1.7em';
const DDDOT_ACCENT_DROP = '0.38em';
const DDDDOT_ACCENT_SHIFT = '-0.26em';
const DDDDOT_ACCENT_SCALE = '2.1em';
const DDDDOT_ACCENT_DROP = '0.42em';

/**
 * Gives every vertical bar an element of its own and says which kind it is.
 *
 * A bar reaches the page in several unrelated shapes: as a delimiter element
 * of its own, as the pieces of a stacked delimiter, or as a plain character
 * that MathLive merged into the run beside it, so `F(x)|` arrives as one span
 * holding both the bracket and the bar. Only an element that is nothing but a
 * bar can be corrected, so a mixed run is rebuilt as alternating spans first.
 *
 * A bar carrying limits, or closing a pair that opened with `\left.`, is an
 * evaluation bound and is lengthened further than an absolute value or a norm.
 *
 * Text content is unchanged, so offsets into the rendered text are unaffected.
 */
function isEvaluationBound(element: Element): boolean {
  if (element.nextElementSibling?.classList.contains('ML__msubsup') === true) {
    return true;
  }
  return (
    element.classList.contains('ML__close') &&
    element.parentElement?.firstElementChild?.classList.contains(
      'ML__nulldelimiter',
    ) === true
  );
}

function tagBar(element: HTMLElement): void {
  element.dataset.excalifontDelim = isEvaluationBound(element)
    ? 'bar'
    : 'bar-plain';
}

// MathLive's keyboard sink. Named once so a second decoration pass cannot start
// rewriting the field's focused element by walking past it.
const INPUT_SURFACE_SELECTOR = '.ML__keyboard-sink';

function decorateBars(root: ParentNode): void {
  const barClass = `[${[...EVALUATION_BAR_GLYPHS].join('')}]`;
  // MathLive keeps a contenteditable span in its shadow root that mirrors the
  // current selection so the browser can copy it, and that span is what holds
  // the field's focus. It is an input surface, not rendered writing: it carries
  // whatever the user has selected, so selecting across a bar put a bar glyph
  // in it and the split below replaced the focused element. Firefox then moved
  // focus to the document body without firing a blur, and every keystroke after
  // that went nowhere.
  const inputSurface = root.querySelector(INPUT_SURFACE_SELECTOR);
  for (const element of [...root.querySelectorAll<HTMLElement>('*')]) {
    if (
      inputSurface !== null &&
      (element === inputSurface || inputSurface.contains(element))
    ) {
      continue;
    }
    if (element.dataset.excalifontDelim !== undefined) continue;
    // A stacked delimiter is corrected as a whole, so its pieces are left be.
    if (element.parentElement?.closest('[data-excalifont-delim]') != null) {
      continue;
    }
    // A delimiter around a matrix is already stretched to what it encloses, so
    // lengthening it only makes it overshoot the rows. The correction is for
    // bars whose glyph is short against the writing, not for ones sized to fit.
    //
    // Marked rather than skipped: a stacked delimiter's pieces are each a bar
    // on their own, and the guard above only leaves them alone while something
    // above them is marked. Simply passing over the delimiter scaled all eight
    // of its pieces instead of none.
    const text = element.textContent ?? '';
    if (!new RegExp(barClass, 'u').test(text)) continue;
    // Only after the element is known to carry a bar: this test used to run
    // first, which tagged every bracket, letter and rule inside a matrix as a
    // bar and drew the lot at nine tenths.
    if (element.parentElement?.querySelector('.ML__mtable') != null) {
      element.dataset.excalifontDelim = 'bar-matrix';
      continue;
    }

    const isDelimiter =
      element.classList.contains('ML__delim-mult') ||
      element.classList.contains('ML__small-delim') ||
      [...element.classList].some((name) => name.startsWith('ML__delim-size'));
    const visible = text.replace(INVISIBLE_PADDING, '');
    const onlyBars =
      visible !== '' &&
      !new RegExp(`[^${[...EVALUATION_BAR_GLYPHS].join('')}]`, 'u').test(
        visible,
      );

    if (onlyBars && (isDelimiter || element.children.length === 0)) {
      tagBar(element);
      continue;
    }
    if (element.children.length > 0) continue;

    const created: HTMLElement[] = [];
    const fragment = element.ownerDocument.createDocumentFragment();
    for (const piece of text.split(new RegExp(`(${barClass})`, 'u'))) {
      if (piece === '') continue;
      const span = element.cloneNode(false);
      if (!(span instanceof HTMLElement)) continue;
      span.textContent = piece;
      created.push(span);
      fragment.append(span);
    }
    element.replaceWith(fragment);
    for (const span of created) {
      if (EVALUATION_BAR_GLYPHS.has(span.textContent ?? '')) tagBar(span);
    }
  }
}

/** Adds semantic hooks without changing the MathLive source or selection map. */
export function decorateExcalifontLayout(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.ML__accent-body').forEach((element) => {
    const accent = ACCENT_BY_GLYPH[element.textContent ?? ''];
    if (accent === undefined) element.removeAttribute('data-excalifont-accent');
    else element.dataset.excalifontAccent = accent;
  });
  root.querySelectorAll<HTMLElement>('.ML__op-symbol').forEach((element) => {
    const glyph = (element.textContent ?? '').trim();
    if (!INTEGRAL_GLYPHS.has(glyph)) {
      element.removeAttribute('data-excalifont-op');
      if (SET_OPERATOR_GLYPHS.has(glyph)) {
        element.dataset.excalifontOpVariant = 'set';
      } else element.removeAttribute('data-excalifont-op-variant');
      return;
    }
    element.dataset.excalifontOp = 'integral';
    const variant = integralVariant(glyph);
    if (variant === undefined) {
      element.removeAttribute('data-excalifont-op-variant');
    } else element.dataset.excalifontOpVariant = variant;
  });
  decorateBars(root);
}

// Built from the glyph table rather than written out beside it, so an accent
// added there cannot be left untagged here.
const accentMarkupPattern = new RegExp(
  `(<span class="ML__accent-body(?: ML__accent-combining-char)?"[^>]*)(>)([${Object.keys(
    ACCENT_BY_GLYPH,
  )
    .map(
      (glyph) =>
        `\\u{${(glyph.codePointAt(0) ?? 0).toString(16).toUpperCase()}}`,
    )
    .join('')}])(</span>)`,
  'gu',
);

/** Adds the same hooks to MathLive's inactive serialized markup. */
export function decorateExcalifontStaticMarkup(markup: string): string {
  return markup
    .replace(
      accentMarkupPattern,
      (_match, opening: string, _end: string, glyph: string, closing: string) =>
        `${opening} data-excalifont-accent="${ACCENT_BY_GLYPH[glyph]}">${glyph}${closing}`,
    )
    .replace(
      /(<span class="ML__op-symbol[^"]*"[^>]*)(>)([∫∬∭∮∯∰])(<\/span>)/g,
      (
        _match,
        opening: string,
        _end: string,
        glyph: string,
        closing: string,
      ) => {
        const variant = integralVariant(glyph);
        const tag =
          variant === undefined
            ? ''
            : ` data-excalifont-op-variant="${variant}"`;
        return `${opening} data-excalifont-op="integral"${tag}>${glyph}${closing}`;
      },
    );
}

/** Light-DOM operator-limit corrections for static Excalifont equations. */
export const EXCALIFONT_OPERATOR_LAYOUT_CSS = `${LOWER_OPERATOR_LIMIT_SELECTOR} {
  position: relative;
  top: ${LOWER_OPERATOR_LIMIT_OFFSET};
}

${UPPER_OPERATOR_LIMIT_SELECTOR} {
  position: relative;
  top: ${UPPER_OPERATOR_LIMIT_OFFSET};
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

${INTEGRAL_SELECTOR} {
  margin-right: ${INTEGRAL_SYMBOL_MARGIN} !important;
  font-size: ${INTEGRAL_SYMBOL_SCALE};
}

${OPERATOR_SYMBOL_SELECTOR} {
  top: ${OPERATOR_SYMBOL_TOP};
}

${WIDE_INTEGRAL_BODY_SELECTOR} {
  margin-right: ${WIDE_INTEGRAL_BODY_GAP};
}

${RAISED_INTEGRAL_SELECTOR} {
  top: calc(${OPERATOR_SYMBOL_TOP} - ${RAISED_INTEGRAL_RISE});
}

${SET_OPERATOR_SELECTOR} {
  top: ${SET_OPERATOR_TOP};
  font-size: ${SET_OPERATOR_SCALE};
  -webkit-text-stroke: ${SET_OPERATOR_STROKE} currentColor;
}

${WIDE_INTEGRAL_SELECTOR} {
  left: ${WIDE_INTEGRAL_SHIFT};
}

${EVALUATION_BAR_SELECTOR} {
  display: inline-block;
  transform: scaleY(${EVALUATION_BAR_SCALE});
}

${PLAIN_BAR_SELECTOR} {
  display: inline-block;
  transform: scaleY(${PLAIN_BAR_SCALE});
}

${MATRIX_BAR_SELECTOR} {
  display: inline-block;
  transform: scaleY(${MATRIX_BAR_SCALE});
}

${OPERATOR_UPPER_LIMIT_SELECTOR} {
  transform: translateY(${OPERATOR_UPPER_LIMIT_RISE});
}

${VECTOR_ACCENT_SELECTOR} {
  left: -0.32em;
  top: -0.02em;
}

${HAT_ACCENT_SELECTOR} {
  position: relative;
  top: -0.05em;
}

${DOT_ACCENT_SELECTOR} {
  position: relative;
  top: ${DOT_ACCENT_RISE};
}

${SINGLE_DOT_ACCENT_SELECTOR} {
  left: ${SINGLE_DOT_ACCENT_SHIFT};
}

${RING_ACCENT_SELECTOR} {
  position: relative;
  left: ${RING_ACCENT_SHIFT};
  top: ${RING_ACCENT_RISE};
}

${DDDOT_ACCENT_SELECTOR} {
  position: relative;
  left: ${DDDOT_ACCENT_SHIFT};
  top: ${DDDOT_ACCENT_DROP};
  font-size: ${DDDOT_ACCENT_SCALE};
}

${DDDDOT_ACCENT_SELECTOR} {
  position: relative;
  left: ${DDDDOT_ACCENT_SHIFT};
  top: ${DDDDOT_ACCENT_DROP};
  font-size: ${DDDDOT_ACCENT_SCALE};
}`;

/** Shadow-DOM operator-limit corrections for active Excalifont fields. */
export const EXCALIFONT_OPERATOR_SHADOW_LAYOUT_CSS = `:host([data-workspace-font='excalifont']) ${LOWER_OPERATOR_LIMIT_SELECTOR} {
  position: relative;
  top: ${LOWER_OPERATOR_LIMIT_OFFSET};
}

:host([data-workspace-font='excalifont']) ${UPPER_OPERATOR_LIMIT_SELECTOR} {
  position: relative;
  top: ${UPPER_OPERATOR_LIMIT_OFFSET};
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

:host([data-workspace-font='excalifont']) ${INTEGRAL_SELECTOR} {
  margin-right: ${INTEGRAL_SYMBOL_MARGIN} !important;
  font-size: ${INTEGRAL_SYMBOL_SCALE};
}

:host([data-workspace-font='excalifont']) ${OPERATOR_SYMBOL_SELECTOR} {
  top: ${OPERATOR_SYMBOL_TOP};
}

:host([data-workspace-font='excalifont']) ${WIDE_INTEGRAL_BODY_SELECTOR} {
  margin-right: ${WIDE_INTEGRAL_BODY_GAP};
}

:host([data-workspace-font='excalifont']) ${RAISED_INTEGRAL_SELECTOR} {
  top: calc(${OPERATOR_SYMBOL_TOP} - ${RAISED_INTEGRAL_RISE});
}

:host([data-workspace-font='excalifont']) ${SET_OPERATOR_SELECTOR} {
  top: ${SET_OPERATOR_TOP};
  font-size: ${SET_OPERATOR_SCALE};
  -webkit-text-stroke: ${SET_OPERATOR_STROKE} currentColor;
}

:host([data-workspace-font='excalifont']) ${WIDE_INTEGRAL_SELECTOR} {
  left: ${WIDE_INTEGRAL_SHIFT};
}

:host([data-workspace-font='excalifont']) ${EVALUATION_BAR_SELECTOR} {
  display: inline-block;
  transform: scaleY(${EVALUATION_BAR_SCALE});
}

:host([data-workspace-font='excalifont']) ${PLAIN_BAR_SELECTOR} {
  display: inline-block;
  transform: scaleY(${PLAIN_BAR_SCALE});
}

:host([data-workspace-font='excalifont']) ${MATRIX_BAR_SELECTOR} {
  display: inline-block;
  transform: scaleY(${MATRIX_BAR_SCALE});
}

:host([data-workspace-font='excalifont']) ${OPERATOR_UPPER_LIMIT_SELECTOR} {
  transform: translateY(${OPERATOR_UPPER_LIMIT_RISE});
}

:host([data-workspace-font='excalifont']) ${VECTOR_ACCENT_SELECTOR} {
  left: -0.32em;
  top: -0.02em;
}

:host([data-workspace-font='excalifont']) ${HAT_ACCENT_SELECTOR} {
  position: relative;
  top: -0.05em;
}

:host([data-workspace-font='excalifont']) ${DOT_ACCENT_SELECTOR} {
  position: relative;
  top: ${DOT_ACCENT_RISE};
}

:host([data-workspace-font='excalifont']) ${SINGLE_DOT_ACCENT_SELECTOR} {
  left: ${SINGLE_DOT_ACCENT_SHIFT};
}

:host([data-workspace-font='excalifont']) ${RING_ACCENT_SELECTOR} {
  position: relative;
  left: ${RING_ACCENT_SHIFT};
  top: ${RING_ACCENT_RISE};
}

:host([data-workspace-font='excalifont']) ${DDDOT_ACCENT_SELECTOR} {
  position: relative;
  left: ${DDDOT_ACCENT_SHIFT};
  top: ${DDDOT_ACCENT_DROP};
  font-size: ${DDDOT_ACCENT_SCALE};
}

:host([data-workspace-font='excalifont']) ${DDDDOT_ACCENT_SELECTOR} {
  position: relative;
  left: ${DDDDOT_ACCENT_SHIFT};
  top: ${DDDDOT_ACCENT_DROP};
  font-size: ${DDDDOT_ACCENT_SCALE};
}`;
