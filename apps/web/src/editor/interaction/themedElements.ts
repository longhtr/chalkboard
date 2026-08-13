/**
 * Resolves per-theme element colors at the single boundary where board
 * elements enter rendering and export.
 *
 * Downstream drawing code keeps reading `strokeColor`/`backgroundColor`, so
 * projecting the active theme's values into those fields here means the canvas,
 * SVG, DOM, and export paths need no theme parameter of their own. The
 * projection is display-only — it never reaches persistence, because the
 * document keeps both colors and this result is rebuilt on every read.
 */
import {
  resolveBackgroundColor,
  resolveStrokeColor,
  type BoardElement,
  type ColorTheme,
} from '@chalkboard/shared';

/**
 * Projects one element's colors for the given theme. Light is the identity
 * case: the light values already live in the base fields.
 */
export function themedElement<Element extends BoardElement>(
  element: Element,
  theme: ColorTheme,
): Element {
  if (theme === 'light') return element;
  return {
    ...element,
    backgroundColor: resolveBackgroundColor(element, theme),
    strokeColor: resolveStrokeColor(element, theme),
  };
}

/**
 * Projects a list of elements. The light theme returns the original array by
 * reference so downstream memoization sees no change at all.
 */
export function themedElements(
  elements: readonly BoardElement[],
  theme: ColorTheme,
): readonly BoardElement[] {
  if (theme === 'light') return elements;
  return elements.map((element) => themedElement(element, theme));
}
