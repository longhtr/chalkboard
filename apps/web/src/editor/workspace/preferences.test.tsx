/** Covers every preference default, malformed stored value, legacy conversion, bound, and persistence effect. */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_LINE_SPACING, DEFAULT_TEXT_SIZE } from '../model/limits';
import {
  loadBezierFitSettings,
  loadGridDotSize,
  loadGridSpacing,
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

    expect(loadBezierFitSettings()).toEqual({
      accuracy: 1,
      continuity: 'c1',
      maxSegments: null,
    });
    expect(loadTextSize()).toBe(DEFAULT_TEXT_SIZE);
    expect(loadLineSpacing()).toBe(DEFAULT_LINE_SPACING);
    expect(loadGridSpacing()).toBe(20);
    expect(loadGridDotSize()).toBe(1);
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
    localStorage.setItem('chalkboard:input-mode', 'math');

    expect(loadBezierFitSettings()).toEqual({
      accuracy: 5,
      continuity: 'c2',
      maxSegments: null,
    });
    expect(loadTextSize()).toBe(48);
    expect(loadLineSpacing()).toBe(1.7);
    expect(loadGridSpacing()).toBe(32);
    expect(loadGridDotSize()).toBe(2);
    expect(loadInputMode()).toBe('math');
  });

  it('persists bounded workspace preference values through one owner', () => {
    renderHook(() =>
      usePreferencePersistence({
        bezierFit: { accuracy: 2, continuity: 'c0', maxSegments: 4 },
        fillColors: ['base', 'transparent', '#abcdef'],
        firstCustomFillColor: 2,
        firstCustomStrokeColor: 1,
        gridDotSize: 2,
        gridSpacing: 30,
        inputMode: 'math',
        lineSpacing: 1.5,
        strokeColors: ['base', '#123456'],
        textSize: 42,
        theme: 'light',
        toolOrder: ['selection', 'shape'],
      }),
    );

    expect(localStorage.getItem('chalkboard:input-mode')).toBe('math');
    expect(localStorage.getItem('chalkboard:text-size')).toBe('42');
    expect(localStorage.getItem('chalkboard:line-spacing')).toBe('1.5');
    expect(localStorage.getItem('chalkboard:grid-spacing')).toBe('30');
    expect(localStorage.getItem('chalkboard:grid-dot-size')).toBe('2');
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
