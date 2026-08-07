# Chalkboard editable board format

Status: 1.0 format contract  
File extension: `.chalkboard`  
Media type: `application/vnd.chalkboard.board+zip`

## 1. Purpose and trust boundary

A `.chalkboard` file is an editable, portable copy of one board. It is a ZIP container with a manifest, a board document, and zero or more content-addressed image assets.

Importers must treat every byte as hostile. Validation completes before any board metadata or asset is written to durable storage. A failed, cancelled, unsupported, or over-limit import creates no board and changes no open board.

The format does not grant access to a cloud board or asset. It contains no account, membership, session, authorization, collaboration-awareness, pending-update, private asset URL, trash, local route, or recovery-cache data.

## 2. Versioning

Two independent integer versions are required:

- `archiveVersion` describes the ZIP profile, manifest, paths, and asset declarations.
- `boardSchemaVersion` describes `board.json`.

This document defines archive version `1` and board schema version `1`.

A reader must reject an unsupported future version before durable writes. A writer emits only its current versions. When a successor format is introduced, keep the previous reader unless a documented migration makes it unnecessary.

Adding an optional element field does not bump either version: an absent field means the documented default, so an older reader ignores it and a newer reader still accepts archives written before it existed. A change that alters the meaning of existing data, or that a reader must understand to read the board correctly, does require a new version.

## 3. ZIP profile

Version 1 uses a restricted deterministic ZIP profile:

- all entries use ZIP compression method `0` (stored, not compressed);
- entry names are UTF-8 and set the UTF-8 general-purpose flag;
- encryption, data descriptors, ZIP64, split archives, extra fields, comments, and directory entries are forbidden;
- CRC-32, compressed size, and expanded size must agree between local and central headers and with the entry bytes;
- DOS date/time is fixed to `1980-01-01 00:00:00`;
- central-directory entries and local entries are sorted by path using Unicode code-point order;
- no bytes may occur before the first local header, between declared structures, or after the end-of-central-directory record.

Restricting v1 to stored entries permits compressed and expanded limits to be checked before entry allocation. Later archive versions may add bounded streaming decompression.

## 4. Paths and entries

An archive contains exactly:

1. `manifest.json`
2. `board.json`
3. zero or more `assets/sha256/<digest>` entries

`<digest>` is 64 lowercase hexadecimal characters. Paths must already be canonical. Empty segments, `.`, `..`, leading `/`, trailing `/`, backslashes, NULs, control characters, percent-encoded traversal, and duplicate names are forbidden. Paths are at most 160 UTF-8 bytes.

Every entry except `manifest.json` is declared exactly once by the manifest. Every manifest declaration has exactly one ZIP entry. Undeclared entries are rejected.

## 5. Canonical JSON

`manifest.json` and `board.json` are UTF-8 JSON without a byte-order mark. They use the following canonical representation:

- object keys sorted by Unicode code-point order;
- arrays retain semantic order;
- no insignificant whitespace;
- strings use JSON escaping;
- numbers are finite JSON numbers; `NaN`, infinities, and negative zero are forbidden;
- no duplicate object keys;
- files end immediately after the JSON value, without a newline.

These rules make equivalent exports byte-identical. Export time, application build, board ID, and user ID are intentionally omitted.

## 6. `manifest.json`

```json
{
  "archiveVersion": 1,
  "assets": [
    {
      "byteLength": 68,
      "digest": "<sha256>",
      "mediaType": "image/png",
      "names": ["diagram.png"],
      "path": "assets/sha256/<sha256>",
      "pixelHeight": 1,
      "pixelWidth": 1
    }
  ],
  "board": {
    "byteLength": 1234,
    "digest": "<sha256>",
    "mediaType": "application/json",
    "path": "board.json"
  },
  "boardSchemaVersion": 1,
  "format": "chalkboard-board"
}
```

Rules:

- `format` is exactly `chalkboard-board`.
- Assets are sorted by `digest`.
- `digest` is lowercase SHA-256 of the exact entry bytes.
- `byteLength` is the exact entry byte length.
- `mediaType` is one of `image/avif`, `image/gif`, `image/jpeg`, `image/png`, `image/svg+xml`, or `image/webp`.
- `pixelWidth` and `pixelHeight` are positive integers describing decoded intrinsic dimensions. SVG dimensions are the bounded rasterization dimensions chosen by the exporter.
- `names` is the sorted, unique set of original display names referencing that digest. Names are metadata only: they contain no path and are at most 255 Unicode scalar values.

`manifest.json` does not hash itself.

## 7. `board.json`

```json
{
  "appearance": {
    "font": "excalifont"
  },
  "elements": [],
  "mixedContentByElementId": {},
  "schemaVersion": 1,
  "title": "Untitled board"
}
```

Rules:

- `title` is 1–160 Unicode scalar values after trimming. Empty titles normalize to `Untitled board` when exporting.
- `appearance.font` is `excalifont` or `classic`.
- `elements` preserves board stacking order.
- Non-image elements use the current canonical `BoardElement` representation.
- An image element omits `source` and adds `assetDigest`, whose value identifies one manifest asset.
- Element IDs are archive-local references. Import generates a fresh board ID and fresh element IDs. Any future internal element references must be declared by the board schema and rewritten through the same ID map.
- `mixedContentByElementId` contains versioned structured mixedContent documents for equation elements. Its keys must exactly reference equation IDs present in `elements` after unsupported entries are rejected. The canonical equation `source` remains in each equation element for compatibility and recovery.

Appearance v1 includes only the board font. Grid visibility/spacing, camera, selection, active tool, custom palettes, input mode, caret positions, and UI layout are user/workspace state and are excluded.

## 8. Resource limits

A v1 reader rejects the archive when any limit is exceeded:

| Resource                       |                                   Limit |
| ------------------------------ | --------------------------------------: |
| Archive bytes                  |                                  64 MiB |
| Expanded bytes                 |                                  64 MiB |
| Entries                        | 258 (manifest, board, up to 256 assets) |
| Path length                    |                         160 UTF-8 bytes |
| `manifest.json`                |                                 256 KiB |
| `board.json`                   |                                  16 MiB |
| Elements                       |                                  10,000 |
| Board title                    |               160 Unicode scalar values |
| One equation source            |                             1 MiB UTF-8 |
| All equation sources           |                             8 MiB UTF-8 |
| Points in one freehand element |                                   4,096 |
| Points across the board        |                               1,000,000 |
| One asset                      |                                  32 MiB |
| All assets                     |                                  60 MiB |
| Assets                         |                                     256 |
| One decoded image              |                       40,000,000 pixels |
| All decoded images             |                      100,000,000 pixels |
| Asset display name             |               255 Unicode scalar values |

Readers check archive, entry-count, header, path, declared-size, and aggregate-size limits before copying entry payloads. Pixel dimensions are checked from both the manifest and decoded content where the browser exposes decoded dimensions.

## 9. Asset safety

Raster assets must decode as their declared media type. Media sniffing that conflicts with the declaration is rejected.

SVG is UTF-8 text and is rejected if it contains scripts, event-handler attributes, foreign objects, embedded browsing/media/object elements, XML processing instructions, DTD/entity declarations, external URLs, network references, non-fragment `href`/`xlink:href`, CSS imports, or CSS `url()` values. The archive validator is intentionally stricter than interactive SVG image import and performs no repair: rejected SVG never reaches durable commit. SVG never executes during validation.

Object URLs and decoded image objects are revoked/released after validation.

## 10. Export algorithm

1. Read one repository snapshot at a durable boundary.
2. Normalize title, elements, mixedContent documents, and appearance.
3. Resolve every local blob or authorized cloud asset to bytes.
4. Validate media type, decoded dimensions, and all limits.
5. Hash assets, deduplicate by digest, and replace image `source` with `assetDigest`.
6. Canonically encode and hash `board.json`.
7. Canonically encode `manifest.json`.
8. Build the deterministic ZIP in path order.
9. Parse and validate the completed archive with the shipping reader.
10. Offer `<sanitized-title>.chalkboard` for download.

An export failure produces no download.

## 11. Import algorithm

1. Read no more than the archive byte limit.
2. In an isolated module worker where supported, parse EOCD, central headers, paths, methods, flags, sizes, and ranges without expanding entries.
3. Enforce structural and aggregate limits; verify CRC-32 while reading stored payloads.
4. Parse canonical `manifest.json`; reject unsupported versions.
5. Match declarations one-to-one and verify every SHA-256 digest and byte length.
6. Parse and validate `board.json`, references, mixed content, media, SVG safety, dimensions, and resource totals.
7. Generate a new board ID and element-ID map.
8. Stage the complete board and all assets in one repository transaction.
9. Commit, then publish compatibility caches and open the new local route.

Cancellation or failure before step 9 discards in-memory staging and leaves existing durable state unchanged.

## 12. Snapshot links and visual exports

Snapshot links, PNG, and SVG visual exports are separate formats and are not accepted as `.chalkboard` archives. Snapshot links remain editable, unsynchronized, URL-bounded convenience copies; they are not access control or backup. PNG/SVG remain publishing outputs and do not promise editability.
