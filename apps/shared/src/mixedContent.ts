/**
 * Runtime-neutral structured representation of prose and mathematics. Rows own
 * ordered spans; text spans carry style, while math spans carry canonical LaTeX.
 */
import { CHALKBOARD_SCHEMA_VERSIONS } from './schemaVersions.js';

/** Inline visual attributes retained on every structured prose span. */
export interface MixedTextAttributes {
  bold: boolean;
  color: string;
  italic: boolean;
}

/** One contiguous prose run with a single set of visual attributes. */
export interface MixedTextSpan extends MixedTextAttributes {
  kind: 'text';
  text: string;
}

/** One canonical LaTeX run embedded among prose spans. */
export interface MixedMathSpan {
  kind: 'math';
  latex: string;
}

/** Discriminated span representation used by persistence and collaboration. */
export type MixedContentSpan = MixedMathSpan | MixedTextSpan;

/** One visual line; an empty span list represents an intentional blank line. */
export interface MixedContentRow {
  spans: MixedContentSpan[];
}

/** Versioned structured counterpart to an equation element's compatibility source. */
export interface MixedContentDocument {
  rows: MixedContentRow[];
  version: typeof CHALKBOARD_SCHEMA_VERSIONS.mixedContent;
}

/** Validates the complete versioned document without trusting parsed input. */
export function isMixedContentDocument(
  value: unknown,
): value is MixedContentDocument {
  if (typeof value !== 'object' || value === null) return false;
  const document = value as Record<string, unknown>;
  if (
    document.version !== CHALKBOARD_SCHEMA_VERSIONS.mixedContent ||
    !Array.isArray(document.rows)
  )
    return false;
  return document.rows.every((row) => {
    if (typeof row !== 'object' || row === null) return false;
    const spans = (row as Record<string, unknown>).spans;
    if (!Array.isArray(spans)) return false;
    return spans.every((span) => {
      if (typeof span !== 'object' || span === null) return false;
      const candidate = span as Record<string, unknown>;
      if (candidate.kind === 'math') return typeof candidate.latex === 'string';
      return (
        candidate.kind === 'text' &&
        typeof candidate.text === 'string' &&
        typeof candidate.bold === 'boolean' &&
        typeof candidate.italic === 'boolean' &&
        typeof candidate.color === 'string'
      );
    });
  });
}
