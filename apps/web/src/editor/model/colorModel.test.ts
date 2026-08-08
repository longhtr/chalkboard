/** Covers color normalization/conversion round trips and malformed custom-color storage. */
import { afterEach, describe, expect, it } from 'vitest';

import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  loadCustomColors,
  normalizeHexColor,
  rgbToHex,
} from './colorModel';

afterEach(() => localStorage.clear());

describe('color model', () => {
  it('normalizes supported hex input and rejects malformed values', () => {
    expect(normalizeHexColor(' ABC ')).toBe('#aabbcc');
    expect(normalizeHexColor('#12a4F0')).toBe('#12a4f0');
    expect(normalizeHexColor('#12')).toBeNull();
    expect(normalizeHexColor('not-a-color')).toBeNull();
  });

  it('converts between RGB, HSV, and hex values', () => {
    expect(hexToRgb('#1971c2')).toEqual({ red: 25, green: 113, blue: 194 });
    expect(hexToHsv('#ff0000')).toEqual({
      hue: 0,
      saturation: 100,
      value: 100,
    });
    expect(hsvToHex({ hue: 120, saturation: 100, value: 100 })).toBe('#00ff00');
    expect(hexToHsv('#1971c2')).toEqual({
      hue: 209,
      saturation: 87,
      value: 76,
    });
    expect(hsvToHex(hexToHsv('#1971c2'))).toBe('#1970c2');
    expect(rgbToHex({ red: -1, green: 128.4, blue: 300 })).toBe('#0080ff');
  });

  it('loads only unique, valid, non-default custom colors', () => {
    localStorage.setItem(
      'colors',
      JSON.stringify(['#AABBCC', '#aabbcc', '#ffffff', 'bad', 42]),
    );
    expect(loadCustomColors('colors', ['#ffffff'])).toEqual(['#aabbcc']);

    localStorage.setItem('colors', '{');
    expect(loadCustomColors('colors', [])).toEqual([]);
  });
});
