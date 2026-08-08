# Editable board file format

A `.chalkboard` file is an editable copy of one board.

| Property             | Value                                  |
| -------------------- | -------------------------------------- |
| File extension       | `.chalkboard`                          |
| Media type           | `application/vnd.chalkboard.board+zip` |
| Archive version      | `1`                                    |
| Board schema version | `1`                                    |

The file is a restricted ZIP archive containing a manifest, a board document, and optional image assets. This document is the version 1 contract.

## Safety rule

Treat every imported byte as hostile.

Validation must finish before writing board metadata or assets to durable storage. A failed, cancelled, unsupported, or over-limit import must not create a board or change the open board.

An archive does not grant access to a cloud board or asset. It must not contain account, membership, session, authorization, presence, pending-update, private asset URL, trash, local route, or recovery-cache data.

## Contents

An archive contains exactly:

```text
manifest.json
board.json
assets/sha256/<digest>    optional, one per unique asset
```

`<digest>` is 64 lowercase hexadecimal characters.

Every entry except `manifest.json` is declared once in the manifest. Every declaration has exactly one matching ZIP entry. Extra or duplicate entries are invalid.

Paths must already be canonical. Reject paths containing:

- empty segments, `.` or `..`;
- a leading or trailing slash;
- backslashes;
- NUL or control characters;
- percent-encoded traversal;
- more than 160 UTF-8 bytes.

## Versioning

The two version numbers are independent:

- `archiveVersion` controls the ZIP profile, manifest, paths, and asset declarations.
- `boardSchemaVersion` controls the structure and meaning of `board.json`.

Reject an unsupported future version before durable writes. Writers emit only versions they implement.

An optional element field does not require a new version if its absence has a documented default and old readers may safely ignore it. A semantic change that readers must understand requires a new version.

## ZIP rules

Version 1 uses a deliberately small deterministic ZIP profile:

- entries use compression method `0` (stored, not compressed);
- names are UTF-8 and set the UTF-8 flag;
- encryption, data descriptors, ZIP64, split archives, extra fields, comments, and directory entries are forbidden;
- CRC-32 and compressed/expanded sizes agree in both headers and match the bytes;
- DOS date and time are fixed to `1980-01-01 00:00:00`;
- central and local entries are sorted by path using Unicode code-point order;
- no bytes appear before, between, or after the declared ZIP structures.

Stored entries let the reader enforce compressed and expanded limits before allocating entry payloads.

## Canonical JSON

`manifest.json` and `board.json` are canonical UTF-8 JSON:

- no byte-order mark;
- object keys sorted by Unicode code-point order;
- arrays left in semantic order;
- no insignificant whitespace;
- standard JSON string escaping;
- finite JSON numbers only, with no negative zero;
- no duplicate object keys;
- no newline or other bytes after the JSON value.

Equivalent exports are therefore byte-identical. Export time, application build, board ID, and user ID are intentionally omitted.

## Manifest

Example:

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
- Assets are sorted by digest.
- Each digest is lowercase SHA-256 of the exact entry bytes.
- Each byte length matches the exact entry length.
- Asset media type is one of `image/avif`, `image/gif`, `image/jpeg`, `image/png`, `image/svg+xml`, or `image/webp`.
- Width and height are positive integers for the decoded intrinsic dimensions. SVG uses the bounded rasterization dimensions selected by the exporter.
- `names` is the sorted unique set of original display names for that digest. A name contains no path and is at most 255 Unicode scalar values.

`manifest.json` does not hash itself.

## Board document

Example:

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

- `title` contains 1 to 160 Unicode scalar values after trimming. Export normalizes an empty title to `Untitled board`.
- `appearance.font` is `excalifont` or `classic`.
- `elements` retains stacking order.
- Non-image entries use the canonical `BoardElement` representation.
- An image entry omits `source` and contains `assetDigest`, which identifies one manifest asset.
- Element IDs are local to the archive. Import creates a new board ID and new element IDs.
- Future element references must be declared by the schema and rewritten through the same ID map.
- `mixedContentByElementId` contains versioned structured mixed-content documents. Every key refers to an equation element in `elements`.
- Equation elements retain canonical `source` for compatibility and recovery. Structured mixed content is authoritative when both are present.

Version 1 appearance includes only the font. It excludes grid settings, camera, selection, tool, palettes, input mode, caret positions, and UI layout because those belong to the user or workspace.

## Limits

Reject an archive when any limit is exceeded:

| Resource                       |                                            Limit |
| ------------------------------ | -----------------------------------------------: |
| Archive bytes                  |                                           64 MiB |
| Expanded bytes                 |                                           64 MiB |
| Entries                        | 258 total: manifest, board, and up to 256 assets |
| Path                           |                                  160 UTF-8 bytes |
| `manifest.json`                |                                          256 KiB |
| `board.json`                   |                                           16 MiB |
| Elements                       |                                           10,000 |
| Title                          |                        160 Unicode scalar values |
| One equation source            |                                      1 MiB UTF-8 |
| All equation sources           |                                      8 MiB UTF-8 |
| Points in one freehand element |                                            4,096 |
| Points across the board        |                                        1,000,000 |
| One asset                      |                                           32 MiB |
| All assets                     |                                           60 MiB |
| Assets                         |                                              256 |
| One decoded image              |                                40,000,000 pixels |
| All decoded images             |                               100,000,000 pixels |
| Asset display name             |                        255 Unicode scalar values |

Check archive size, entry count, headers, paths, declared sizes, and aggregate sizes before copying payloads. Check image dimensions from both the manifest and decoded content when the browser exposes decoded dimensions.

## Asset validation

A raster asset must decode as its declared media type. Reject conflicting signatures or sniffed media types.

SVG must be UTF-8. Reject SVG containing:

- scripts or event-handler attributes;
- foreign objects or embedded browsing, media, or object elements;
- XML processing instructions, DTDs, or entity declarations;
- external or network URLs;
- non-fragment `href` or `xlink:href` values;
- CSS imports or CSS `url()` values.

Archive validation performs no SVG repair. Rejected bytes never reach durable storage, and SVG never executes during validation.

Revoke object URLs and release decoded image objects after validation.

## Export procedure

1. Read one durable repository snapshot.
2. Normalize the title, elements, mixed content, and appearance.
3. Resolve every local blob or authorized cloud asset to bytes.
4. Validate media type, decoded dimensions, and limits.
5. Hash assets, deduplicate by digest, and replace image `source` with `assetDigest`.
6. Canonically encode and hash `board.json`.
7. Canonically encode `manifest.json`.
8. Build the ZIP in path order.
9. Parse and validate the completed bytes with the shipping reader.
10. Offer `<sanitized-title>.chalkboard` for download.

An export failure produces no download.

## Import procedure

1. Read no more than 64 MiB.
2. In a module worker where supported, inspect the end record, headers, paths, methods, flags, sizes, and ranges without expanding entries.
3. Enforce structural and aggregate limits. Verify CRC-32 while reading stored payloads.
4. Parse canonical `manifest.json` and reject unsupported versions.
5. Match declarations one-to-one. Verify each SHA-256 digest and byte length.
6. Parse and validate `board.json`, references, mixed content, media, SVG, dimensions, and totals.
7. Generate a new board ID and element-ID map.
8. Stage the complete board and assets in one repository transaction.
9. Commit, update compatibility caches, and open the new local route.

Cancellation or failure before commit discards staging and leaves durable data unchanged.

## Other export formats

Snapshot links, PNG files, and SVG files are not `.chalkboard` archives and cannot be imported as one.

Snapshot links are editable, unsynchronized, URL-bounded convenience copies. They are not access control or backup. PNG and SVG are publishing formats and do not promise editability.
