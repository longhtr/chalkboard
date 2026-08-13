/** Adds presentation-only styles and line wrappers to already-sanitized static MathLive markup. */
import { decorateExcalifontLayout } from './excalifontLayout';
import { applyLineClearance } from './lineClearance';
import {
  isTextColorMarker,
  MATHLIVE_LINE_BREAK,
  MATHLIVE_BARE_DOLLAR,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_BRACE_LEFT,
  MATHLIVE_LITERAL_BRACE_RIGHT,
  MATHLIVE_LITERAL_DOLLAR,
  MATHLIVE_LITERAL_PERCENT,
  TEXT_COLOR_MARKER_CLASS,
  textColorForMarker,
} from './mixedMath';

/**
 * One table drives both the split and the class, so a sentinel cannot be added
 * to the source encoding and silently left undecorated here.
 */
const SENTINEL_CLASSES = new Map([
  [MATHLIVE_LINE_BREAK, 'mixed-text-line-break'],
  [MATHLIVE_LITERAL_DOLLAR, 'mixed-text-literal-dollar'],
  [MATHLIVE_BARE_DOLLAR, 'mixed-text-literal-dollar'],
  [MATHLIVE_LITERAL_BACKSLASH, 'mixed-text-literal-backslash'],
  [MATHLIVE_LITERAL_BRACE_LEFT, 'mixed-text-literal-brace-left'],
  [MATHLIVE_LITERAL_BRACE_RIGHT, 'mixed-text-literal-brace-right'],
  [MATHLIVE_LITERAL_PERCENT, 'mixed-text-literal-percent'],
]);

const SENTINELS = [...SENTINEL_CLASSES.keys()].join('');

function sentinelClass(value: string): string | undefined {
  return (
    SENTINEL_CLASSES.get(value) ??
    (isTextColorMarker(value) ? 'mixed-text-color-marker' : undefined)
  );
}

/** Adds literal/style markers and base-color metadata to sanitized static markup. */
export function decorateStaticMathMarkup(
  container: HTMLElement,
  options: { baseColor: string; hasTextColors: boolean; scale?: number },
): void {
  const { baseColor, hasTextColors, scale = 1 } = options;
  // The same glyph-level hooks the active field gets. Tagging in the DOM covers
  // what a regex over serialized markup cannot reach, such as a stacked
  // delimiter whose identity is the glyph repeated inside it.
  decorateExcalifontLayout(container);
  container.querySelectorAll('.ML__text').forEach((node) => {
    if (node.children.length > 0) return;
    const text = node.textContent ?? '';
    if (![...text].some((value) => sentinelClass(value) !== undefined)) return;

    const whole = sentinelClass(text);
    if (whole !== undefined && [...text].length === 1) {
      node.classList.add(whole);
      return;
    }

    const fragment = document.createDocumentFragment();
    node.textContent
      ?.split(new RegExp(`([${SENTINELS}${TEXT_COLOR_MARKER_CLASS}])`, 'u'))
      .forEach((value) => {
        if (value === '') return;
        const textNode = node.cloneNode(false);
        if (!(textNode instanceof HTMLElement)) return;
        textNode.textContent = value;
        const className = sentinelClass(value);
        if (className !== undefined) textNode.classList.add(className);
        fragment.append(textNode);
      });
    node.replaceWith(fragment);
  });

  // After the break spans exist and carry their class, since the clearance is
  // measured between them.
  applyLineClearance(container, scale);

  if (!hasTextColors) return;
  const needsColorDecoration =
    container.querySelector(
      '.mixed-text-color-marker, [data-mixed-text-native-color]',
    ) !== null ||
    [...container.querySelectorAll<HTMLElement>('[style]')].some(
      (element) =>
        element.style.color !== '' &&
        element.style.getPropertyValue('--run-color') === '',
    );
  if (!needsColorDecoration) return;
  const applyColors = (parent: Element, inheritedColor: string): string => {
    let activeColor = inheritedColor;
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement)) continue;
      const markerColor = textColorForMarker(child.textContent ?? '');
      if (
        markerColor !== undefined &&
        child.classList.contains('mixed-text-color-marker')
      ) {
        activeColor = markerColor;
        continue;
      }
      let scopedColor = child.dataset.mixedTextNativeColor;
      if (
        scopedColor === undefined &&
        !child.classList.contains('mixed-text-element__content') &&
        !child.classList.contains('math-element__content') &&
        child.style.color !== '' &&
        child.style.getPropertyValue('--run-color') === ''
      ) {
        scopedColor = child.style.color;
        child.dataset.mixedTextNativeColor = scopedColor;
      }
      if (scopedColor !== undefined) {
        child.style.color = scopedColor;
        child.style.setProperty('--run-color', scopedColor);
        applyColors(child, scopedColor);
        continue;
      }
      child.style.color = activeColor;
      child.style.setProperty('--run-color', activeColor);
      activeColor = applyColors(child, activeColor);
    }
    return activeColor;
  };
  applyColors(container, baseColor);
}
