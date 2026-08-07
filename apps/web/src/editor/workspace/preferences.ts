/**
 * Validates workspace UI preferences at the localStorage boundary and persists
 * only bounded values. Preferences affect future interaction, not board authority.
 */
import { useEffect } from 'react';

import { bestEffortLocalStorage } from '../../bestEffortStorage';
import type { BezierFitSettings } from '../interaction/drawingInteraction';
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

const LOCAL_INPUT_MODE_KEY = 'chalkboard:input-mode';
/** Disposable preference key for custom stroke/text colors. */
export const LOCAL_CUSTOM_COLORS_KEY = 'chalkboard:custom-colors';
/** Disposable preference key for custom fill colors. */
export const LOCAL_CUSTOM_FILL_COLORS_KEY = 'chalkboard:custom-fill-colors';
const LOCAL_TEXT_SIZE_KEY = 'chalkboard:text-size';
const LOCAL_LINE_SPACING_KEY = 'chalkboard:line-spacing';
const LOCAL_GRID_SPACING_KEY = 'chalkboard:grid-spacing';
const LOCAL_GRID_DOT_SIZE_KEY = 'chalkboard:grid-dot-size';
const LOCAL_BEZIER_FIT_KEY = 'chalkboard:bezier-fit-v2';

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

/** Reads a bounded default world-space grid interval. */
export function loadGridSpacing(): number {
  const value = Number(bestEffortLocalStorage.getItem(LOCAL_GRID_SPACING_KEY));
  return Number.isInteger(value) &&
    value >= MIN_GRID_SPACING &&
    value <= MAX_GRID_SPACING
    ? value
    : DEFAULT_GRID_SPACING;
}

/** Reads a bounded default grid-dot radius. */
export function loadGridDotSize(): number {
  const value = Number(bestEffortLocalStorage.getItem(LOCAL_GRID_DOT_SIZE_KEY));
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

interface PreferenceState {
  bezierFit: BezierFitSettings;
  fillColors: readonly string[];
  firstCustomFillColor: number;
  firstCustomStrokeColor: number;
  gridDotSize: number;
  gridSpacing: number;
  inputMode: 'math' | 'text';
  lineSpacing: number;
  strokeColors: readonly string[];
  textSize: number;
  toolOrder: readonly Tool[];
}

/** Persists current editor preferences as disposable best-effort state. */
export function usePreferencePersistence({
  bezierFit,
  fillColors,
  firstCustomFillColor,
  firstCustomStrokeColor,
  gridDotSize,
  gridSpacing,
  inputMode,
  lineSpacing,
  strokeColors,
  textSize,
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
    bestEffortLocalStorage.setItem(LOCAL_GRID_SPACING_KEY, String(gridSpacing));
  }, [gridSpacing]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      LOCAL_GRID_DOT_SIZE_KEY,
      String(gridDotSize),
    );
  }, [gridDotSize]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      LOCAL_BEZIER_FIT_KEY,
      JSON.stringify(bezierFit),
    );
  }, [bezierFit]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      LOCAL_CUSTOM_COLORS_KEY,
      JSON.stringify(strokeColors.slice(firstCustomStrokeColor)),
    );
  }, [firstCustomStrokeColor, strokeColors]);
  useEffect(() => {
    bestEffortLocalStorage.setItem(
      LOCAL_CUSTOM_FILL_COLORS_KEY,
      JSON.stringify(fillColors.slice(firstCustomFillColor)),
    );
  }, [fillColors, firstCustomFillColor]);
}
