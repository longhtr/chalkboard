/**
 * Reader/writer for editable `.chalkboard` archives. ZIP entries, manifest,
 * board JSON, structured content, assets, checksums, paths, and total resources
 * are validated before a new local board can be constructed.
 */
import {
  CHALKBOARD_SCHEMA_VERSIONS,
  isEquationElement,
  isImageElement,
  MAX_BOARD_TITLE_LENGTH,
  MAX_FREEHAND_POINTS,
  unicodeScalarLength,
  type BoardElement,
  type ImageElement,
  type MixedContentDocument,
} from '@chalkboard/shared';

import type { WorkspaceFontChoice } from '../../math/workspaceFontAssets';
import { MAX_BOARD_BYTES, MAX_BOARD_ELEMENTS } from '../model/limits';
import { parseStoredElements } from '../model/boardSerialization';
import {
  reconcileRequiredStructuredBoardContent,
  reconcileStructuredBoardContent,
} from './structuredBoardContent';
import {
  compareCodePoints,
  decodeStoredZip,
  encodeStoredZip,
  type StoredZipEntry,
} from './storedZip';

// This module is the editable archive trust boundary. The writer emits one
// canonical representation; the reader treats every archive value as hostile.
const FORMAT = 'chalkboard-board';
const ARCHIVE_VERSION = CHALKBOARD_SCHEMA_VERSIONS.archive;
const BOARD_SCHEMA_VERSION = CHALKBOARD_SCHEMA_VERSIONS.archiveBoard;
const MANIFEST_PATH = 'manifest.json';
const BOARD_PATH = 'board.json';
const ASSET_PREFIX = 'assets/sha256/';
const SHA256 = /^[0-9a-f]{64}$/u;
type ArchiveImageMediaType =
  | 'image/avif'
  | 'image/gif'
  | 'image/jpeg'
  | 'image/png'
  | 'image/svg+xml'
  | 'image/webp';
const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
]);

const BOARD_ARCHIVE_LIMITS = {
  archiveBytes: 64 * 1024 * 1024,
  assets: 256,
  assetBytes: 32 * 1024 * 1024,
  boardBytes: MAX_BOARD_BYTES,
  elements: MAX_BOARD_ELEMENTS,
  equationBytes: 1024 * 1024,
  equationBytesTotal: 8 * 1024 * 1024,
  freehandPoints: MAX_FREEHAND_POINTS,
  freehandPointsTotal: 1_000_000,
  imagePixels: 40_000_000,
  imagePixelsTotal: 100_000_000,
  manifestBytes: 256 * 1024,
  titleCharacters: MAX_BOARD_TITLE_LENGTH,
  totalAssetBytes: 60 * 1024 * 1024,
} as const;

interface ArchiveImageElement extends Omit<ImageElement, 'source'> {
  assetDigest: string;
}

type ArchiveBoardElement =
  Exclude<BoardElement, ImageElement> | ArchiveImageElement;
interface BoardDocumentV1 {
  appearance: { font: WorkspaceFontChoice };
  elements: unknown[];
  mixedContentByElementId: Record<string, unknown>;
  schemaVersion: 1;
  title: string;
}

interface EntryDeclaration {
  byteLength: number;
  digest: string;
  mediaType: string;
  path: string;
}

interface AssetDeclaration extends EntryDeclaration {
  mediaType: ArchiveImageMediaType;
  names: string[];
  pixelHeight: number;
  pixelWidth: number;
}

interface ManifestV1 {
  archiveVersion: 1;
  assets: AssetDeclaration[];
  board: EntryDeclaration & {
    mediaType: 'application/json';
    path: 'board.json';
  };
  boardSchemaVersion: 1;
  format: 'chalkboard-board';
}

/** Verified immutable image bytes and dimensions supplied to archive creation. */
export interface ResolvedBoardArchiveAsset {
  bytes: Uint8Array;
  mediaType: string;
  pixelHeight: number;
  pixelWidth: number;
}

interface BoardArchiveInput {
  elements: readonly BoardElement[];
  font: WorkspaceFontChoice;
  mixedContentByElementId?: Record<string, MixedContentDocument>;
  title: string;
}

interface BoardArchiveResult {
  bytes: Uint8Array;
  filename: string;
}

/** Fully validated editable archive reconstructed for local-board import. */
export interface ParsedBoardArchive {
  elements: BoardElement[];
  font: WorkspaceFontChoice;
  mixedContentByElementId: Record<string, MixedContentDocument>;
  title: string;
}

interface BoardArchiveOptions {
  inspectImage?: (
    bytes: Uint8Array,
    mediaType: string,
  ) => Promise<{ pixelHeight: number; pixelWidth: number }>;
  resolveAsset?: (element: ImageElement) => Promise<ResolvedBoardArchiveAsset>;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

// Canonical JSON makes equal boards byte-identical across engines and gives the
// manifest a stable digest surface independent of object insertion order.
function canonicalJsonText(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error('Canonical JSON contains an unsupported number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonText).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Canonical JSON contains a non-plain object');
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonText(object[key])}`)
      .join(',')}}`;
  }
  throw new Error('Canonical JSON contains an unsupported value');
}

/** Encodes deterministic key-sorted JSON bytes for checksums and archive entries. */
export function canonicalJson(value: unknown): Uint8Array {
  return utf8Encoder.encode(canonicalJsonText(value));
}

function parseCanonicalJson(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = utf8Decoder.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (canonicalJsonText(parsed) !== text) {
    throw new Error(`${label} is not canonical JSON`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareCodePoints);
  const expected = [...keys].sort(compareCodePoints);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToDataUrl(bytes: Uint8Array, mediaType: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

function dataUrlBytes(source: string): {
  bytes: Uint8Array;
  mediaType: string;
} {
  const match = source.match(
    /^data:(image\/[\w.+-]+);base64,([a-z0-9+/=]*)$/iu,
  );
  if (match === null) throw new Error('Image source is not a base64 data URL');
  const mediaType = (match[1] ?? '').toLowerCase();
  let binary: string;
  try {
    binary = atob(match[2] ?? '');
  } catch {
    throw new Error('Image source has invalid base64 data');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, mediaType };
}

// SVG is parsed as data, not trusted markup. Reject executable, external, and
// entity-bearing forms before the asset can reach storage or a browser decoder.
function safeSvg(bytes: Uint8Array): void {
  let source: string;
  try {
    source = utf8Decoder.decode(bytes);
  } catch {
    throw new Error('SVG asset is not valid UTF-8');
  }
  const forbidden = [
    /<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b/iu,
    /<\?xml/iu,
    /<!DOCTYPE/iu,
    /<!ENTITY/iu,
    /\son[a-z]+\s*=/iu,
    /\b(?:href|xlink:href)\s*=\s*["'](?!#)/iu,
    /\bsrc\s*=/iu,
    /\burl\s*\(/iu,
    /@import/iu,
    /javascript:/iu,
  ];
  if (forbidden.some((pattern) => pattern.test(source))) {
    throw new Error('SVG asset contains executable or external content');
  }
  if (typeof DOMParser === 'undefined') return;
  const parser = new DOMParser();
  const document = parser.parseFromString(source, 'image/svg+xml');
  if (
    document.querySelector('parsererror') !== null ||
    document.documentElement.localName.toLowerCase() !== 'svg'
  ) {
    throw new Error('SVG asset is malformed');
  }
  if (
    document.querySelector(
      'script, foreignObject, iframe, object, embed, audio, video',
    ) !== null
  ) {
    throw new Error('SVG asset contains executable or external content');
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith('on') ||
        ((name === 'href' || name === 'xlink:href') &&
          value !== '' &&
          !value.startsWith('#')) ||
        ((name === 'src' || name === 'style') &&
          /(?:javascript:|data:|https?:|^\/\/|url\s*\()/iu.test(value))
      ) {
        throw new Error('SVG asset contains executable or external content');
      }
    }
  }
  for (const style of document.querySelectorAll('style')) {
    if (/(?:@import|url\s*\(|javascript:)/iu.test(style.textContent ?? '')) {
      throw new Error('SVG asset contains executable or external content');
    }
  }
}

function sniffImage(bytes: Uint8Array, mediaType: string): void {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  const valid =
    (mediaType === 'image/png' &&
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (value, index) => bytes[index] === value,
      )) ||
    (mediaType === 'image/jpeg' &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (mediaType === 'image/gif' &&
      (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) ||
    (mediaType === 'image/webp' &&
      ascii(0, 4) === 'RIFF' &&
      ascii(8, 4) === 'WEBP') ||
    (mediaType === 'image/avif' &&
      ascii(4, 4) === 'ftyp' &&
      ['avif', 'avis'].includes(ascii(8, 4))) ||
    mediaType === 'image/svg+xml';
  if (!valid) throw new Error(`Asset bytes do not match ${mediaType}`);
  if (mediaType === 'image/svg+xml') safeSvg(bytes);
}

async function browserImageDimensions(
  bytes: Uint8Array,
  mediaType: string,
): Promise<{ pixelHeight: number; pixelWidth: number }> {
  const blob = new Blob([new Uint8Array(bytes)], { type: mediaType });
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      return { pixelHeight: bitmap.height, pixelWidth: bitmap.width };
    } finally {
      bitmap.close();
    }
  }
  if (typeof Image === 'undefined') {
    throw new Error('This browser cannot decode archive images in a worker');
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      resolve({
        pixelHeight: image.naturalHeight,
        pixelWidth: image.naturalWidth,
      });
    });
    image.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image asset could not be decoded'));
    });
    image.src = url;
  });
}

async function defaultResolveAsset(
  element: ImageElement,
): Promise<ResolvedBoardArchiveAsset> {
  let bytes: Uint8Array;
  let mediaType: string;
  if (element.source.startsWith('data:')) {
    ({ bytes, mediaType } = dataUrlBytes(element.source));
  } else {
    const response = await fetch(element.source, {
      credentials: 'same-origin',
    });
    if (!response.ok)
      throw new Error(`Could not load image asset (${response.status})`);
    mediaType = (response.headers.get('content-type') ?? '')
      .split(';')[0]!
      .toLowerCase();
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (!isArchiveImageMediaType(mediaType)) {
    throw new Error(
      `Unsupported image media type: ${mediaType || '(missing)'}`,
    );
  }
  sniffImage(bytes, mediaType);
  const dimensions = await browserImageDimensions(bytes, mediaType);
  return { bytes, mediaType, ...dimensions };
}

function isArchiveImageMediaType(
  value: unknown,
): value is ArchiveImageMediaType {
  return typeof value === 'string' && ALLOWED_IMAGE_TYPES.has(value);
}

function validDimensions(width: number, height: number): boolean {
  return (
    positiveInteger(width) &&
    positiveInteger(height) &&
    width * height <= BOARD_ARCHIVE_LIMITS.imagePixels
  );
}

function normalizedTitle(title: string): string {
  const normalized = title.trim() || 'Untitled board';
  if (unicodeScalarLength(normalized) > BOARD_ARCHIVE_LIMITS.titleCharacters) {
    throw new Error('Board title exceeds archive limit');
  }
  return normalized;
}

function archiveFilename(title: string): string {
  const normalized = Array.from(title.normalize('NFKC'))
    .map((value) => ((value.codePointAt(0) ?? 0) <= 0x1f ? '-' : value))
    .join('');
  const filename = normalized
    .replace(/[<>:"/\\|?*]/gu, '-')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .slice(0, 120)
    .trim();
  return `${filename || 'Untitled board'}.chalkboard`;
}

function validateElementLimits(elements: readonly BoardElement[]): void {
  if (elements.length > BOARD_ARCHIVE_LIMITS.elements) {
    throw new Error('Board element count exceeds archive limit');
  }
  const ids = new Set<string>();
  let equationBytes = 0;
  let freehandPoints = 0;
  for (const element of elements) {
    if (ids.has(element.id))
      throw new Error(`Duplicate board element ID: ${element.id}`);
    ids.add(element.id);
    if (isEquationElement(element)) {
      const bytes = utf8Encoder.encode(element.source).length;
      if (bytes > BOARD_ARCHIVE_LIMITS.equationBytes) {
        throw new Error('Equation source exceeds archive limit');
      }
      equationBytes += bytes;
    }
    if (element.type === 'freehand') {
      if (element.points.length > BOARD_ARCHIVE_LIMITS.freehandPoints) {
        throw new Error('Freehand point count exceeds archive limit');
      }
      freehandPoints += element.points.length;
    }
  }
  if (equationBytes > BOARD_ARCHIVE_LIMITS.equationBytesTotal) {
    throw new Error('Total equation source size exceeds archive limit');
  }
  if (freehandPoints > BOARD_ARCHIVE_LIMITS.freehandPointsTotal) {
    throw new Error('Total freehand point count exceeds archive limit');
  }
}

function parseEntryDeclaration(value: unknown): EntryDeclaration {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['byteLength', 'digest', 'mediaType', 'path']) ||
    !nonnegativeInteger(value.byteLength) ||
    typeof value.digest !== 'string' ||
    !SHA256.test(value.digest) ||
    typeof value.mediaType !== 'string' ||
    typeof value.path !== 'string'
  ) {
    throw new Error('Manifest entry declaration is invalid');
  }
  return {
    byteLength: value.byteLength,
    digest: value.digest,
    mediaType: value.mediaType,
    path: value.path,
  };
}

// Manifest validation establishes all declared resource bounds before archive
// entries are decoded or allocated as board assets.
function parseManifest(value: unknown): ManifestV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'archiveVersion',
      'assets',
      'board',
      'boardSchemaVersion',
      'format',
    ]) ||
    value.format !== FORMAT ||
    value.archiveVersion !== ARCHIVE_VERSION ||
    value.boardSchemaVersion !== BOARD_SCHEMA_VERSION ||
    !Array.isArray(value.assets)
  ) {
    throw new Error('Unsupported or invalid Chalkboard archive manifest');
  }
  if (value.assets.length > BOARD_ARCHIVE_LIMITS.assets) {
    throw new Error('Archive asset count exceeds limit');
  }
  const board = parseEntryDeclaration(value.board);
  if (board.path !== BOARD_PATH || board.mediaType !== 'application/json') {
    throw new Error('Manifest board declaration is invalid');
  }
  const assets = value.assets.map((candidate): AssetDeclaration => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        'byteLength',
        'digest',
        'mediaType',
        'names',
        'path',
        'pixelHeight',
        'pixelWidth',
      ]) ||
      !nonnegativeInteger(candidate.byteLength) ||
      typeof candidate.digest !== 'string' ||
      !SHA256.test(candidate.digest) ||
      !isArchiveImageMediaType(candidate.mediaType) ||
      candidate.path !== `${ASSET_PREFIX}${candidate.digest}` ||
      !Array.isArray(candidate.names) ||
      !candidate.names.every(
        (name) =>
          typeof name === 'string' &&
          name !== '' &&
          !name.includes('/') &&
          !name.includes('\\') &&
          unicodeScalarLength(name) <= 255,
      ) ||
      !positiveInteger(candidate.pixelWidth) ||
      !positiveInteger(candidate.pixelHeight) ||
      !validDimensions(candidate.pixelWidth, candidate.pixelHeight)
    ) {
      throw new Error('Manifest asset declaration is invalid');
    }
    const names = candidate.names.filter(
      (name): name is string => typeof name === 'string',
    );
    const sortedNames = [...new Set(names)].sort(compareCodePoints);
    if (canonicalJsonText(names) !== canonicalJsonText(sortedNames)) {
      throw new Error('Manifest asset names are not sorted and unique');
    }
    return {
      byteLength: candidate.byteLength,
      digest: candidate.digest,
      mediaType: candidate.mediaType,
      names,
      path: candidate.path,
      pixelHeight: candidate.pixelHeight,
      pixelWidth: candidate.pixelWidth,
    };
  });
  const sortedAssets = [...assets].sort((left, right) =>
    compareCodePoints(left.digest, right.digest),
  );
  if (canonicalJsonText(assets) !== canonicalJsonText(sortedAssets)) {
    throw new Error('Manifest assets are not in canonical order');
  }
  return {
    archiveVersion: ARCHIVE_VERSION,
    assets,
    board: {
      ...board,
      mediaType: 'application/json',
      path: BOARD_PATH,
    },
    boardSchemaVersion: BOARD_SCHEMA_VERSION,
    format: FORMAT,
  };
}

function parseBoardDocument(value: unknown): BoardDocumentV1 {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'appearance',
      'elements',
      'mixedContentByElementId',
      'schemaVersion',
      'title',
    ]) ||
    value.schemaVersion !== BOARD_SCHEMA_VERSION ||
    typeof value.title !== 'string' ||
    normalizedTitle(value.title) !== value.title ||
    !isRecord(value.appearance) ||
    !hasOnlyKeys(value.appearance, ['font']) ||
    (value.appearance.font !== 'classic' &&
      value.appearance.font !== 'excalifont') ||
    !Array.isArray(value.elements) ||
    !isRecord(value.mixedContentByElementId)
  ) {
    throw new Error('Board document is invalid or unsupported');
  }
  return {
    appearance: { font: value.appearance.font },
    elements: value.elements,
    mixedContentByElementId: value.mixedContentByElementId,
    schemaVersion: BOARD_SCHEMA_VERSION,
    title: value.title,
  };
}

/**
 * Captures a validated board snapshot, content-addresses each unique asset, and
 * writes entries in deterministic order. The completed ZIP is parsed once more
 * before it is offered for download.
 */
export async function createBoardArchive(
  input: BoardArchiveInput,
  options: BoardArchiveOptions = {},
): Promise<BoardArchiveResult> {
  const structured = reconcileStructuredBoardContent(
    input.elements,
    input.mixedContentByElementId,
  );
  const elements = structured.elements;
  validateElementLimits(elements);
  const resolveAsset = options.resolveAsset ?? defaultResolveAsset;
  const assetByDigest = new Map<
    string,
    { declaration: AssetDeclaration; bytes: Uint8Array }
  >();
  let totalAssetBytes = 0;
  let totalPixels = 0;
  const archivedElements: ArchiveBoardElement[] = [];
  for (const element of elements) {
    if (!isImageElement(element)) {
      archivedElements.push({ ...element, createdBy: 'archive' });
      continue;
    }
    const resolved = await resolveAsset(element);
    if (!isArchiveImageMediaType(resolved.mediaType)) {
      throw new Error(`Unsupported image media type: ${resolved.mediaType}`);
    }
    if (resolved.bytes.length > BOARD_ARCHIVE_LIMITS.assetBytes) {
      throw new Error('Image asset exceeds archive limit');
    }
    if (!validDimensions(resolved.pixelWidth, resolved.pixelHeight)) {
      throw new Error('Image dimensions exceed archive limit');
    }
    sniffImage(resolved.bytes, resolved.mediaType);
    const digest = await sha256(resolved.bytes);
    const existing = assetByDigest.get(digest);
    if (existing === undefined) {
      totalAssetBytes += resolved.bytes.length;
      totalPixels += resolved.pixelWidth * resolved.pixelHeight;
      if (
        assetByDigest.size + 1 > BOARD_ARCHIVE_LIMITS.assets ||
        totalAssetBytes > BOARD_ARCHIVE_LIMITS.totalAssetBytes ||
        totalPixels > BOARD_ARCHIVE_LIMITS.imagePixelsTotal
      ) {
        throw new Error('Board image assets exceed archive limits');
      }
      assetByDigest.set(digest, {
        bytes: new Uint8Array(resolved.bytes),
        declaration: {
          byteLength: resolved.bytes.length,
          digest,
          mediaType: resolved.mediaType as AssetDeclaration['mediaType'],
          names: [element.name],
          path: `${ASSET_PREFIX}${digest}`,
          pixelHeight: resolved.pixelHeight,
          pixelWidth: resolved.pixelWidth,
        },
      });
    } else {
      if (
        existing.declaration.mediaType !== resolved.mediaType ||
        existing.declaration.pixelWidth !== resolved.pixelWidth ||
        existing.declaration.pixelHeight !== resolved.pixelHeight
      ) {
        throw new Error('Identical asset bytes have inconsistent metadata');
      }
      existing.declaration.names = [
        ...new Set([...existing.declaration.names, element.name]),
      ].sort(compareCodePoints);
    }
    const { source: _source, ...withoutSource } = element;
    void _source;
    archivedElements.push({
      ...withoutSource,
      assetDigest: digest,
      createdBy: 'archive',
    });
  }

  const title = normalizedTitle(input.title);
  const board: BoardDocumentV1 = {
    appearance: { font: input.font },
    elements: archivedElements,
    mixedContentByElementId: structured.mixedContentByElementId,
    schemaVersion: BOARD_SCHEMA_VERSION,
    title,
  };
  const boardBytes = canonicalJson(board);
  if (boardBytes.length > BOARD_ARCHIVE_LIMITS.boardBytes) {
    throw new Error('Board document exceeds archive limit');
  }
  const boardDigest = await sha256(boardBytes);
  const assets = [...assetByDigest.values()]
    .map(({ declaration }) => declaration)
    .sort((left, right) => compareCodePoints(left.digest, right.digest));
  const manifest: ManifestV1 = {
    archiveVersion: ARCHIVE_VERSION,
    assets,
    board: {
      byteLength: boardBytes.length,
      digest: boardDigest,
      mediaType: 'application/json',
      path: BOARD_PATH,
    },
    boardSchemaVersion: BOARD_SCHEMA_VERSION,
    format: FORMAT,
  };
  const manifestBytes = canonicalJson(manifest);
  if (manifestBytes.length > BOARD_ARCHIVE_LIMITS.manifestBytes) {
    throw new Error('Archive manifest exceeds limit');
  }
  const zipEntries: StoredZipEntry[] = [
    { bytes: manifestBytes, path: MANIFEST_PATH },
    { bytes: boardBytes, path: BOARD_PATH },
    ...[...assetByDigest.values()].map(({ bytes, declaration }) => ({
      bytes,
      path: declaration.path,
    })),
  ];
  const bytes = encodeStoredZip(zipEntries);
  await parseBoardArchive(bytes, options);
  return { bytes, filename: archiveFilename(title) };
}

/**
 * Validates the ZIP envelope and manifest first, then resolves every declared
 * asset and regenerates board identity. No partially parsed board escapes this
 * function.
 */
export async function parseBoardArchive(
  bytes: Uint8Array,
  options: Pick<BoardArchiveOptions, 'inspectImage'> = {},
): Promise<ParsedBoardArchive> {
  const entries = decodeStoredZip(bytes);
  const manifestBytes = entries.get(MANIFEST_PATH);
  if (manifestBytes === undefined)
    throw new Error('Archive manifest is missing');
  if (manifestBytes.length > BOARD_ARCHIVE_LIMITS.manifestBytes) {
    throw new Error('Archive manifest exceeds limit');
  }
  const manifest = parseManifest(
    parseCanonicalJson(manifestBytes, 'manifest.json'),
  );
  const declaredPaths = new Set([
    MANIFEST_PATH,
    manifest.board.path,
    ...manifest.assets.map(({ path }) => path),
  ]);
  if (
    entries.size !== declaredPaths.size ||
    [...entries.keys()].some((path) => !declaredPaths.has(path))
  ) {
    throw new Error('Archive contains undeclared or missing entries');
  }
  const boardBytes = entries.get(BOARD_PATH);
  if (
    boardBytes === undefined ||
    boardBytes.length !== manifest.board.byteLength
  ) {
    throw new Error('Board entry length does not match manifest');
  }
  if (boardBytes.length > BOARD_ARCHIVE_LIMITS.boardBytes) {
    throw new Error('Board document exceeds archive limit');
  }
  if ((await sha256(boardBytes)) !== manifest.board.digest) {
    throw new Error('Board entry hash does not match manifest');
  }

  let totalAssetBytes = 0;
  let totalPixels = 0;
  const assetByDigest = new Map<
    string,
    { bytes: Uint8Array; declaration: AssetDeclaration }
  >();
  for (const declaration of manifest.assets) {
    const assetBytes = entries.get(declaration.path);
    if (
      assetBytes === undefined ||
      assetBytes.length !== declaration.byteLength ||
      assetBytes.length > BOARD_ARCHIVE_LIMITS.assetBytes
    ) {
      throw new Error('Asset entry length does not match manifest or limits');
    }
    totalAssetBytes += assetBytes.length;
    totalPixels += declaration.pixelWidth * declaration.pixelHeight;
    if (
      totalAssetBytes > BOARD_ARCHIVE_LIMITS.totalAssetBytes ||
      totalPixels > BOARD_ARCHIVE_LIMITS.imagePixelsTotal
    ) {
      throw new Error('Board image assets exceed archive limits');
    }
    if ((await sha256(assetBytes)) !== declaration.digest) {
      throw new Error('Asset hash does not match manifest');
    }
    sniffImage(assetBytes, declaration.mediaType);
    const dimensions = await (options.inspectImage ?? browserImageDimensions)(
      assetBytes,
      declaration.mediaType,
    );
    if (
      dimensions.pixelWidth !== declaration.pixelWidth ||
      dimensions.pixelHeight !== declaration.pixelHeight
    ) {
      throw new Error('Decoded image dimensions do not match manifest');
    }
    assetByDigest.set(declaration.digest, {
      bytes: assetBytes,
      declaration,
    });
  }

  const board = parseBoardDocument(
    parseCanonicalJson(boardBytes, 'board.json'),
  );
  if (board.elements.length > BOARD_ARCHIVE_LIMITS.elements) {
    throw new Error('Board element count exceeds archive limit');
  }
  const hydratedValues = board.elements.map((element): unknown => {
    if (!isRecord(element) || element.type !== 'image') return element;
    if (
      typeof element.assetDigest !== 'string' ||
      !SHA256.test(element.assetDigest)
    ) {
      throw new Error('Image element asset reference is invalid');
    }
    const asset = assetByDigest.get(element.assetDigest);
    if (asset === undefined) {
      throw new Error('Image element references an undeclared asset');
    }
    const { assetDigest: _assetDigest, ...image } = element;
    void _assetDigest;
    return {
      ...image,
      source: bytesToDataUrl(asset.bytes, asset.declaration.mediaType),
    };
  });
  const elements = parseStoredElements(JSON.stringify(hydratedValues));
  if (elements.length !== hydratedValues.length) {
    throw new Error('Board contains an invalid element');
  }
  validateElementLimits(elements);
  const structured = reconcileRequiredStructuredBoardContent(
    elements,
    board.mixedContentByElementId,
  );
  return {
    elements: structured.elements,
    font: board.appearance.font,
    mixedContentByElementId: structured.mixedContentByElementId,
    title: board.title,
  };
}
