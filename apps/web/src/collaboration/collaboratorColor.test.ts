/**
 * Locks presence colours to values legible on both board papers, which is what
 * removed the need for a contrast ring around every collaborator selection.
 */
import { describe, expect, it } from 'vitest';

import {
  COLLABORATOR_COLOR_COUNT,
  COLLABORATOR_PALETTE,
  collaboratorColor,
} from './collaboratorColor';

/** Accent tokens from theme.css: light `--accent`, then its dark counterpart. */
const ACCENTS = ['#6965db', '#7b76e8'];
/** Below this the colour reads as application chrome rather than as a person. */
const MINIMUM_ACCENT_HUE_GAP = 35;

function hue(color: string): number {
  const [red, green, blue] = [1, 3, 5].map(
    (offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === min) return 0;
  const span = max - min;
  const degrees =
    max === red
      ? ((green - blue) / span) % 6
      : max === green
        ? (blue - red) / span + 2
        : (red - green) / span + 4;
  return (degrees * 60 + 360) % 360;
}

function hueGap(first: number, second: number): number {
  const difference = Math.abs(first - second);
  return Math.min(difference, 360 - difference);
}

const LIGHT_PAPER = '#fbfaf8';
const DARK_PAPER = '#121212';
/** WCAG minimum for a non-text user-interface component. */
const MINIMUM_CONTRAST = 3;

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const identifiers = Array.from(
  { length: 400 },
  (_, index) =>
    `77e4f7a0-31a8-496c-a0e8-f70f2639${String(index).padStart(4, '0')}`,
);

describe('collaboratorColor', () => {
  it('returns the same colour for the same account every time', () => {
    const first = collaboratorColor('user-ada');
    expect(collaboratorColor('user-ada')).toBe(first);
    expect(collaboratorColor('user-grace')).not.toBe(first);
  });

  it('stays readable against both papers for every account', () => {
    for (const id of identifiers) {
      const color = collaboratorColor(id);
      expect(contrastRatio(color, LIGHT_PAPER)).toBeGreaterThanOrEqual(
        MINIMUM_CONTRAST,
      );
      expect(contrastRatio(color, DARK_PAPER)).toBeGreaterThanOrEqual(
        MINIMUM_CONTRAST,
      );
    }
  });

  it('spreads accounts across the whole palette', () => {
    const used = new Set(identifiers.map(collaboratorColor));
    expect(used.size).toBe(COLLABORATOR_COLOR_COUNT);
  });

  it('keeps every colour clear of the Chalkboard accent hue', () => {
    for (const color of COLLABORATOR_PALETTE) {
      for (const accent of ACCENTS) {
        expect(hueGap(hue(color), hue(accent))).toBeGreaterThanOrEqual(
          MINIMUM_ACCENT_HUE_GAP,
        );
      }
    }
  });

  it('always produces a six-digit hex colour', () => {
    for (const id of ['', 'x', identifiers[0] ?? '']) {
      expect(collaboratorColor(id)).toMatch(/^#[0-9a-f]{6}$/u);
    }
  });
});
