/** Covers every preference default, malformed stored value, legacy conversion, bound, and persistence effect. */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_LINE_SPACING, DEFAULT_TEXT_SIZE } from '../model/limits';
import {
  loadBezierFitSettings,
  loadGridDotSize,
  loadGridLineOpacity,
  loadGridSpacing,
  loadGridStyle,
  loadGridVisibility,
  loadInputMode,
  loadLineSpacing,
  loadTextSize,
  LOCAL_CUSTOM_COLORS_KEY,
  LOCAL_CUSTOM_FILL_COLORS_KEY,
  usePreferencePersistence,
} from './preferences';

afterEach(() => localStorage.clear());

describe('workspace preferences', () => {
  it('loads defaults for missing or malformed values', () => {
    localStorage.setItem('chalkboard:bezier-fit-v2', '{');
    localStorage.setItem('chalkboard:text-size', '1000');
    localStorage.setItem('chalkboard:line-spacing', 'NaN');
    localStorage.setItem('chalkboard:grid-spacing', '0');
    localStorage.setItem('chalkboard:grid-dot-size', '100');
    localStorage.setItem('chalkboard:grid-line-opacity', '2');
    localStorage.setItem('chalkboard:grid-style', 'crosses');
    localStorage.setItem('chalkboard:grid-visible', 'yes');

    expect(loadBezierFitSettings()).toEqual({
      accuracy: 1,
      continuity: 'c1',
      maxSegments: null,
    });
    expect(loadTextSize()).toBe(DEFAULT_TEXT_SIZE);
    expect(loadLineSpacing()).toBe(DEFAULT_LINE_SPACING);
    expect(loadGridSpacing('light', 'dots')).toBe(20);
    expect(loadGridDotSize('light')).toBe(1);
    expect(loadGridLineOpacity('light')).toBe(0.3);
    expect(loadGridStyle('light')).toBe('dots');
    expect(loadGridVisibility('light')).toBe(false);
    expect(loadInputMode()).toBe('text');
  });

  it('normalizes valid stored settings', () => {
    localStorage.setItem(
      'chalkboard:bezier-fit-v2',
      JSON.stringify({ accuracy: 9, continuity: 'c2', maxSegments: null }),
    );
    localStorage.setItem('chalkboard:text-size', '48');
    localStorage.setItem('chalkboard:line-spacing', '1.7');
    localStorage.setItem('chalkboard:grid-spacing', '32');
    localStorage.setItem('chalkboard:grid-dot-size', '2');
    localStorage.setItem('chalkboard:grid-line-opacity', '0.65');
    localStorage.setItem('chalkboard:grid-style', 'lines');
    localStorage.setItem('chalkboard:grid-visible', 'true');
    localStorage.setItem('chalkboard:input-mode', 'math');

    expect(loadBezierFitSettings()).toEqual({
      accuracy: 5,
      continuity: 'c2',
      maxSegments: null,
    });
    expect(loadTextSize()).toBe(48);
    expect(loadLineSpacing()).toBe(1.7);
    expect(loadGridSpacing('light', 'lines')).toBe(32);
    expect(loadGridDotSize('light')).toBe(2);
    expect(loadGridLineOpacity('light')).toBe(0.65);
    expect(loadGridStyle('light')).toBe('lines');
    expect(loadGridVisibility('light')).toBe(true);
    expect(loadInputMode()).toBe('math');
  });

  it('separates grid values by theme and spacing by style', () => {
    localStorage.setItem('chalkboard:grid-visible:light', 'true');
    localStorage.setItem('chalkboard:grid-visible:dark', 'false');
    localStorage.setItem('chalkboard:grid-style:light', 'lines');
    localStorage.setItem('chalkboard:grid-style:dark', 'dots');
    localStorage.setItem('chalkboard:grid-spacing:light:dots', '24');
    localStorage.setItem('chalkboard:grid-spacing:light:lines', '48');
    localStorage.setItem('chalkboard:grid-spacing:dark:dots', '32');
    localStorage.setItem('chalkboard:grid-spacing:dark:lines', '64');
    localStorage.setItem('chalkboard:grid-dot-size:light', '1.25');
    localStorage.setItem('chalkboard:grid-dot-size:dark', '2.25');
    localStorage.setItem('chalkboard:grid-line-opacity:light', '0.4');
    localStorage.setItem('chalkboard:grid-line-opacity:dark', '0.8');

    expect(loadGridVisibility('light')).toBe(true);
    expect(loadGridVisibility('dark')).toBe(false);
    expect(loadGridStyle('light')).toBe('lines');
    expect(loadGridStyle('dark')).toBe('dots');
    expect(loadGridSpacing('light', 'dots')).toBe(24);
    expect(loadGridSpacing('light', 'lines')).toBe(48);
    expect(loadGridSpacing('dark', 'dots')).toBe(32);
    expect(loadGridSpacing('dark', 'lines')).toBe(64);
    expect(loadGridDotSize('light')).toBe(1.25);
    expect(loadGridDotSize('dark')).toBe(2.25);
    expect(loadGridLineOpacity('light')).toBe(0.4);
    expect(loadGridLineOpacity('dark')).toBe(0.8);
  });

  it('persists bounded workspace preference values through one owner', () => {
    renderHook(() =>
      usePreferencePersistence({
        bezierFit: { accuracy: 2, continuity: 'c0', maxSegments: 4 },
        fillColors: ['base', 'transparent', '#abcdef'],
        firstCustomFillColor: 2,
        firstCustomStrokeColor: 1,
        gridDotSize: 2,
        gridLineOpacity: 0.55,
        gridSpacing: 30,
        gridStyle: 'lines',
        inputMode: 'math',
        lineSpacing: 1.5,
        showGrid: true,
        strokeColors: ['base', '#123456'],
        textSize: 42,
        theme: 'light',
        toolOrder: ['selection', 'shape'],
      }),
    );

    expect(localStorage.getItem('chalkboard:input-mode')).toBe('math');
    expect(localStorage.getItem('chalkboard:text-size')).toBe('42');
    expect(localStorage.getItem('chalkboard:line-spacing')).toBe('1.5');
    expect(localStorage.getItem('chalkboard:grid-spacing:light:lines')).toBe(
      '30',
    );
    expect(localStorage.getItem('chalkboard:grid-dot-size:light')).toBe('2');
    expect(localStorage.getItem('chalkboard:grid-line-opacity:light')).toBe(
      '0.55',
    );
    expect(localStorage.getItem('chalkboard:grid-style:light')).toBe('lines');
    expect(localStorage.getItem('chalkboard:grid-visible:light')).toBe('true');
    expect(localStorage.getItem('chalkboard:bezier-fit-v2')).toBe(
      JSON.stringify({ accuracy: 2, continuity: 'c0', maxSegments: 4 }),
    );
    // Custom colors persist under a theme-scoped key so the light and dark
    // palettes cannot overwrite one another.
    expect(localStorage.getItem(`${LOCAL_CUSTOM_COLORS_KEY}:light`)).toBe(
      JSON.stringify(['#123456']),
    );
    expect(localStorage.getItem(`${LOCAL_CUSTOM_FILL_COLORS_KEY}:light`)).toBe(
      JSON.stringify(['#abcdef']),
    );
  });
});
