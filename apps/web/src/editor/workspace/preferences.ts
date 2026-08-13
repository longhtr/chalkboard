/**
 * Validates workspace UI preferences at the localStorage boundary and persists
 * only bounded values. Preferences affect future interaction, not board authority.
 */
import { useEffect } from 'react';

import type { ColorTheme } from '@chalkboard/shared';

import { bestEffortLocalStorage } from '../../bestEffortStorage';
import { loadCustomColors } from '../model/colorModel';
import type { BezierFitSettings } from '../interaction/drawingInteraction';
import type { GridStyle } from '../interaction/rendering';
import {
  DEFAULT_LINE_SPACING,
  DEFAULT_TEXT_SIZE,
  MAX_GRID_DOT_SIZE,
  MAX_GRID_SPACING,
  MAX_LINE_SPACING,
  MAX_TEXT_SIZE,
  MIN_GRID_DOT_SIZE,
  MIN_GRID_SPACING,
  MIN_LINE_SPACING,
  MIN_TEXT_SIZE,
} from '../model/limits';
import { LOCAL_TOOL_ORDER_KEY } from '../interaction/toolOrder';
import type { Tool } from '../interaction/toolModel';

/** Default hard curve cap when automatic accuracy fitting is disabled. */
export const DEFAULT_MANUAL_BEZIER_MAX_SEGMENTS = 4;
const DEFAULT_AUTO_BEZIER_ACCURACY = 1;
const DEFAULT_BEZIER_FIT_SETTINGS: BezierFitSettings = {
  accuracy: DEFAULT_AUTO_BEZIER_ACCURACY,
  continuity: 'c1',
  maxSegments: null,
};
const DEFAULT_GRID_SPACING = 20;
const DEFAULT_GRID_DOT_SIZE = 1;
const DEFAULT_GRID_LINE_OPACITY = 0.3;

const LOCAL_INPUT_MODE_KEY = 'chalkboard:input-mode';
/** Disposable preference key for custom stroke/text colors. */
export const LOCAL_CUSTOM_COLORS_KEY = 'chalkboard:custom-colors';
/** Disposable preference key for custom fill colors. */
export const LOCAL_CUSTOM_FILL_COLORS_KEY = 'chalkboard:custom-fill-colors';
const LOCAL_TEXT_SIZE_KEY = 'chalkboard:text-size';
const LOCAL_LINE_SPACING_KEY = 'chalkboard:line-spacing';
const LOCAL_GRID_SPACING_KEY = 'chalkboard:grid-spacing';
const LOCAL_GRID_DOT_SIZE_KEY = 'chalkboard:grid-dot-size';
const LOCAL_GRID_LINE_OPACITY_KEY = 'chalkboard:grid-line-opacity';
const LOCAL_GRID_STYLE_KEY = 'chalkboard:grid-style';
const LOCAL_GRID_VISIBLE_KEY = 'chalkboard:grid-visible';
const LOCAL_BEZIER_FIT_KEY = 'chalkboard:bezier-fit-v2';

/** Builds a theme-specific grid key, optionally scoped to one rendering style. */
function gridPreferenceKey(
  key: string,
  theme: ColorTheme,
  style?: GridStyle,
): string {
  return style === undefined ? `${key}:${theme}` : `${key}:${theme}:${style}`;
}

/**
 * Reads scoped grid state. Legacy unscoped values belong to Light so existing
 * preferences survive without coupling future Light and Dark changes.
 */
function readGridPreference(
  key: string,
  theme: ColorTheme,
  style?: GridStyle,
): string | null {
  const scoped = bestEffortLocalStorage.getItem(
    gridPreferenceKey(key, theme, style),
  );
  if (scoped !== null) return scoped;
  return theme === 'light' ? bestEffortLocalStorage.getItem(key) : null;
}

/** Reads and validates curve-fitting preferences with safe defaults. */
export function loadBezierFitSettings(): BezierFitSettings {
  try {
    const value: unknown = JSON.parse(
      bestEffortLocalStorage.getItem(LOCAL_BEZIER_FIT_KEY) ?? 'null',
    );
    if (typeof value !== 'object' || value === null) {
      return { ...DEFAULT_BEZIER_FIT_SETTINGS };
    }
    const accuracy =
      ('accuracy' in value ? value.accuracy : undefined) ??
      ('detail' in value ? value.detail : undefined);
    const continuity = 'continuity' in value ? value.continuity : undefined;
    const maxSegments = 'maxSegments' in value ? value.maxSegments : undefined;
    return {
      accuracy:
        typeof accuracy === 'number' && Number.isInteger(accuracy)
          ? Math.min(5, Math.max(1, accuracy))
          : DEFAULT_BEZIER_FIT_SETTINGS.accuracy,
      continuity:
        continuity === 'c0' || continuity === 'c1' || continuity === 'c2'
          ? continuity
          : DEFAULT_BEZIER_FIT_SETTINGS.continuity,
      maxSegments:
        maxSegments === null ||
        (typeof maxSegments === 'number' &&
          Number.isInteger(maxSegments) &&
          maxSegments >= 1 &&
          maxSegments <= 12)
          ? maxSegments
          : DEFAULT_BEZIER_FIT_SETTINGS.maxSegments,
    };
  } catch {
    return { ...DEFAULT_BEZIER_FIT_SETTINGS };
  }
}

/** Reads a bounded default rendered text size. */
export function loadTextSize(): number {
  const value = Number(bestEffortLocalStorage.getItem(LOCAL_TEXT_SIZE_KEY));
  return Number.isInteger(value) &&
    value >= MIN_TEXT_SIZE &&
    value <= MAX_TEXT_SIZE
    ? value
    : DEFAULT_TEXT_SIZE;
}

/** Reads a bounded default equation line-spacing multiplier. */
export function loadLineSpacing(): number {
  const value = Number(bestEffortLocalStorage.getItem(LOCAL_LINE_SPACING_KEY));
  return Number.isFinite(value) &&
    value >= MIN_LINE_SPACING &&
    value <= MAX_LINE_SPACING
    ? value
    : DEFAULT_LINE_SPACING;
}

/** Reads one theme and grid style's bounded world-space interval. */
export function loadGridSpacing(theme: ColorTheme, style: GridStyle): number {
  const value = Number(
    readGridPreference(LOCAL_GRID_SPACING_KEY, theme, style),
  );
  return Number.isInteger(value) &&
    value >= MIN_GRID_SPACING &&
    value <= MAX_GRID_SPACING
    ? value
    : DEFAULT_GRID_SPACING;
}

/** Reads one theme's bounded line-grid opacity between 10% and 100%. */
export function loadGridLineOpacity(theme: ColorTheme): number {
  const value = Number(readGridPreference(LOCAL_GRID_LINE_OPACITY_KEY, theme));
  return Number.isFinite(value) && value >= 0.1 && value <= 1
    ? value
    : DEFAULT_GRID_LINE_OPACITY;
}

/** Reads whether the canvas grid was visible for one theme. */
export function loadGridVisibility(theme: ColorTheme): boolean {
  return readGridPreference(LOCAL_GRID_VISIBLE_KEY, theme) === 'true';
}

/** Reads one theme's selected grid style, preserving dots as the default. */
export function loadGridStyle(theme: ColorTheme): GridStyle {
  return readGridPreference(LOCAL_GRID_STYLE_KEY, theme) === 'lines'
    ? 'lines'
    : 'dots';
}

/** Reads one theme's bounded default grid-dot radius. */
export function loadGridDotSize(theme: ColorTheme): number {
  const value = Number(readGridPreference(LOCAL_GRID_DOT_SIZE_KEY, theme));
  return Number.isFinite(value) &&
    value >= MIN_GRID_DOT_SIZE &&
    value <= MAX_GRID_DOT_SIZE
    ? value
    : DEFAULT_GRID_DOT_SIZE;
}

/** Reads the last selected mixed-text input mode. */
export function loadInputMode(): 'math' | 'text' {
  return bestEffortLocalStorage.getItem(LOCAL_INPUT_MODE_KEY) === 'math'
    ? 'math'
    : 'text';
}

/** Storage key for one theme's custom colors, so palettes never mix. */
function themeColorKey(key: string, theme: ColorTheme): string {
  return `${key}:${theme}`;
}

/**
 * Builds each theme's full swatch list: its authored defaults plus the custom
 * colors saved for that theme. Colors saved under the pre-theme key are read
 * as the light palette so existing custom swatches survive the upgrade.
 */
export function loadThemePalettes(
  key: string,
  defaultsByTheme: Record<ColorTheme, readonly string[]>,
  leading: readonly string[] = [],
): Record<ColorTheme, string[]> {
  const build = (theme: ColorTheme): string[] => {
    const defaults = defaultsByTheme[theme];
    const scoped = loadCustomColors(themeColorKey(key, theme), defaults);
    const legacy = theme === 'light' ? loadCustomColors(key, defaults) : [];
    return [...leading, ...defaults, ...new Set([...scoped, ...legacy])];
  };
  return { dark: build('dark'), light: build('light') };
}

interface PreferenceState {
  bezierFit: BezierFitSettings;
  fillColors: readonly string[];
  firstCustomFillColor: number;
  firstCustomStrokeColor: number;
  gridDotSize: number;
  gridLineOpacity: number;
  gridSpacing: number;
  gridStyle: GridStyle;
  inputMode: 'math' | 'text';
  lineSpacing: number;
  showGrid: boolean;
  strokeColors: readonly string[];
  textSize: number;
  /** Theme the palettes belong to; custom colors persist per theme. */
  theme: ColorTheme;
  toolOrder: readonly Tool[];
}

/** Persists current editor preferences as disposable best-effort state. */
export function usePreferencePersistence({
  bezierFit,
  fillColors,
  firstCustomFillColor,
  firstCustomStrokeColor,
  gridDotSize,
  gridLineOpacity,
  gridSpacing,
  gridStyle,
  inputMode,
  lineSpacing,
  showGrid,
  strokeColors,
  textSize,
  theme,
  toolOrder,
}: PreferenceState): void {
  useEffect(() => {
    bestEffortLocalStorage.setItem(LOCAL_INPUT_MODE_KEY, inputMode);
  }, [inputMode]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      LOCAL_TOOL_ORDER_KEY,
      JSON.stringify(toolOrder),
    );
  }, [toolOrder]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(LOCAL_TEXT_SIZE_KEY, String(textSize));
  }, [textSize]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(LOCAL_LINE_SPACING_KEY, String(lineSpacing));
  }, [lineSpacing]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      gridPreferenceKey(LOCAL_GRID_SPACING_KEY, theme, gridStyle),
      String(gridSpacing),
    );
  }, [gridSpacing, gridStyle, theme]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      gridPreferenceKey(LOCAL_GRID_DOT_SIZE_KEY, theme),
      String(gridDotSize),
    );
  }, [gridDotSize, theme]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      gridPreferenceKey(LOCAL_GRID_LINE_OPACITY_KEY, theme),
      String(gridLineOpacity),
    );
  }, [gridLineOpacity, theme]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      gridPreferenceKey(LOCAL_GRID_STYLE_KEY, theme),
      gridStyle,
    );
  }, [gridStyle, theme]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      gridPreferenceKey(LOCAL_GRID_VISIBLE_KEY, theme),
      String(showGrid),
    );
  }, [showGrid, theme]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      LOCAL_BEZIER_FIT_KEY,
      JSON.stringify(bezierFit),
    );
  }, [bezierFit]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      themeColorKey(LOCAL_CUSTOM_COLORS_KEY, theme),
      JSON.stringify(strokeColors.slice(firstCustomStrokeColor)),
    );
  }, [firstCustomStrokeColor, strokeColors, theme]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      themeColorKey(LOCAL_CUSTOM_FILL_COLORS_KEY, theme),
      JSON.stringify(fillColors.slice(firstCustomFillColor)),
    );
  }, [fillColors, firstCustomFillColor, theme]);
}
