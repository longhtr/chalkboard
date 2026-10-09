/**
 * Supplies valid and hostile bytes for every supported image container to prove
 * signatures, dimensions, structure, names, limits, and SVG resource policy.
 */
import { crc32 } from '@chalkboard/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../test/assertions.js';
import { AssetValidationError, validateAsset } from './validation.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const GIF = Buffer.from(
  'R0lGODlhAQABAPAAAAAAAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const WEBP = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vv9UAA=',
  'base64',
);
const RASTER_CORPUS = [
  ['10bit-64x48.avif', 'image/avif'],
  ['animated-64x48.gif', 'image/gif'],
  ['animated-64x48.webp', 'image/webp'],
  ['interlaced-64x48.png', 'image/png'],
  ['lossy-64x48.webp', 'image/webp'],
  ['progressive-64x48.jpg', 'image/jpeg'],
  ['static-64x48.avif', 'image/avif'],
  ['static-64x48.gif', 'image/gif'],
  ['static-64x48.jpg', 'image/jpeg'],
  ['static-64x48.png', 'image/png'],
  ['static-64x48.webp', 'image/webp'],
] as const;

function corpusFixture(name: string): Buffer {
  return readFileSync(
    new URL(`../../../../tests/media/${name}`, import.meta.url),
  );
}

function bmffBox(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function avif(
  width: number,
  height: number,
  prefix: Buffer = Buffer.alloc(0),
): Buffer {
  const fileType = bmffBox(
    'ftyp',
    Buffer.concat([Buffer.from('avif'), Buffer.alloc(4), Buffer.from('avif')]),
  );
  const spatialExtent = Buffer.alloc(12);
  spatialExtent.writeUInt32BE(width, 4);
  spatialExtent.writeUInt32BE(height, 8);
  const properties = bmffBox('ipco', bmffBox('ispe', spatialExtent));
  const itemProperties = bmffBox('iprp', properties);
  const metadata = bmffBox(
    'meta',
    Buffer.concat([Buffer.alloc(4), itemProperties]),
  );
  return Buffer.concat([
    fileType,
    prefix,
    metadata,
    bmffBox('mdat', Buffer.from([0])),
  ]);
}

describe('asset validation', () => {
  it('reads dimensions from image bytes and normalizes the file name', () => {
    expect(
      validateAsset({
        content: PNG,
        mediaType: 'image/png',
        name: '../one\u0000.png',
      }),
    ).toMatchObject({
      height: 1,
      mediaType: 'image/png',
      name: '.. one .png',
      width: 1,
    });
  });

  it('accepts the maintained cross-browser raster corpus', () => {
    for (const [name, mediaType] of RASTER_CORPUS) {
      expect(
        validateAsset({ content: corpusFixture(name), mediaType }),
      ).toMatchObject({ height: 48, mediaType, width: 64 });
    }
  });

  it('structurally validates complete GIF, JPEG, PNG, and WebP containers', () => {
    for (const [content, mediaType] of [
      [GIF, 'image/gif'],
      [JPEG, 'image/jpeg'],
      [PNG, 'image/png'],
      [WEBP, 'image/webp'],
    ] as const) {
      expect(validateAsset({ content, mediaType })).toMatchObject({
        height: 1,
        width: 1,
      });
      expect(() =>
        validateAsset({
          content: content.subarray(0, -1),
          mediaType,
        }),
      ).toThrow('format or dimensions are invalid');
    }
    expect(() =>
      validateAsset({
        content: Buffer.concat([WEBP, Buffer.from([0])]),
        mediaType: 'image/webp',
      }),
    ).toThrow('format or dimensions are invalid');

    const oversizedGifFrame = Buffer.from(GIF);
    const imageDescriptor = oversizedGifFrame.indexOf(0x2c);
    oversizedGifFrame.writeUInt16LE(0xffff, imageDescriptor + 5);
    expect(() =>
      validateAsset({ content: oversizedGifFrame, mediaType: 'image/gif' }),
    ).toThrow('dimensions are too large');

    expect(() =>
      validateAsset({
        content: Buffer.from([
          0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x01, 0x00, 0x01,
          0xff, 0xd9,
        ]),
        mediaType: 'image/jpeg',
      }),
    ).toThrow('format or dimensions are invalid');
  });

  it('rejects mislabeled, oversized-dimension, and unsupported data', () => {
    expect(() =>
      validateAsset({ content: PNG, mediaType: 'image/jpeg' }),
    ).toThrow('format or dimensions are invalid');

    const huge = Buffer.from(PNG);
    huge.writeUInt32BE(16_385, 16);
    huge.writeUInt32BE(crc32(huge.subarray(12, 29)), 29);
    expect(() =>
      validateAsset({ content: huge, mediaType: 'image/png' }),
    ).toThrow('dimensions are too large');

    expect(() =>
      validateAsset({ content: PNG, mediaType: 'application/octet-stream' }),
    ).toThrow('Unsupported image type');
  });

  it('parses AVIF boxes structurally instead of trusting a raw ispe byte sequence', () => {
    expect(
      validateAsset({
        content: corpusFixture('static-64x48.avif'),
        mediaType: 'image/avif',
      }),
    ).toMatchObject({ height: 48, width: 64 });

    const forgedExtent = Buffer.alloc(16);
    forgedExtent.write('ispe');
    forgedExtent.writeUInt32BE(1, 8);
    forgedExtent.writeUInt32BE(1, 12);
    expect(() =>
      validateAsset({
        content: avif(20_000, 20_000, bmffBox('free', forgedExtent)),
        mediaType: 'image/avif',
      }),
    ).toThrow('dimensions are too large');

    expect(() =>
      validateAsset({
        content: Buffer.concat([
          bmffBox(
            'ftyp',
            Buffer.concat([
              Buffer.from('avif'),
              Buffer.alloc(4),
              Buffer.from('avif'),
            ]),
          ),
          Buffer.from('ispe\0\0\0\0\0\0\0\x01\0\0\0\x01'),
        ]),
        mediaType: 'image/avif',
      }),
    ).toThrow('format or dimensions are invalid');
  });

  it('rejects malformed randomized containers without leaking parser errors', () => {
    let state = 0x1234_5678;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const mediaTypes = [
      'image/avif',
      'image/gif',
      'image/jpeg',
      'image/png',
      'image/svg+xml',
      'image/webp',
    ] as const;
    for (let index = 0; index < 2_000; index += 1) {
      const content = Buffer.alloc(random() % 2_048);
      for (let offset = 0; offset < content.length; offset += 1) {
        content[offset] = random() & 0xff;
      }
      try {
        validateAsset({
          content,
          mediaType: requiredTestValue(
            mediaTypes[index % mediaTypes.length],
            'fuzzed media type',
          ),
        });
      } catch (error) {
        expect(error).toBeInstanceOf(AssetValidationError);
      }
    }
  });

  it('accepts self-contained SVG and rejects executable or external content', () => {
    const safe = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><path d="M0 0h1"/></svg>',
    );
    expect(
      validateAsset({ content: safe, mediaType: 'image/svg+xml' }),
    ).toMatchObject({ height: 180, width: 320 });

    for (const source of [
      '<svg width="10" height="10"><script>alert(1)</script></svg>',
      '<svg width="10" height="10"><image href="https://example.com/a.png"/></svg>',
      '<svg width="10" height="10"><image href="data:image/png;base64,iVBORw0KGgo="/></svg>',
      '<svg width="10" height="10"><path onclick="alert(1)"/></svg>',
      '<svg width="10" height="10"><style>path { fill: url(https://example.com) }</style></svg>',
    ]) {
      expect(() =>
        validateAsset({
          content: Buffer.from(source),
          mediaType: 'image/svg+xml',
        }),
      ).toThrow(AssetValidationError);
    }
  });
});
