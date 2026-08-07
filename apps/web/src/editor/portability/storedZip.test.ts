/** Covers stored ZIP round trips and every structural, path, size, method, duplicate, and checksum rejection. */
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import {
  crc32,
  decodeStoredZip,
  encodeStoredZip,
  type StoredZipEntry,
} from './storedZip';

const text = (value: string) => new TextEncoder().encode(value);
const decodedText = (value: Uint8Array) => new TextDecoder().decode(value);

const entries: StoredZipEntry[] = [
  { bytes: text('{"title":"Board"}'), path: 'board.json' },
  { bytes: text('{"archiveVersion":1}'), path: 'manifest.json' },
  { bytes: new Uint8Array([1, 2, 3]), path: `assets/sha256/${'a'.repeat(64)}` },
];

describe('stored ZIP archive profile', () => {
  it('writes byte-identical archives in canonical path order', () => {
    const first = encodeStoredZip(entries);
    const second = encodeStoredZip([...entries].reverse());

    expect(second).toEqual(first);
    const decoded = decodeStoredZip(first);
    expect([...decoded.keys()]).toEqual([
      `assets/sha256/${'a'.repeat(64)}`,
      'board.json',
      'manifest.json',
    ]);
    expect(
      decodedText(
        requiredTestValue(decoded.get('board.json'), 'decoded board entry'),
      ),
    ).toBe('{"title":"Board"}');
    expect(decoded.get(`assets/sha256/${'a'.repeat(64)}`)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('uses the standard CRC-32 representation', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
  });

  it('rejects duplicate and noncanonical paths before writing', () => {
    expect(() =>
      encodeStoredZip([
        { bytes: text('first'), path: 'board.json' },
        { bytes: text('second'), path: 'board.json' },
      ]),
    ).toThrow('Duplicate ZIP entry');
    for (const path of [
      '../board.json',
      '/board.json',
      'folder\\board.json',
      'folder//board.json',
      'folder/%2e%2e/board.json',
    ]) {
      expect(() => encodeStoredZip([{ bytes: text('x'), path }])).toThrow(
        'not canonical',
      );
    }
  });

  it('rejects payload corruption, trailing bytes, and unsupported compression', () => {
    const encoded = encodeStoredZip(entries);
    const corruptPayload = encoded.slice();
    const firstNameLength = new DataView(corruptPayload.buffer).getUint16(
      26,
      true,
    );
    const payloadOffset = 30 + firstNameLength;
    corruptPayload[payloadOffset] = (corruptPayload[payloadOffset] ?? 0) ^ 0xff;
    expect(() => decodeStoredZip(corruptPayload)).toThrow('CRC-32 mismatch');

    const trailing = new Uint8Array(encoded.length + 1);
    trailing.set(encoded);
    expect(() => decodeStoredZip(trailing)).toThrow('end-of-central-directory');

    const compressed = encoded.slice();
    const view = new DataView(compressed.buffer);
    view.setUint16(8, 8, true);
    const endOffset = compressed.length - 22;
    const centralOffset = view.getUint32(endOffset + 16, true);
    view.setUint16(centralOffset + 10, 8, true);
    expect(() => decodeStoredZip(compressed)).toThrow('unsupported');
  });

  it('enforces archive limits before copying entry payloads', () => {
    expect(() =>
      encodeStoredZip([{ bytes: new Uint8Array(5), path: 'board.json' }], {
        maxArchiveBytes: 1_000,
        maxEntries: 2,
        maxEntryBytes: 4,
        maxExpandedBytes: 10,
        maxPathBytes: 160,
      }),
    ).toThrow('entry exceeds size limit');

    const encoded = encodeStoredZip(entries);
    expect(() =>
      decodeStoredZip(encoded, {
        maxArchiveBytes: encoded.length - 1,
        maxEntries: 10,
        maxEntryBytes: 100,
        maxExpandedBytes: 1_000,
        maxPathBytes: 160,
      }),
    ).toThrow('archive size exceeds limit');
  });
});
