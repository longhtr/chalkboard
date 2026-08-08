# Architecture

This guide explains how Chalkboard is divided, where data is stored, and which safety rules must not be weakened. Use the [codebase guide](codebase-guide.md) to locate implementations and tests.

## System at a glance

```text
Browser
  React editor
  IndexedDB local boards
  Yjs collaboration client
       |
       | same-origin HTTP and WebSocket
       v
Web container
  Static files, security headers, API proxy
       |
       v
Fastify server (one process)
  Accounts, authorization, assets, Yjs rooms
       |
       v
PostgreSQL
  Users, sessions, cloud boards, assets, Yjs updates
```

The repository follows these runtime boundaries:

- `apps/web` owns browser UI, editing, local storage, imports, exports, and the collaboration client.
- `apps/server` owns HTTP and WebSocket admission, authorization, PostgreSQL persistence, and operational endpoints.
- `apps/shared/src` contains contracts and algorithms needed by both runtimes. It must not import DOM, IndexedDB, Fastify, or PostgreSQL APIs.
- `tests` contains browser stories that cross module or runtime boundaries.

Production runs one collaboration server. Room ownership, update ordering, and rate limits are currently in memory. A PostgreSQL advisory lock prevents a second server from starting. Horizontal scaling requires a shared ownership and ordering design first.

## Board data and editor state

Persisted board elements use world coordinates. Camera position, zoom, viewport pixels, and device-pixel ratio are presentation state and are never stored as element geometry.

The editor separates two kinds of state:

- **Committed state:** elements, title, appearance, and semantic undo history.
- **Transient state:** pointer movement, selection previews, camera movement, measurements, and unfinished equation input.

A preview must not create history. One completed user action should create one bounded history entry.

All renderers and hit testing use the same camera transform:

```text
screenPoint = worldPoint * zoom + viewportOffset
```

`apps/web/src/editor/Workspace.tsx` composes these systems. It should coordinate owners, not absorb new independent lifecycles.

## Prose and mathematics

A mixed text block has three representations:

1. structured text and math spans used for storage and collaboration;
2. canonical source used for compatibility and archives;
3. temporary MathLive input containing editor-only markers.

Structured content wins if both structured content and source are present. Canonical source is regenerated deterministically. Editor-only markers never persist.

MathLive is the active renderer while editing. Inactive content is sanitized before static rendering. Malformed intermediate input keeps the last safe inactive rendering instead of publishing unsafe markup.

The selected font applies to editing and export. MathJax is a lazy export fallback, not the interactive editor.

## Local boards

IndexedDB is the durability authority for local boards. Board records and image blobs are stored separately, but repository transactions coordinate them.

A small localStorage cache may help startup and crash recovery. It is never more authoritative than IndexedDB and cannot replace a newer durable record.

A local write follows this order:

1. keep the previous board intact;
2. validate the expected revision;
3. write the board and owned-asset changes in one IndexedDB transaction;
4. commit;
5. update caches and notify other tabs.

Failure before commit must leave the previous board usable. Imports and duplicates receive new board and element IDs. A failed destination write must not alter the source.

Routes use `/local/:id`. Missing, corrupt, blocked, or unsupported data opens recovery UI rather than silently replacing data.

## Cloud boards

A cloud board is a Yjs document backed by PostgreSQL. Yjs Awareness contains temporary presence only. It is not authorization or durable board content.

The browser keeps an acknowledged baseline plus any pending updates. Status labels have strict meanings:

- **Connected:** the transport is open.
- **Synchronizing:** some represented work is not durably acknowledged.
- **Saved:** every represented local update has a durable server sequence.
- **Offline** or **Connection failed:** unsent work remains on the device.
- **Read only** or **Incompatible:** editing is disabled while safe inspection remains available.

For each accepted update, the server:

1. checks frame, room, process, and document limits;
2. applies and relays the update in the active room;
3. appends it to PostgreSQL;
4. returns the durable sequence to the sender;
5. compacts the stored update tail when required.

The browser removes pending work only in acknowledgement order. Replay is idempotent. Old or disposed sockets cannot update current recovery state.

Room load, writes, compaction, and retirement are serialized per board. Graceful shutdown stops readiness, rejects new upgrades, closes clients with restart semantics, drains persistence, compacts, and then closes PostgreSQL.

## Accounts and authorization

PostgreSQL owns accounts, hashed sessions, board roles, invitations, assets, and collaboration history.

Authorization is checked independently for:

- REST requests;
- asset reads and writes;
- WebSocket upgrades and active sessions.

The browser's displayed role is never proof of access.

Registration creates an expiring pending record. It creates the user only after verification succeeds. Email changes keep the old address until the new one is verified. Password recovery gives the same public response for known and unknown addresses, and a successful reset revokes existing sessions.

Passwords and verification codes use bounded Argon2 work. Invitation tokens are random, expiring, revocable, delivered in URL fragments, and stored only as hashes.

The source currently defines five intentionally public demo identities in the reserved `.invalid` namespace. A seed job restores their published credentials and revokes old sessions without deleting their boards. Their identity fields are locked. Their boards are public test content, not private storage.

## Assets and untrusted input

Cloud assets are immutable and scoped to one board. PostgreSQL stores the bytes; Yjs stores authorized references.

Before storage, the server checks authorization, type signatures, byte size, dimensions, container structure, and SVG safety. Browser validation improves feedback but does not replace server validation.

The same hostile-input rule applies to:

- API bodies and responses;
- URL and route parameters;
- `.chalkboard` archives;
- WebSocket frames and Yjs updates;
- image and SVG files.

Every expensive or memory-bearing boundary has count, size, age, or time limits. SQL is parameterized. Production uses exact-origin checks, secure cookies, restrictive browser headers, private database and metrics endpoints, redacted structured logs, and content-free metrics.

## Import and export

The operations are deliberately different:

- **Export image:** PNG or portable SVG for viewing.
- **Export board:** versioned editable `.chalkboard` archive.
- **Import board:** validates an archive and atomically creates a new local board.
- **Copy local/cloud board:** creates an independent destination, regenerates IDs, and leaves the source untouched.

The archive contract is documented in [board-file-format.md](board-file-format.md). Validation is resource-bounded and uses a worker when available.

Snapshot links are editable convenience copies. They are limited by URL size and are neither authorization nor backup.

## Accessibility

The canvas is not the only way to inspect a board. The object navigator exposes semantic labels, positions, selection, and bounded pages.

Primary workflows require keyboard access, visible focus, stable names, modal focus containment and restoration, announcements, reduced-motion support, forced-color support, and usable high-zoom layouts. Automated Axe checks supplement manual assistive-technology testing; they do not replace it.

## Rules to preserve

- IndexedDB is authoritative for local boards.
- PostgreSQL is authoritative for cloud boards.
- Never report cloud work as saved before durable append.
- Never silently overwrite data during migration, import, or recovery.
- Account or network failure must not erase or block local editing.
- An older client must not rewrite unsupported future data.
- UI state is not authorization.
- Do not run multiple collaboration servers until ownership and ordering are coordinated.
