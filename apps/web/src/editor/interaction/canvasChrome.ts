/**
 * Theme colors for chrome the canvas draws itself — grid dots, selection
 * handles, and the box-selection marquee.
 *
 * Board content is recolored by the CSS inversion filter on the content layers,
 * but the grid and interaction layers sit outside it and so must resolve real
 * colors. Computed style is read once per theme and cached, because these are
 * wanted inside per-frame draw calls.
 */

/** Colors the grid and interaction layers paint with under the active theme. */
export interface CanvasChromeColors {
  accent: string;
  grid: string;
  handle: string;
}

const FALLBACK: CanvasChromeColors = {
  accent: '#6965db',
  grid: '#d7d5d0',
  handle: '#fff',
};

let cache: { colors: CanvasChromeColors; theme: string } | null = null;

/** Resolves canvas chrome colors for the theme on the document element. */
export function canvasChromeColors(): CanvasChromeColors {
  if (typeof document === 'undefined') return FALLBACK;
  const theme = document.documentElement.dataset.theme ?? '';
  if (cache !== null && cache.theme === theme) return cache.colors;

  const styles = getComputedStyle(document.documentElement);
  const read = (property: string, fallback: string): string => {
    const value = styles.getPropertyValue(property).trim();
    return value === '' ? fallback : value;
  };
  const colors: CanvasChromeColors = {
    accent: read('--accent', FALLBACK.accent),
    grid: read('--canvas-grid', FALLBACK.grid),
    handle: read('--canvas-handle', FALLBACK.handle),
  };
  cache = { colors, theme };
  return colors;
}

/** Discards the cached colors so the next draw re-reads computed style. */
export function resetCanvasChromeColors(): void {
  cache = null;
}
