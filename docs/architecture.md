# Chalkboard architecture

This document explains Chalkboard's stable runtime, state, and trust boundaries. Use [`codebase-guide.md`](codebase-guide.md) to find their implementations and tests.

## System boundaries

```text
Browser
  React workspace and dialogs
  Canvas and DOM rendering
  MathLive editor
  IndexedDB local data and cloud recovery
  Yjs collaboration client
       │ same-origin HTTP and WebSocket
       ▼
Web proxy
  Static application and security headers
  API, health, and collaboration proxying
       ▼
Fastify server — one realtime instance
  Accounts, boards, assets, authorization
  Yjs rooms, persistence, metrics, drain
       ▼
PostgreSQL
  Accounts, sessions, memberships, assets
  Yjs snapshots and update tails
  Migration fingerprints
```

The design permits one collaboration server. Multi-instance operation requires shared room ownership, ordering, fanout, and acknowledgement authority; running another in-memory room owner is not horizontal scaling.

Repository ownership follows the runtime:

- `apps/web`: browser UI, editor, rendering, local storage, exports, and collaboration client.
- `apps/server`: HTTP/WebSocket boundaries, authorization, PostgreSQL persistence, and operations.
- `apps/shared/src`: environment-neutral board schemas, geometry, mixed-content structures, Yjs codecs, and diagnostics contracts.
- `tests`: browser-level behavior, recovery, and accessibility stories.

Shared code must not depend on DOM, IndexedDB, Fastify, or PostgreSQL. Browser code does not query databases, and server code does not trust browser role state. A shared type belongs in `apps/shared/src` only when multiple runtimes require the same semantic contract.

## Board and editor model

A board contains bounded, uniquely identified world-space elements: shapes, paths and arrows, freehand strokes, mixed text/mathematics, and images. Viewport pixels and device-pixel ratio never enter persisted geometry. Legacy records normalize at serialization boundaries; unsupported future schemas are inspected safely or rejected, never rewritten by an older client.

The editor separates committed document history from transient camera, pointer, selection, measurement, and equation drafts. Pointer-frequency state stays in mutable controllers and animation-frame rendering rather than React state. One semantic action creates one bounded history entry; previews do not.

All visual layers consume the same camera transform:

```text
screenPoint = worldPoint × zoom + viewportOffset
```

The workspace combines a grid canvas, bounded content canvases, DOM overlays for text/images, and an interaction overlay. Culling, hit testing, DOM mounting, and drawing use the same world-space viewport and committed derived view. Backing stores, detailed mathematics, spatial overlays, object navigation, history, clipboard payloads, and board cardinality all have explicit limits enforced by their owning modules.

`Workspace.tsx` orchestrates these owners. Extract a controller or component only when it owns a complete lifecycle with independent tests; do not split it merely to move lines.

## Mixed prose and mathematics

Mixed content has three representations:

1. structured rows and styled text/math spans for storage and collaboration;
2. reversible canonical source at compatibility and archive boundaries;
3. a temporary MathLive value containing editor-only markers.

Structured content is authoritative when both it and compatibility source exist. Local persistence, cloud Yjs records, and archives regenerate source deterministically. Editor-only markers never persist.

A mixed block is one board element. Math-only content opens MathLive in math mode; mixed content uses one text-mode field with embedded math regions so caret movement, selection, clipboard, undo, and mode changes cross boundaries coherently.

The active editor is transactional rather than a conventional controlled input:

- MathLive is the only visible renderer while editing.
- MathLive atom offsets, source indices, history positions, and screen coordinates have explicit conversions.
- The normalized host input event is accepted; the preceding keyboard-sink event is ignored.
- Undo restores source and mode before selection.
- One canonical snapshot feeds history and workspace publication; identical publications are suppressed.
- Persistence and collaboration cannot block immediate editor presentation.
- Malformed intermediate source retains the last safe inactive rendering.

Inactive rendering sanitizes canonical source and converts it through MathLive. Static markup, last-valid representations, observers, and density detail are bounded. Font changes replace one complete 20-face set—Excalifont or classic MathLive/KaTeX—wait for font readiness, then rerender and remeasure. The same font choice applies to editing and exports. Vendored font changes require their atomic checksum, license, browser, geometry, and export review.

MathJax is a lazy export fallback, not an interactive renderer. PNG and SVG generation prepare every equation independently of viewport culling; editable archives remain a separate format.

## Local persistence

IndexedDB is the local durability authority. Board records and image blobs are separate so large media does not consume synchronous storage quota. The repository owns transactions, metadata, assets, migration, cache repair, and cross-tab notification; components do not coordinate those independently.

A bounded localStorage layer provides provisional startup and crash-recovery data. It is never called durable and cannot override a newer IndexedDB record. Cache failure cannot invalidate a successful database transaction. Pending recovery may represent one equation edit, a small semantic patch, or a complete snapshot; startup applies it only to an accepted durable base and cannot resurrect stale deletions.

Persistent replacement follows these rules:

- preserve the previous board until one IndexedDB transaction commits;
- write board and owned-image changes atomically;
- reject stale revisions before mutation;
- clear only the exact recovery record represented by the durable winner;
- publish cache and cross-tab notifications after commit;
- reread IndexedDB on compatibility notifications instead of trusting event payloads.

Connections reopen once after a stale handle, invalidate on version change, and reject blocked upgrades into recovery UI. Migration is idempotent and fixture-backed. `/local/:id` is canonical; a missing/corrupt route offers recovery without implicitly creating or overwriting that ID.

Duplicate and import operations generate new board and element identities and preserve their source if the destination transaction fails. Trash retains recoverable assets; permanent deletion removes only data owned by that board.

## Cloud collaboration and durability

Each cloud board maps to one Yjs document containing schema/title metadata, nested element records, deterministic order, and structured mixed content. Awareness carries ephemeral presence only and is never authorization or durable board state. Local-origin transactions use Yjs undo tracking so collaborator work is not reverted.

The browser cache retains an acknowledged baseline, reconstructed board, pending Yjs updates, and recovery status. Connection labels have distinct meanings:

- **Connected** describes transport.
- **Synchronizing** means represented work is not fully acknowledged.
- **Saved** means every represented local update has a durable server sequence.
- **Offline/Connection failed** retains explicit device-pending work.
- **Read only/Incompatible** prohibits mutation while preserving safe inspection.

Pending updates clear only in server acknowledgement order. Replay is idempotent. Socket events are scoped to a connection generation so disposed sockets cannot mutate current recovery state. Reconnect attempts, recovery documents, pending updates, cache queues, and semantic reconciliation are count-, byte-, age-, timeout-, and teardown-bounded.

A WebSocket upgrade validates origin, session, board role, identifier, and rate admission before joining a room. The room loads one consistent PostgreSQL snapshot and update tail, synchronizes Yjs, relays bounded Awareness, rejects viewer writes, appends accepted updates durably, and acknowledges only after append.

Room loading, active use, persistence, final compaction, and retirement serialize per board. Document, frame, queue, age, compaction, and Awareness limits reject before unbounded or undurable state enters the room. Authorization changes affect connected sessions, not only future upgrades.

For every update:

1. admit it against room/process bounds;
2. apply and relay it in the active room;
3. append it to `yjs_updates`;
4. return its durable sequence to the source;
5. compact at a bounded threshold or retirement.

Compaction advances a snapshot only through a known durable sequence and deletes only its covered tail. Graceful shutdown rejects upgrades, marks readiness unhealthy, closes clients with restart semantics, drains persistence/final compaction, and then closes PostgreSQL.

## Accounts, assets, and API security

PostgreSQL owns users, opaque hashed sessions, boards, roles, invitation records, immutable board assets, Yjs state, and migration checksums. REST, assets, and WebSocket access authorize independently. Owner/editor/viewer UI state is presentation, never authority.

Passwords and email verification codes use bounded Argon2 work; retained legacy password hashes upgrade only after successful authentication. Registration persists an expiring pending record and creates no user until the emailed code succeeds. Email changes preserve the old address until the new address is verified. Password recovery returns the same public response for known and unknown addresses, and a successful reset revokes existing sessions. Verification messages, delivered through the Amazon SES API, contain the code in the subject and have an intentionally empty body. Invitation tokens are opaque, expiring, revocable, fragment-delivered, and stored only as hashes. Board trash, restore, membership, invitations, and permanent deletion remain server-authorized operations.

Cloud assets are immutable and board-scoped. The server validates authorization, type/signature, byte size, declared dimensions, structural container limits, and SVG safety before commit. Browser decoding is part of the supported product path but does not weaken server admission. Yjs stores authorized asset references, not image bytes.

Every API body, parameter, archive, asset, WebSocket frame, queue, and expensive operation has explicit admission. The browser also decodes each successful JSON response before application state can use it; TypeScript types alone are not treated as runtime validation. SQL is parameterized. Production mode enforces exact origin, secure cookies, CSP/HSTS/anti-framing/MIME/referrer/permissions policies, private PostgreSQL/API/metrics boundaries, redacted structured logs, and coarse content-free metrics.

Imported content is hostile. Browser sanitization improves usability; archive and server validators independently reject unsafe bytes before durable writes.

## Export, accessibility, and verification

Operations are intentionally distinct:

- **Export image** produces PNG or portable SVG.
- **Export board** produces a versioned editable `.chalkboard` archive.
- **Import board** validates an archive and atomically creates a new local board.
- Local/cloud copy creates an independent destination, transfers authorized assets with bounded concurrency/timeouts, regenerates identities, waits for durable destination acknowledgement where applicable, and never mutates its source.

The archive contract is [`board-file-format.md`](board-file-format.md). Validation is cancellable, resource-bounded, and isolated in a worker when available.

The visual canvas is not the only discovery path. The object navigator exposes semantic labels, positions, selection, and bounded pages. Primary workflows require keyboard operation, stable names, visible focus, modal containment/restoration, announcements, reduced motion, forced colors, high zoom/reflow, and manual screen-reader certification. Automated Axe checks supplement rather than replace that certification.

Verification belongs at the enforcing boundary: model tests for transforms/codecs, component tests for UI semantics, PostgreSQL tests for durability and authorization, browser tests for product, recovery, and accessibility, and direct inspection for behavior that automation cannot establish. Persistent writer changes retain compatibility fixtures; fuzz failures retain replayable seeds.

## Non-negotiable constraints

- One collaboration server until a coordinated multi-instance protocol exists.
- PostgreSQL is cloud durability authority; IndexedDB is browser durability authority.
- Never acknowledge cloud work before durable append.
- Never silently migrate, import, or recover destructively.
- Account or network failure cannot erase or block local work.
- Unsupported future data is not rewritten by an older client.
- UI state is not authorization.
