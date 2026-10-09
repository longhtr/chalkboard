/**
 * Admission boundary for untrusted image bytes. Signature, container geometry,
 * pixel/byte limits, filename, media type, and SVG resource safety are checked
 * before the asset service can persist anything.
 */
import { MAX_ASSET_BYTES } from '@chalkboard/shared';

import { rasterDimensions } from './rasterValidation.js';

export { MAX_ASSET_BYTES } from '@chalkboard/shared';
const MAX_ASSET_DIMENSION = 16_384;
const MAX_ASSET_PIXELS = 64_000_000;
/** Exact media types with implemented signature and dimension validators. */
export const SUPPORTED_ASSET_MEDIA_TYPES = [
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
] as const;

type AssetMediaType = (typeof SUPPORTED_ASSET_MEDIA_TYPES)[number];

function isAssetMediaType(value: string): value is AssetMediaType {
  return SUPPORTED_ASSET_MEDIA_TYPES.some((candidate) => candidate === value);
}

/** Expected rejection of malformed, unsafe, or over-limit image input. */
export class AssetValidationError extends Error {}

/** Fully admitted image bytes and normalized metadata safe for persistence. */
export interface ValidatedAsset {
  content: Buffer;
  height: number;
  mediaType: AssetMediaType;
  name: string;
  width: number;
}

function svgDimensions(
  content: Buffer,
): { height: number; width: number } | null {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return null;
  }
  if (!/<svg\b/i.test(source) || !/<\/svg\s*>\s*$/i.test(source)) return null;
  if (
    /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b|\bon[a-z]+\s*=|javascript\s*:|@import/i.test(
      source,
    )
  ) {
    throw new AssetValidationError('The SVG contains unsafe content');
  }
  for (const match of source.matchAll(/url\s*\(\s*(["']?)(.*?)\1\s*\)/giu)) {
    const value = match[2]?.trim() ?? '';
    if (!value.startsWith('#')) {
      throw new AssetValidationError('The SVG contains an external resource');
    }
  }
  for (const match of source.matchAll(
    /\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/giu,
  )) {
    const value = match[2]?.trim() ?? '';
    if (value !== '' && !value.startsWith('#')) {
      throw new AssetValidationError('The SVG contains an external resource');
    }
  }
  const root = source.match(/<svg\b([^>]*)>/i)?.[1] ?? '';
  const numericAttribute = (name: string): number | null => {
    const value = root.match(
      new RegExp(
        `\\b${name}\\s*=\\s*["']\\s*([0-9]+(?:\\.[0-9]+)?)(?:px)?\\s*["']`,
        'i',
      ),
    )?.[1];
    return value === undefined ? null : Number(value);
  };
  const width = numericAttribute('width');
  const height = numericAttribute('height');
  if (width !== null && height !== null) return { height, width };
  const viewBox = root
    .match(/\bviewBox\s*=\s*["']\s*([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (viewBox?.length !== 4 || !viewBox.every(Number.isFinite)) return null;
  const viewBoxWidth = viewBox[2];
  const viewBoxHeight = viewBox[3];
  if (
    viewBoxWidth === undefined ||
    viewBoxHeight === undefined ||
    viewBoxWidth <= 0 ||
    viewBoxHeight <= 0
  ) {
    return null;
  }
  return { height: viewBoxHeight, width: viewBoxWidth };
}

function dimensionsFor(
  content: Buffer,
  mediaType: AssetMediaType,
): { height: number; width: number } | null {
  return mediaType === 'image/svg+xml'
    ? svgDimensions(content)
    : rasterDimensions(content, mediaType);
}

function safeName(name: string | undefined): string {
  const normalized = [...(name ?? 'image')]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 ||
        code === 127 ||
        character === '/' ||
        character === '\\'
        ? ' '
        : character;
    })
    .join('')
    .trim()
    .slice(0, 200);
  return normalized === '' ? 'image' : normalized;
}

/** Validates untrusted upload bytes and returns normalized immutable metadata. */
export function validateAsset(input: {
  content: Buffer;
  mediaType: string;
  name?: string;
}): ValidatedAsset {
  if (!isAssetMediaType(input.mediaType)) {
    throw new AssetValidationError('Unsupported image type');
  }
  if (input.content.length === 0) {
    throw new AssetValidationError('The image is empty');
  }
  if (input.content.length > MAX_ASSET_BYTES) {
    throw new AssetValidationError(
      `Images must be no larger than ${MAX_ASSET_BYTES / 1_000_000} MB`,
    );
  }
  const dimensions = dimensionsFor(input.content, input.mediaType);
  if (dimensions === null) {
    throw new AssetValidationError(
      'The image format or dimensions are invalid',
    );
  }
  const width = Math.round(dimensions.width);
  const height = Math.round(dimensions.height);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_ASSET_DIMENSION ||
    height > MAX_ASSET_DIMENSION ||
    width * height > MAX_ASSET_PIXELS
  ) {
    throw new AssetValidationError('The image dimensions are too large');
  }
  return {
    content: input.content,
    height,
    mediaType: input.mediaType,
    name: safeName(input.name),
    width,
  };
}
