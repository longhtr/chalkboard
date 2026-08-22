/**
 * Per-theme element colors.
 *
 * An element stores its light colors in `strokeColor`/`backgroundColor` and its
 * dark colors in the optional `*Dark` siblings. The dark fields are optional on
 * purpose: a board authored before this feature — or by an older client — has
 * only the light value, and resolving falls back to a derived counterpart
 * rather than rewriting the document. Nothing is persisted until the viewer
 * actually picks a color for that theme, so opening a board never dirties it
 * and never triggers a sync.
 *
 * Keeping `strokeColor` as the light value also keeps the wire format
 * backward compatible: an older client reading a board authored here still
 * finds the color it expects instead of failing validation.
 */
import type { ElementStyle } from './elementSchema.js';

/** The themes an element can carry separate colors for. */
export type ColorTheme = 'dark' | 'light';

/** Fill value meaning "no fill"; it is theme-independent and never derived. */
export const TRANSPARENT_FILL = 'transparent';

/**
 * Lightness floors that keep a derived color legible against its own theme's
 * paper. Flipping lightness alone leaves mid-tones (a 54%-lightness red) almost
 * unchanged, which would read as unmodified on the opposite background.
 */
const MIN_DARK_LIGHTNESS = 0.55;
const MAX_LIGHT_LIGHTNESS = 0.55;

interface Hsl {
  hue: number;
  lightness: number;
  saturation: number;
}

function parseHex(color: string): [number, number, number] | null {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(color.trim());
  if (match === null) return null;
  const digits = match[1] as string;
  const full =
    digits.length === 3
      ? [...digits].map((digit) => `${digit}${digit}`).join('')
      : digits;
  return [
    Number.parseInt(full.slice(0, 2), 16) / 255,
    Number.parseInt(full.slice(2, 4), 16) / 255,
    Number.parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function rgbToHsl(red: number, green: number, blue: number): Hsl {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (delta === 0) return { hue: 0, lightness, saturation: 0 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  return { hue: ((hue % 360) + 360) % 360, lightness, saturation };
}

function hslToHex({ hue, lightness, saturation }: Hsl): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
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
  const match = lightness - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round((channel + match) * 255)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * Adapts a color authored for one theme to the other by flipping its lightness
 * while preserving hue and saturation, so a red stays recognisably the same red
 * rather than becoming its complement. Values that are not plain hexadecimal —
 * `transparent` above all — are returned unchanged.
 */
export function deriveThemeColor(color: string, target: ColorTheme): string {
  const rgb = parseHex(color);
  if (rgb === null) return color;
  const { hue, lightness, saturation } = rgbToHsl(...rgb);
  const flipped = 1 - lightness;
  const adjusted =
    target === 'dark'
      ? Math.max(flipped, MIN_DARK_LIGHTNESS)
      : Math.min(flipped, MAX_LIGHT_LIGHTNESS);
  return hslToHex({ hue, lightness: adjusted, saturation });
}

/** Stroke color to draw an element with under the given theme. */
export function resolveStrokeColor(
  style: Pick<ElementStyle, 'strokeColor' | 'strokeColorDark'>,
  theme: ColorTheme,
): string {
  if (theme === 'light') return style.strokeColor;
  return style.strokeColorDark ?? deriveThemeColor(style.strokeColor, 'dark');
}

/** Fill color to draw an element with under the given theme. */
export function resolveBackgroundColor(
  style: Pick<ElementStyle, 'backgroundColor' | 'backgroundColorDark'>,
  theme: ColorTheme,
): string {
  if (theme === 'light') return style.backgroundColor;
  // An explicit dark value wins even when the light fill is transparent: fill
  // choices belong to each theme independently. Only an absent dark value
  // inherits the light theme's no-fill state.
  if (style.backgroundColorDark !== undefined) {
    return style.backgroundColorDark;
  }
  if (style.backgroundColor === TRANSPARENT_FILL) return TRANSPARENT_FILL;
  return deriveThemeColor(style.backgroundColor, 'dark');
}

/** The style field a color edit writes to, given the theme being edited in. */
export function strokeColorField(
  theme: ColorTheme,
): 'strokeColor' | 'strokeColorDark' {
  return theme === 'dark' ? 'strokeColorDark' : 'strokeColor';
}

/** The fill field a color edit writes to, given the theme being edited in. */
export function backgroundColorField(
  theme: ColorTheme,
): 'backgroundColor' | 'backgroundColorDark' {
  return theme === 'dark' ? 'backgroundColorDark' : 'backgroundColor';
}
