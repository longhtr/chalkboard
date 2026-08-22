/** Exhaustive archive round-trip and hostile-input cases for versions, ZIP entries, assets, and resource bounds. */
import { describe, expect, it } from 'vitest';

import type { BoardElement, ImageElement } from '@chalkboard/shared';

import decoratedArchiveBoard from '../../test/fixtures/board-archive-v1-decorated.json';
import { mixedDocumentFromSource } from '../../math/mixedDocument';
import { requiredTestValue } from '../../test/assertions';
import {
  canonicalJson,
  createBoardArchive,
  parseBoardArchive,
  type ResolvedBoardArchiveAsset,
} from './boardArchive';
import { decodeStoredZip, encodeStoredZip } from './storedZip';

const pngBytes = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (value) => value.charCodeAt(0),
);

const equation: BoardElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  fontSize: 30,
  height: 48,
  id: 'equation-1',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: String.raw`Area is $A=\pi r^2$.`,
  strokeColor: '#1f2937',
  strokeWidth: 2,
  type: 'equation',
  width: 220,
  x: 10,
  y: 20,
};

const image: ImageElement = {
  backgroundColor: 'transparent',
  createdBy: 'local',
  height: 100,
  id: 'image-1',
  name: 'pixel.png',
  opacity: 1,
  rotation: 0,
  source: 'data:image/png;base64,ignored-by-resolver',
  strokeColor: 'transparent',
  strokeWidth: 0,
  type: 'image',
  width: 100,
  x: 240,
  y: 20,
};

const resolvedPng: ResolvedBoardArchiveAsset = {
  bytes: pngBytes,
  mediaType: 'image/png',
  pixelHeight: 1,
  pixelWidth: 1,
};

const options = {
  inspectImage: async () => ({ pixelHeight: 1, pixelWidth: 1 }),
  resolveAsset: async () => resolvedPng,
};

function decodeJson(bytes: Uint8Array): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected an archived JSON object');
  }
  return parsed as Record<string, unknown>;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

describe('editable board archive', () => {
  it('round-trips canonical content, appearance, mixed math, and image assets', async () => {
    const first = await createBoardArchive(
      {
        elements: [equation, image],
        font: 'excalifont',
        title: 'Portable board',
      },
      options,
    );
    const second = await createBoardArchive(
      {
        elements: [equation, image],
        font: 'excalifont',
        title: 'Portable board',
      },
      options,
    );

    await expect(sha256(first.bytes)).resolves.toBe(
      '6703bd89e34d61e1b81b51aff9ad02063c4939d023ecdcf3920a3572f7cc7d9a',
    );
    expect(first.filename).toBe('Portable board.chalkboard');
    expect(second.bytes).toEqual(first.bytes);
    const entries = decodeStoredZip(first.bytes);
    expect([...entries.keys()]).toEqual([
      expect.stringMatching(/^assets\/sha256\/[0-9a-f]{64}$/u),
      'board.json',
      'manifest.json',
    ]);
    const storedBoard = decodeJson(
      requiredTestValue(entries.get('board.json'), 'archived board entry'),
    );
    expect(storedBoard).toMatchObject({
      appearance: { font: 'excalifont' },
      schemaVersion: 1,
      title: 'Portable board',
    });
    expect(storedBoard.elements).toEqual([
      expect.objectContaining({ id: equation.id, source: equation.source }),
      expect.objectContaining({
        assetDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        id: image.id,
      }),
    ]);
    expect(
      (storedBoard.elements as Record<string, unknown>[])[1],
    ).not.toHaveProperty('source');

    const parsed = await parseBoardArchive(first.bytes, options);
    expect(parsed).toMatchObject({
      font: 'excalifont',
      title: 'Portable board',
    });
    expect(parsed.elements[0]).toMatchObject({
      ...equation,
      createdBy: 'archive',
    });
    expect(parsed.elements[1]).toMatchObject({
      ...image,
      createdBy: 'archive',
      source: expect.stringMatching(/^data:image\/png;base64,/u),
    });
    expect(parsed.mixedContentByElementId[equation.id]).toMatchObject({
      version: 1,
    });
  });

  it('uses structured mixed content as the archive source authority', async () => {
    const document = mixedDocumentFromSource(
      'Structured archive winner',
      equation.strokeColor,
    );
    const result = await createBoardArchive(
      {
        elements: [{ ...equation, source: 'Stale archive source' }],
        font: 'classic',
        mixedContentByElementId: { [equation.id]: document },
        title: 'Structured authority',
      },
      options,
    );
    const stored = decodeJson(
      requiredTestValue(
        decodeStoredZip(result.bytes).get('board.json'),
        'archived board entry',
      ),
    ) as { elements: { source?: string }[] };
    expect(
      requiredTestValue(stored.elements[0], 'stored structured equation')
        .source,
    ).toBe('Structured archive winner');

    const parsed = await parseBoardArchive(result.bytes, options);
    expect(parsed.elements[0]).toMatchObject({
      id: equation.id,
      source: 'Structured archive winner',
    });
  });

  it('deduplicates identical assets while retaining sorted display names', async () => {
    const result = await createBoardArchive(
      {
        elements: [
          { ...image, id: 'second-image', name: 'zeta.png' },
          { ...image, id: 'first-image', name: 'alpha.png' },
        ],
        font: 'classic',
        title: 'Duplicates',
      },
      options,
    );
    const manifest = decodeJson(
      requiredTestValue(
        decodeStoredZip(result.bytes).get('manifest.json'),
        'archive manifest entry',
      ),
    );

    expect(manifest.assets).toEqual([
      expect.objectContaining({ names: ['alpha.png', 'zeta.png'] }),
    ]);
    expect(
      [...decodeStoredZip(result.bytes).keys()].filter((path) =>
        path.startsWith('assets/'),
      ),
    ).toHaveLength(1);
  });

  it('round-trips every element family, stroke style, and supported image media type', async () => {
    const ascii = (value: string) => new TextEncoder().encode(value);
    const assets = new Map<string, ResolvedBoardArchiveAsset>([
      [
        'avif',
        {
          bytes: ascii('\0\0\0\0ftypavif'),
          mediaType: 'image/avif',
          pixelHeight: 1,
          pixelWidth: 1,
        },
      ],
      [
        'gif',
        {
          bytes: ascii('GIF89a'),
          mediaType: 'image/gif',
          pixelHeight: 1,
          pixelWidth: 1,
        },
      ],
      [
        'jpeg',
        {
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
          mediaType: 'image/jpeg',
          pixelHeight: 1,
          pixelWidth: 1,
        },
      ],
      ['png', resolvedPng],
      [
        'svg',
        {
          bytes: ascii(
            '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
          ),
          mediaType: 'image/svg+xml',
          pixelHeight: 1,
          pixelWidth: 1,
        },
      ],
      [
        'webp',
        {
          bytes: ascii('RIFF\0\0\0\0WEBP'),
          mediaType: 'image/webp',
          pixelHeight: 1,
          pixelWidth: 1,
        },
      ],
    ]);
    const base = {
      backgroundColor: '#fef3c7',
      createdBy: 'private-account-id',
      height: 80,
      opacity: 0.6,
      rotation: 0.25,
      strokeColor: '#7c3aed',
      strokeWidth: 4,
      width: 120,
      x: 10,
      y: 20,
    };
    const everyElement: BoardElement[] = [
      equation,
      {
        ...base,
        cornerRadius: 12,
        id: 'shape',
        shapeKind: 'star',
        strokeStyle: 'dashed',
        type: 'shape',
      },
      {
        ...base,
        arrowheads: 'both',
        id: 'line',
        pathKind: 'bezier',
        segments: [
          {
            control1: { x: 20, y: 10 },
            control2: { x: 80, y: 70 },
            end: { x: 120, y: 80 },
          },
        ],
        strokeStyle: 'dotted',
        type: 'line',
      },
      { ...base, id: 'legacy-arrow', strokeStyle: 'solid', type: 'arrow' },
      {
        ...base,
        id: 'freehand',
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 20 },
          { x: 60, y: 10 },
        ],
        strokeStyle: 'solid',
        type: 'freehand',
      },
      ...[...assets.keys()].map((extension, index): ImageElement => ({
        ...image,
        id: `image-${extension}`,
        name: `asset-${index}.${extension}`,
        source: `data:image/${extension};base64,ignored`,
      })),
    ];
    const archive = await createBoardArchive(
      { elements: everyElement, font: 'classic', title: 'Every element' },
      {
        inspectImage: async () => ({ pixelHeight: 1, pixelWidth: 1 }),
        resolveAsset: async (element) => {
          const extension = element.name.split('.').at(-1) ?? '';
          const asset = assets.get(extension);
          if (asset === undefined) throw new Error('Missing test asset');
          return asset;
        },
      },
    );
    const parsed = await parseBoardArchive(archive.bytes, {
      inspectImage: async () => ({ pixelHeight: 1, pixelWidth: 1 }),
    });

    expect(parsed.elements.map(({ type }) => type)).toEqual(
      everyElement.map(({ type }) => type),
    );
    expect(parsed.elements.map(({ createdBy }) => createdBy)).not.toContain(
      'private-account-id',
    );
    expect(
      parsed.elements
        .filter((element) => element.type === 'image')
        .map(({ source }) => source.split(';')[0]),
    ).toEqual([
      'data:image/avif',
      'data:image/gif',
      'data:image/jpeg',
      'data:image/png',
      'data:image/svg+xml',
      'data:image/webp',
    ]);
  });

  it('round-trips an empty board', async () => {
    const archive = await createBoardArchive({
      elements: [],
      font: 'classic',
      title: 'Empty board',
    });
    await expect(parseBoardArchive(archive.bytes)).resolves.toEqual({
      elements: [],
      font: 'classic',
      mixedContentByElementId: {},
      title: 'Empty board',
    });
  });

  it('rejects future schemas, undeclared entries, and digest mismatches', async () => {
    const result = await createBoardArchive(
      { elements: [equation], font: 'classic', title: 'Validation' },
      options,
    );
    const entries = decodeStoredZip(result.bytes);
    const manifest = decodeJson(
      requiredTestValue(entries.get('manifest.json'), 'archive manifest entry'),
    );

    await expect(
      parseBoardArchive(
        encodeStoredZip([
          ...[...entries]
            .filter(([path]) => path !== 'manifest.json')
            .map(([path, bytes]) => ({ bytes, path })),
          {
            bytes: canonicalJson({ ...manifest, archiveVersion: 2 }),
            path: 'manifest.json',
          },
        ]),
      ),
    ).rejects.toThrow('Unsupported');

    await expect(
      parseBoardArchive(
        encodeStoredZip([
          ...[...entries].map(([path, bytes]) => ({ bytes, path })),
          { bytes: new Uint8Array([1]), path: 'undeclared.bin' },
        ]),
      ),
    ).rejects.toThrow('undeclared');

    const changedBoard = canonicalJson({
      ...decodeJson(
        requiredTestValue(entries.get('board.json'), 'archived board entry'),
      ),
      title: 'Changed without a new digest',
    });
    await expect(
      parseBoardArchive(
        encodeStoredZip(
          [...entries].map(([path, bytes]) => ({
            bytes: path === 'board.json' ? changedBoard : bytes,
            path,
          })),
        ),
      ),
    ).rejects.toThrow(/length|hash/u);
  });

  it('rejects noncanonical JSON even when its digest is declared', async () => {
    const result = await createBoardArchive(
      { elements: [equation], font: 'classic', title: 'Canonical' },
      options,
    );
    const entries = decodeStoredZip(result.bytes);
    const board = decodeJson(
      requiredTestValue(entries.get('board.json'), 'archived board entry'),
    );
    const noncanonicalBoard = new TextEncoder().encode(
      JSON.stringify(board, null, 2),
    );
    const manifest = decodeJson(
      requiredTestValue(entries.get('manifest.json'), 'archive manifest entry'),
    );
    manifest.board = {
      ...(manifest.board as Record<string, unknown>),
      byteLength: noncanonicalBoard.length,
      digest: await sha256(noncanonicalBoard),
    };
    const archive = encodeStoredZip(
      [...entries].map(([path, bytes]) => ({
        bytes:
          path === 'board.json'
            ? noncanonicalBoard
            : path === 'manifest.json'
              ? canonicalJson(manifest)
              : bytes,
        path,
      })),
    );

    await expect(parseBoardArchive(archive)).rejects.toThrow(
      'not canonical JSON',
    );
  });

  it('rejects generated executable and external SVG variants', async () => {
    const variants = [
      '<script>alert(1)</script>',
      '<foreignObject><div>HTML</div></foreignObject>',
      '<image href="https://example.com/tracker.png"/>',
      '<style>@import "https://example.com/style.css"</style>',
      '<rect style="fill:url(#paint)"/>',
      '<rect onclick="alert(1)"/>',
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
    ];
    for (const variant of variants) {
      const svg = new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg">${variant}</svg>`,
      );
      await expect(
        createBoardArchive(
          {
            elements: [{ ...image, name: 'unsafe.svg' }],
            font: 'classic',
            title: 'Unsafe',
          },
          {
            resolveAsset: async () => ({
              bytes: svg,
              mediaType: 'image/svg+xml',
              pixelHeight: 10,
              pixelWidth: 10,
            }),
          },
        ),
      ).rejects.toThrow('executable or external');
    }
  });

  it('round-trips the maximum element-count boundary', async () => {
    const elements: BoardElement[] = Array.from(
      { length: 10_000 },
      (_, index) => ({
        backgroundColor: 'transparent',
        cornerRadius: index % 12,
        createdBy: 'local',
        height: 20,
        id: `large-shape-${index.toString().padStart(5, '0')}`,
        opacity: 1,
        rotation: 0,
        shapeKind: 'rectangle',
        strokeColor: '#111827',
        strokeStyle: 'solid',
        strokeWidth: 2,
        type: 'shape',
        width: 20,
        x: index % 100,
        y: Math.floor(index / 100),
      }),
    );
    const archive = await createBoardArchive({
      elements,
      font: 'excalifont',
      title: 'Maximum element board',
    });
    const parsed = await parseBoardArchive(archive.bytes);

    expect(parsed.elements).toHaveLength(10_000);
    expect(
      requiredTestValue(parsed.elements.at(-1), 'last large-board element').id,
    ).toBe('large-shape-09999');
  }, 20_000);

  it('rejects invalid limits and canonical JSON values', async () => {
    expect(() => canonicalJson({ value: -0 })).toThrow('unsupported number');
    await expect(
      createBoardArchive(
        {
          elements: Array.from({ length: 10_001 }, (_, index) => ({
            ...equation,
            id: `equation-${index}`,
          })),
          font: 'classic',
          title: 'Too many elements',
        },
        options,
      ),
    ).rejects.toThrow('element count');
  });

  // Endpoint decoration and fill styles are persisted board format, not view
  // state. This fixture is the exact `board.json` the writer produced when they
  // were introduced: it fails if either field stops being written, stops being
  // read back, or changes shape.
  it('writes and reads the recorded decorated-element archive', async () => {
    const elements =
      decoratedArchiveBoard.elements as unknown as BoardElement[];
    const archive = await createBoardArchive({
      elements,
      font: 'excalifont',
      title: decoratedArchiveBoard.title,
    });
    const board = requiredTestValue(
      decodeStoredZip(archive.bytes).get('board.json'),
      'archived board document',
    );

    expect(JSON.parse(new TextDecoder().decode(board))).toEqual(
      decoratedArchiveBoard,
    );

    const parsed = await parseBoardArchive(archive.bytes);
    expect(parsed.elements).toEqual([
      expect.objectContaining({ arrowheads: 'both', type: 'freehand' }),
      expect.objectContaining({ fillStyle: 'cross-hatch', type: 'shape' }),
    ]);
  });
});
