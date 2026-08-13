/** Adds presentation-only styles and line wrappers to already-sanitized static MathLive markup. */
import {
  isTextColorMarker,
  MATHLIVE_LINE_BREAK,
  MATHLIVE_LITERAL_BACKSLASH,
  MATHLIVE_LITERAL_DOLLAR,
  textColorForMarker,
} from './mixedMath';

/** Adds literal/style markers and base-color metadata to sanitized static markup. */
export function decorateStaticMathMarkup(
  container: HTMLElement,
  options: { baseColor: string; hasTextColors: boolean },
): void {
  const { baseColor, hasTextColors } = options;
  container.querySelectorAll('.ML__text').forEach((node) => {
    if (node.children.length > 0) return;
    const text = node.textContent ?? '';
    if (
      !text.includes(MATHLIVE_LINE_BREAK) &&
      !text.includes(MATHLIVE_LITERAL_BACKSLASH) &&
      !text.includes(MATHLIVE_LITERAL_DOLLAR) &&
      ![...text].some(isTextColorMarker)
    ) {
      return;
    }
    if (text === MATHLIVE_LINE_BREAK) {
      node.classList.add('mixed-text-line-break');
      return;
    }
    if (text === MATHLIVE_LITERAL_DOLLAR) {
      node.classList.add('mixed-text-literal-dollar');
      return;
    }
    if (text === MATHLIVE_LITERAL_BACKSLASH) {
      node.classList.add('mixed-text-literal-backslash');
      return;
    }
    if (isTextColorMarker(text)) {
      node.classList.add('mixed-text-color-marker');
      return;
    }

    const fragment = document.createDocumentFragment();
    node.textContent
      ?.split(
        new RegExp(
          `([${MATHLIVE_LINE_BREAK}${MATHLIVE_LITERAL_DOLLAR}${MATHLIVE_LITERAL_BACKSLASH}\\u200B\\u200C\\u2060-\\u2062])`,
        ),
      )
      .forEach((value) => {
        if (value === '') return;
        const textNode = node.cloneNode(false);
        if (!(textNode instanceof HTMLElement)) return;
        textNode.textContent = value;
        if (value === MATHLIVE_LINE_BREAK) {
          textNode.classList.add('mixed-text-line-break');
        } else if (value === MATHLIVE_LITERAL_DOLLAR) {
          textNode.classList.add('mixed-text-literal-dollar');
        } else if (value === MATHLIVE_LITERAL_BACKSLASH) {
          textNode.classList.add('mixed-text-literal-backslash');
        } else if (isTextColorMarker(value)) {
          textNode.classList.add('mixed-text-color-marker');
        }
        fragment.append(textNode);
      });
    node.replaceWith(fragment);
  });

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
