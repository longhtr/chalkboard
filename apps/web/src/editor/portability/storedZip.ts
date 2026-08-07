/**
 * Minimal ZIP reader/writer for stored (uncompressed) archive entries. It rejects
 * unsupported flags/methods, unsafe paths, duplicate names, bad CRC, and excess
 * entry/byte counts instead of attempting broad ZIP compatibility.
 */
import { crc32 } from '@chalkboard/shared';

export { crc32 };

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORED_METHOD = 0;
const DOS_DATE_1980_01_01 = 0x0021;
const MAX_UINT32 = 0xffffffff;

/** One uncompressed UTF-8 path and its exact archive bytes. */
export interface StoredZipEntry {
  bytes: Uint8Array;
  path: string;
}

/** Aggregate limits checked before entry data is copied from an archive. */
interface StoredZipLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxExpandedBytes: number;
  maxPathBytes: number;
}

const DEFAULT_STORED_ZIP_LIMITS: StoredZipLimits = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 258,
  maxEntryBytes: 32 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
  maxPathBytes: 160,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Orders ZIP paths by Unicode code point for deterministic archives. */
export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalPath(path: string, maxPathBytes: number): Uint8Array {
  const segments = path.split('/');
  const encoded = encoder.encode(path);
  if (
    path === '' ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    path.includes('\\') ||
    Array.from(path).some((value) => {
      const codePoint = value.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    }) ||
    /%(?:2e|2f|5c)/iu.test(path) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    ) ||
    encoded.length > maxPathBytes
  ) {
    throw new Error(`ZIP entry path is not canonical: ${path || '(empty)'}`);
  }
  return encoded;
}

function checkedUint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new Error(`${label} exceeds ZIP v1 limits`);
  }
  return value;
}

function writeUint16(view: DataView, offset: number, value: number): number {
  view.setUint16(offset, value, true);
  return offset + 2;
}

function writeUint32(view: DataView, offset: number, value: number): number {
  view.setUint32(offset, value, true);
  return offset + 4;
}

/**
 * Encodes deterministic, uncompressed ZIP entries in supplied order. Paths and
 * sizes are validated before any output buffer is allocated.
 */
export function encodeStoredZip(
  entries: readonly StoredZipEntry[],
  limits: StoredZipLimits = DEFAULT_STORED_ZIP_LIMITS,
): Uint8Array {
  if (entries.length === 0 || entries.length > limits.maxEntries) {
    throw new Error('ZIP entry count exceeds limits');
  }
  const paths = new Set<string>();
  let expandedBytes = 0;
  const prepared = entries
    .map((entry) => {
      const pathBytes = canonicalPath(entry.path, limits.maxPathBytes);
      if (paths.has(entry.path))
        throw new Error(`Duplicate ZIP entry: ${entry.path}`);
      paths.add(entry.path);
      if (entry.bytes.length > limits.maxEntryBytes) {
        throw new Error(`ZIP entry exceeds size limit: ${entry.path}`);
      }
      expandedBytes += entry.bytes.length;
      if (expandedBytes > limits.maxExpandedBytes) {
        throw new Error('ZIP expanded size exceeds limit');
      }
      return {
        ...entry,
        crc: crc32(entry.bytes),
        pathBytes,
      };
    })
    .sort((left, right) => compareCodePoints(left.path, right.path));

  const localBytes = prepared.reduce(
    (total, entry) => total + 30 + entry.pathBytes.length + entry.bytes.length,
    0,
  );
  const centralBytes = prepared.reduce(
    (total, entry) => total + 46 + entry.pathBytes.length,
    0,
  );
  const archiveLength = localBytes + centralBytes + 22;
  checkedUint32(archiveLength, 'ZIP archive');
  if (archiveLength > limits.maxArchiveBytes) {
    throw new Error('ZIP archive size exceeds limit');
  }

  const output = new Uint8Array(archiveLength);
  const view = new DataView(output.buffer);
  const localOffsets = new Map<string, number>();
  let offset = 0;
  for (const entry of prepared) {
    localOffsets.set(entry.path, offset);
    offset = writeUint32(view, offset, LOCAL_FILE_HEADER);
    offset = writeUint16(view, offset, 20);
    offset = writeUint16(view, offset, UTF8_FLAG);
    offset = writeUint16(view, offset, STORED_METHOD);
    offset = writeUint16(view, offset, 0);
    offset = writeUint16(view, offset, DOS_DATE_1980_01_01);
    offset = writeUint32(view, offset, entry.crc);
    offset = writeUint32(view, offset, entry.bytes.length);
    offset = writeUint32(view, offset, entry.bytes.length);
    offset = writeUint16(view, offset, entry.pathBytes.length);
    offset = writeUint16(view, offset, 0);
    output.set(entry.pathBytes, offset);
    offset += entry.pathBytes.length;
    output.set(entry.bytes, offset);
    offset += entry.bytes.length;
  }

  const centralOffset = offset;
  for (const entry of prepared) {
    offset = writeUint32(view, offset, CENTRAL_DIRECTORY_HEADER);
    offset = writeUint16(view, offset, 20);
    offset = writeUint16(view, offset, 20);
    offset = writeUint16(view, offset, UTF8_FLAG);
    offset = writeUint16(view, offset, STORED_METHOD);
    offset = writeUint16(view, offset, 0);
    offset = writeUint16(view, offset, DOS_DATE_1980_01_01);
    offset = writeUint32(view, offset, entry.crc);
    offset = writeUint32(view, offset, entry.bytes.length);
    offset = writeUint32(view, offset, entry.bytes.length);
    offset = writeUint16(view, offset, entry.pathBytes.length);
    offset = writeUint16(view, offset, 0);
    offset = writeUint16(view, offset, 0);
    offset = writeUint16(view, offset, 0);
    offset = writeUint16(view, offset, 0);
    offset = writeUint32(view, offset, 0);
    offset = writeUint32(
      view,
      offset,
      checkedUint32(localOffsets.get(entry.path) ?? -1, 'ZIP local offset'),
    );
    output.set(entry.pathBytes, offset);
    offset += entry.pathBytes.length;
  }

  offset = writeUint32(view, offset, END_OF_CENTRAL_DIRECTORY);
  offset = writeUint16(view, offset, 0);
  offset = writeUint16(view, offset, 0);
  offset = writeUint16(view, offset, prepared.length);
  offset = writeUint16(view, offset, prepared.length);
  offset = writeUint32(view, offset, centralBytes);
  offset = writeUint32(view, offset, centralOffset);
  offset = writeUint16(view, offset, 0);
  if (offset !== output.length) throw new Error('ZIP size calculation failed');
  return output;
}

function ensureRange(bytes: Uint8Array, offset: number, length: number): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    throw new Error('ZIP structure exceeds archive bounds');
  }
}

function readPath(
  bytes: Uint8Array,
  offset: number,
  length: number,
  maxPathBytes: number,
): { path: string; pathBytes: Uint8Array } {
  ensureRange(bytes, offset, length);
  const pathBytes = bytes.subarray(offset, offset + length);
  let path: string;
  try {
    path = decoder.decode(pathBytes);
  } catch {
    throw new Error('ZIP entry path is not valid UTF-8');
  }
  const canonical = canonicalPath(path, maxPathBytes);
  if (
    canonical.length !== pathBytes.length ||
    canonical.some((value, index) => value !== pathBytes[index])
  ) {
    throw new Error(`ZIP entry path is not canonical UTF-8: ${path}`);
  }
  return { path, pathBytes };
}

interface CentralEntry {
  compressedSize: number;
  crc: number;
  expandedSize: number;
  localOffset: number;
  path: string;
}

/**
 * Parses the end record and central directory before exposing entry bytes.
 * Encrypted, compressed, duplicated, overlapping, or over-limit entries fail
 * the complete archive rather than producing a partial result.
 */
export function decodeStoredZip(
  bytes: Uint8Array,
  limits: StoredZipLimits = DEFAULT_STORED_ZIP_LIMITS,
): Map<string, Uint8Array> {
  if (bytes.length > limits.maxArchiveBytes) {
    throw new Error('ZIP archive size exceeds limit');
  }
  if (bytes.length < 22) throw new Error('ZIP archive is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.length - 22;
  if (view.getUint32(endOffset, true) !== END_OF_CENTRAL_DIRECTORY) {
    throw new Error('ZIP end-of-central-directory record is missing');
  }
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    commentLength !== 0
  ) {
    throw new Error(
      'Unsupported split, commented, or inconsistent ZIP archive',
    );
  }
  if (totalEntries === 0 || totalEntries > limits.maxEntries) {
    throw new Error('ZIP entry count exceeds limits');
  }
  if (centralOffset + centralSize !== endOffset) {
    throw new Error('ZIP central directory range is inconsistent');
  }
  ensureRange(bytes, centralOffset, centralSize);

  const centralEntries: CentralEntry[] = [];
  const paths = new Set<string>();
  let expandedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    ensureRange(bytes, offset, 46);
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error('ZIP central-directory header is invalid');
    }
    const madeByVersion = view.getUint16(offset + 4, true);
    const requiredVersion = view.getUint16(offset + 6, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const modifiedTime = view.getUint16(offset + 12, true);
    const modifiedDate = view.getUint16(offset + 14, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const pathLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const entryCommentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const internalAttributes = view.getUint16(offset + 36, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (
      madeByVersion !== 20 ||
      requiredVersion !== 20 ||
      flags !== UTF8_FLAG ||
      method !== STORED_METHOD ||
      modifiedTime !== 0 ||
      modifiedDate !== DOS_DATE_1980_01_01 ||
      compressedSize !== expandedSize ||
      extraLength !== 0 ||
      entryCommentLength !== 0 ||
      diskStart !== 0 ||
      internalAttributes !== 0 ||
      externalAttributes !== 0
    ) {
      throw new Error(
        'ZIP entry uses a feature unsupported by archive version 1',
      );
    }
    if (expandedSize > limits.maxEntryBytes) {
      throw new Error('ZIP entry exceeds size limit');
    }
    expandedBytes += expandedSize;
    if (expandedBytes > limits.maxExpandedBytes) {
      throw new Error('ZIP expanded size exceeds limit');
    }
    const { path } = readPath(
      bytes,
      offset + 46,
      pathLength,
      limits.maxPathBytes,
    );
    if (paths.has(path)) throw new Error(`Duplicate ZIP entry: ${path}`);
    paths.add(path);
    if (
      centralEntries.length > 0 &&
      compareCodePoints(centralEntries.at(-1)?.path ?? '', path) >= 0
    ) {
      throw new Error('ZIP entries are not in canonical path order');
    }
    centralEntries.push({
      compressedSize,
      crc,
      expandedSize,
      localOffset,
      path,
    });
    offset += 46 + pathLength;
  }
  if (offset !== endOffset)
    throw new Error('ZIP central directory has trailing data');

  const result = new Map<string, Uint8Array>();
  let expectedLocalOffset = 0;
  for (const entry of centralEntries) {
    if (entry.localOffset !== expectedLocalOffset) {
      throw new Error('ZIP local entries are not contiguous and canonical');
    }
    offset = entry.localOffset;
    ensureRange(bytes, offset, 30);
    if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER) {
      throw new Error('ZIP local-file header is invalid');
    }
    const requiredVersion = view.getUint16(offset + 4, true);
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const modifiedTime = view.getUint16(offset + 10, true);
    const modifiedDate = view.getUint16(offset + 12, true);
    const localCrc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const expandedSize = view.getUint32(offset + 22, true);
    const pathLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (
      requiredVersion !== 20 ||
      flags !== UTF8_FLAG ||
      method !== STORED_METHOD ||
      modifiedTime !== 0 ||
      modifiedDate !== DOS_DATE_1980_01_01 ||
      extraLength !== 0 ||
      localCrc !== entry.crc ||
      compressedSize !== entry.compressedSize ||
      expandedSize !== entry.expandedSize
    ) {
      throw new Error('ZIP local and central headers disagree');
    }
    const localPath = readPath(
      bytes,
      offset + 30,
      pathLength,
      limits.maxPathBytes,
    ).path;
    if (localPath !== entry.path) throw new Error('ZIP entry paths disagree');
    const dataOffset = offset + 30 + pathLength;
    ensureRange(bytes, dataOffset, compressedSize);
    const payload = bytes.subarray(dataOffset, dataOffset + compressedSize);
    if (crc32(payload) !== entry.crc) {
      throw new Error(`ZIP entry CRC-32 mismatch: ${entry.path}`);
    }
    result.set(entry.path, payload);
    expectedLocalOffset = dataOffset + compressedSize;
  }
  if (expectedLocalOffset !== centralOffset) {
    throw new Error('ZIP local-file range is inconsistent');
  }
  return result;
}
