/**
 * Stable presence colours that stay readable on both board papers.
 *
 * A colour derived by hashing straight onto the hue wheel at one fixed
 * lightness is not equally visible at every hue: the same lightness reads as
 * bright yellow and as deep blue, so some accounts landed nearly invisible
 * against one paper or the other. That is what the contrast ring around a
 * selection was compensating for.
 *
 * These ten are chosen as mid-tones instead — dark enough to separate from
 * `--canvas-paper` in the light theme, light enough to separate from it in the
 * dark theme — so a viewer sees a legible colour whichever theme they are in,
 * whatever theme the person who published it was using.
 */
/**
 * No indigo or violet: Chalkboard's own accent is `#6965db` in the light theme
 * and `#7b76e8` in the dark one, both near hue 243. A collaborator wearing that
 * hue reads as application chrome rather than as a person, so the palette keeps
 * a wide berth of it and the wheel is covered from the other side instead.
 */
const COLLABORATOR_COLORS = [
  '#e0575b', // red
  '#c86825', // orange
  '#b08215', // amber
  '#6f8f1e', // lime
  '#4f9d54', // green
  '#2f9e8f', // teal
  '#2f8fbf', // sky
  '#c765b8', // magenta
  '#d95f8c', // pink
] as const;

/** Palette size, so callers and tests do not restate the count. */
export const COLLABORATOR_COLOR_COUNT = COLLABORATOR_COLORS.length;

/** The palette itself, for contrast and hue assertions. */
export const COLLABORATOR_PALETTE: readonly string[] = COLLABORATOR_COLORS;

/**
 * Spreads account identifiers across the palette. UUIDs share most of their
 * alphabet, so a plain character sum clusters; this mixes each character into
 * the accumulator instead.
 */
export function collaboratorColor(userId: string): string {
  let hash = 2166136261;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const bucket = Math.abs(hash) % COLLABORATOR_COLORS.length;
  return COLLABORATOR_COLORS[bucket] ?? COLLABORATOR_COLORS[0];
}
