/**
 * Maps structured mixed content to nested Yjs collections. Reconciliation edits
 * existing rows and spans in place where possible so concurrent identities and
 * undo history survive ordinary text changes.
 */
import * as Y from 'yjs';

import { CHALKBOARD_SCHEMA_VERSIONS } from './schemaVersions.js';
import {
  isMixedContentDocument,
  type MixedContentDocument,
  type MixedContentSpan,
} from './mixedContent.js';

const ROOT_MAP = './mixedContent';
const ROWS_KEY = 'rows';
const SPANS_KEY = 'spans';
const CONTENT_KEY = 'content';

/** Yjs map storing the structured-content version and ordered row array. */
export type YMixedContentRoot = Y.Map<unknown>;
/** Yjs map storing one ordered span array. */
export type YMixedContentRow = Y.Map<unknown>;
/** Yjs map storing a span discriminator, content text, and prose attributes. */
export type YMixedContentSpan = Y.Map<unknown>;

function ySpanFromSpan(span: MixedContentSpan): YMixedContentSpan {
  const result = new Y.Map<unknown>();
  result.set('kind', span.kind);
  const content = new Y.Text();
  content.insert(0, span.kind === 'math' ? span.latex : span.text);
  result.set(CONTENT_KEY, content);
  if (span.kind === 'text') {
    result.set('bold', span.bold);
    result.set('color', span.color);
    result.set('italic', span.italic);
  }
  return result;
}

function yRowFromSpans(spans: MixedContentSpan[]): YMixedContentRow {
  const row = new Y.Map<unknown>();
  const ySpans = new Y.Array<YMixedContentSpan>();
  ySpans.insert(0, spans.map(ySpanFromSpan));
  row.set(SPANS_KEY, ySpans);
  return row;
}

function reconcileText(text: Y.Text, value: string): void {
  const current = text.toString();
  if (current === value) return;
  let prefix = 0;
  while (
    prefix < current.length &&
    prefix < value.length &&
    current[prefix] === value[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < value.length - prefix &&
    current[current.length - suffix - 1] === value[value.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const removedLength = current.length - prefix - suffix;
  if (removedLength > 0) text.delete(prefix, removedLength);
  const inserted = value.slice(prefix, value.length - suffix);
  if (inserted !== '') text.insert(prefix, inserted);
}

function reconcileSpan(
  spans: Y.Array<YMixedContentSpan>,
  index: number,
  value: MixedContentSpan,
): void {
  let span = spans.get(index);
  if (!(span instanceof Y.Map) || span.get('kind') !== value.kind) {
    if (span !== undefined) spans.delete(index, 1);
    span = ySpanFromSpan(value);
    spans.insert(index, [span]);
    return;
  }
  const content = yMixedContentText(span);
  if (content === null) {
    const replacement = new Y.Text();
    replacement.insert(0, value.kind === 'math' ? value.latex : value.text);
    span.set(CONTENT_KEY, replacement);
  } else {
    reconcileText(content, value.kind === 'math' ? value.latex : value.text);
  }
  if (value.kind === 'text') {
    if (span.get('bold') !== value.bold) span.set('bold', value.bold);
    if (span.get('color') !== value.color) span.set('color', value.color);
    if (span.get('italic') !== value.italic) span.set('italic', value.italic);
  } else {
    span.delete('bold');
    span.delete('color');
    span.delete('italic');
  }
}

/** Reconciles content in place; returns false rather than rewriting another version. */
export function reconcileYMixedContent(
  root: YMixedContentRoot,
  content: MixedContentDocument,
): boolean {
  const existingVersion = root.get('version');
  if (existingVersion !== undefined && existingVersion !== content.version) {
    return false;
  }
  if (existingVersion === undefined) root.set('version', content.version);
  const existingRows = yMixedContentRows(root);
  const rows = existingRows ?? new Y.Array<YMixedContentRow>();
  if (existingRows === null) root.set(ROWS_KEY, rows);
  content.rows.forEach((value, rowIndex) => {
    let row = rows.get(rowIndex);
    if (!(row instanceof Y.Map)) {
      if (row !== undefined) rows.delete(rowIndex, 1);
      row = yRowFromSpans(value.spans);
      rows.insert(rowIndex, [row]);
      return;
    }
    const existingSpans = yMixedContentSpans(row);
    const spans = existingSpans ?? new Y.Array<YMixedContentSpan>();
    if (existingSpans === null) row.set(SPANS_KEY, spans);
    value.spans.forEach((span, spanIndex) => {
      reconcileSpan(spans, spanIndex, span);
    });
    if (spans.length > value.spans.length) {
      spans.delete(value.spans.length, spans.length - value.spans.length);
    }
  });
  if (rows.length > content.rows.length) {
    rows.delete(content.rows.length, rows.length - content.rows.length);
  }
  return true;
}

/** Returns the stable top-level Yjs map reserved for structured mixed content. */
export function mixedContentRoot(document: Y.Doc): YMixedContentRoot {
  return document.getMap(ROOT_MAP);
}

/** Replaces the reserved root in one transaction with a validated document. */
export function initializeYMixedContent(
  document: Y.Doc,
  content: MixedContentDocument,
): YMixedContentRoot {
  const root = mixedContentRoot(document);
  document.transact(() => {
    root.clear();
    reconcileYMixedContent(root, content);
  }, 'initialize-mixedContent');
  return root;
}

/** Reads the row array or returns null when the root has an incompatible shape. */
export function yMixedContentRows(
  root: YMixedContentRoot,
): Y.Array<YMixedContentRow> | null {
  const rows = root.get(ROWS_KEY);
  return rows instanceof Y.Array ? (rows as Y.Array<YMixedContentRow>) : null;
}

/** Reads a row's span array or returns null when the row is malformed. */
export function yMixedContentSpans(
  row: YMixedContentRow,
): Y.Array<YMixedContentSpan> | null {
  const spans = row.get(SPANS_KEY);
  return spans instanceof Y.Array
    ? (spans as Y.Array<YMixedContentSpan>)
    : null;
}

/** Reads collaborative span text or returns null when the span is malformed. */
export function yMixedContentText(span: YMixedContentSpan): Y.Text | null {
  const content = span.get(CONTENT_KEY);
  return content instanceof Y.Text ? content : null;
}

/** Decodes the entire reserved root, rejecting unsupported or malformed content. */
export function mixedContentFromYRoot(
  root: YMixedContentRoot,
): MixedContentDocument | null {
  const rows = yMixedContentRows(root);
  if (
    root.get('version') !== CHALKBOARD_SCHEMA_VERSIONS.mixedContent ||
    rows === null
  )
    return null;
  const decodedRows: MixedContentDocument['rows'] = [];
  for (const row of rows.toArray()) {
    const spans = yMixedContentSpans(row);
    if (spans === null) return null;
    const decodedSpans: MixedContentSpan[] = [];
    for (const span of spans.toArray()) {
      const kind = span.get('kind');
      const content = yMixedContentText(span)?.toString();
      if (content === undefined) return null;
      if (kind === 'math') {
        decodedSpans.push({ kind: 'math', latex: content });
        continue;
      }
      const bold = span.get('bold');
      const color = span.get('color');
      const italic = span.get('italic');
      if (
        kind !== 'text' ||
        typeof bold !== 'boolean' ||
        typeof color !== 'string' ||
        typeof italic !== 'boolean'
      ) {
        return null;
      }
      decodedSpans.push({ bold, color, italic, kind: 'text', text: content });
    }
    decodedRows.push({ spans: decodedSpans });
  }
  const candidate: MixedContentDocument = {
    rows: decodedRows,
    version: CHALKBOARD_SCHEMA_VERSIONS.mixedContent,
  };
  return isMixedContentDocument(candidate) ? candidate : null;
}

/** Decodes structured mixed content directly from a Yjs document. */
export function mixedContentFromYDoc(
  document: Y.Doc,
): MixedContentDocument | null {
  return mixedContentFromYRoot(mixedContentRoot(document));
}
