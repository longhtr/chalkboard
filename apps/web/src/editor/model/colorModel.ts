/**
 * Pure hex/RGB/HSV conversion plus validated custom-color preference loading.
 * Invalid stored colors are ignored rather than entering board style state.
 */
import { bestEffortLocalStorage } from '../../bestEffortStorage';

/** Hue, saturation, and value color channels used by the custom picker. */
export interface HsvColor {
  hue: number;
  saturation: number;
  value: number;
}

/** Eight-bit red, green, and blue color channels. */
export interface RgbColor {
  blue: number;
  green: number;
  red: number;
}

/** Reads unique valid hexadecimal colors from disposable preference storage. */
export function loadCustomColors(
  key: string,
  defaultColors: readonly string[],
): string[] {
  try {
    const value: unknown = JSON.parse(
      bestEffortLocalStorage.getItem(key) ?? '[]',
    );
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .filter(
            (color): color is string =>
              typeof color === 'string' && /^#[\da-f]{6}$/i.test(color),
          )
          .map((color) => color.toLowerCase())
          .filter((color) => !defaultColors.includes(color)),
      ),
    ];
  } catch {
    return [];
  }
}

/** Expands valid short/long hexadecimal input to lowercase six-digit form. */
export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const short = normalized.match(/^#?([\da-f])([\da-f])([\da-f])$/i);
  if (short !== null) {
    return `#${short
      .slice(1)
      .map((component) => `${component}${component}`)
      .join('')}`;
  }
  const full = normalized.match(/^#?([\da-f]{6})$/i);
  return full === null ? null : `#${full[1]}`;
}

/** Converts picker channels to normalized hexadecimal RGB. */
export function hsvToHex({ hue, saturation, value }: HsvColor): string {
  const h = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const v = value / 100;
  const chroma = v * s;
  const segment = h / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] =
    segment < 1
      ? [chroma, x, 0]
      : segment < 2
        ? [x, chroma, 0]
        : segment < 3
          ? [0, chroma, x]
          : segment < 4
            ? [0, x, chroma]
            : segment < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const match = v - chroma;
  return `#${[red, green, blue]
    .map((component) =>
      Math.round((component + match) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Converts a valid normalized hexadecimal color to eight-bit RGB channels. */
export function hexToRgb(color: string): RgbColor {
  const normalized = normalizeHexColor(color) ?? '#f59f00';
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

/** Clamps eight-bit RGB channels and encodes normalized hexadecimal color. */
export function rgbToHex({ red, green, blue }: RgbColor): string {
  return `#${[red, green, blue]
    .map((component) =>
      Math.min(255, Math.max(0, Math.round(component)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Converts a valid normalized hexadecimal color to picker channels. */
export function hexToHsv(color: string): HsvColor {
  const normalized = normalizeHexColor(color) ?? '#f59f00';
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    hue: Math.round((hue + 360) % 360),
    saturation: maximum === 0 ? 0 : Math.round((delta / maximum) * 100),
    value: Math.round(maximum * 100),
  };
}
