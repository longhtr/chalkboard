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

1. checks frame, room, process, and document limits against the larger of the materialized Yjs encoding and PostgreSQL's charged snapshot-plus-uncompacted-tail bytes;
2. applies and relays the update in the active room only after that conservative admission passes;
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

Registration creates an expiring pending record. It creates the user only after verification succeeds. Existing-account and available-address registration requests return the same public status/body and perform equivalent bounded password work, while an existing account creates no provider intent. Email changes keep the old address until the new one is verified. Password recovery gives the same public response for known, unknown, limited, and suppressed addresses, and a successful reset revokes existing sessions.

Passwords and verification codes use bounded Argon2 work. Invitation tokens are random, expiring, revocable, delivered in URL fragments, and stored only as hashes.

The source currently defines five intentionally public demo identities in the reserved `.invalid` namespace. A seed job restores their published credentials and revokes old sessions without deleting their boards. Their identity fields are locked. Their boards are public test content, not private storage.

## Transactional email security

Registration and password-reset initiation pass cheap bounded hourly and daily IP gates before human verification, then require human verification before DNS, account, or provider work. Registration and authenticated email change also reject protected role mailboxes. Address checks validate syntax and bounded MX/address DNS results without probing whether a mailbox exists; DNS outages are retryable, not proof of invalidity.

Important admission state is durable in PostgreSQL. HMAC digests, rather than raw client addresses or unknown reset destinations, key per-IP, destination, and account limits. A global transactionally locked reservation stays below configurable canary limits and immutable 80/day and 2,400/rolling-month hard caps. The database starts all email flows disabled and starts verified normal accounts at a 10-account canary below the immutable 250-account ceiling. Every reserved or ambiguous intent remains for the full rolling month because it may represent a provider-accepted message. After human/address checks, a registration retry with a live pending generation returns that state before another durable admission; its code is never rotated and another provider allowance is not consumed. PostgreSQL-backed browser tests receive a composition-only admission multiplier because every synthetic account shares one loopback address; development and production always use the fixed documented IP, destination, and account limits, and no environment setting can widen them.

Bounded maintenance batches remove expired pending rows and sessions, 30-day email metadata, revoked/expired invitation links, and boards that have remained in trash for 30 days; large backlogs drain over later runs rather than becoming one unbounded transaction.

Messages have generic subjects and put the eight-digit code only in branded text and HTML bodies. Codes expire after 15 minutes, open/click tracking is omitted, and each message includes an unrequested-action warning plus policy/contact links. Local development accepts only `@chalkboard.test`, captures messages in bounded process memory, and never contacts a provider.

SES feedback crosses a separate public boundary. The server first validates the exact topic, regional signing-certificate URL, and SNS signature; only then does it parse minimum SES metadata. Events are idempotent and reconcile even if feedback arrives before the send result is recorded. Permanent bounces and complaints suppress the destination, and any complaint disables registration. Browser-origin checks do not authenticate this endpoint; SNS signatures do.

One retained Secrets Manager object contains an AWS-generated admission key plus the operator-entered Turnstile validation value. A checksum-pinned `asm-exec` child resolves dynamic references without returning values to the agent. The host materializer validates both values, writes the key generation and both private values into a complete fsynced release, and atomically activates it. Repeated rotation retains only the current release and one predecessor for rollback. The root-owned cache is mode `0700`; only the verified non-root server UID owns the three mode-`0600` files, which Compose mounts read-only into only the server. Missing, stale, revoked, or unsafe material fails email-triggering flows closed without taking login, existing sessions, boards, collaboration, health, PostgreSQL, or backups offline.

The tracked CloudFormation control deliberately does not own the existing verified `chalkboard.space` SES identity. It creates a configuration set with engagement tracking disabled, grants send permission only through that existing identity and configuration set, outputs the approved sender and `mail.chalkboard.space` DNS values, and creates an SNS topic whose confused-deputy conditions permit only that configuration set. Existing Easy DKIM remains unchanged; the fail-closed custom MAIL FROM and disabled email-forwarding settings are applied directly to the existing identity only through the separately approved edge-closed procedure. Runtime diagnostics expose only provider/material availability and flow booleans, never values, destinations, codes, or event bodies.

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

### Bounded failure evidence

Unexpected server failures pass through one diagnostic boundary. It reads each mutable core error property once, then retains one internally consistent SHA-256 fingerprint, error type, allowlisted system/database code and HTTP status, exact message and stack byte/character lengths, bounded transformed summary and frame inventory, nested causes, and aggregate failures. Depth, cycle, unreadable-property, aggregate-member, and frame omissions are explicit. Transaction cleanup preserves both the original operation failure and any rollback failure. Raw `Error` objects, request bodies, URLs, destinations, addresses, codes, tokens, provider payloads, and user content are not valid structured-log fields.

External-provider evidence uses information-preserving transformation rather than either raw logging or a single opaque hash. Safe adapter-owned correlation identifiers, booleans, numbers, configuration names, Regions, actions, statuses, counts, timestamps, field names, and protocol stages remain exact. A private string, number, or binary value retains full SHA-256, UTF-8 byte length, value kind, classification, and completeness but not reusable prose. Arbitrary future provider fields retain bounded names or name fingerprints, scalar classifications, nested object/array structure, and explicit observed/omitted counts without invoking accessors. HTTP evidence inventories the response and every bounded header name, omits authentication/cookie values, applies strict grammars before retaining nominally safe values, fingerprints every other header/reason/URL value, and separates raw-body correlation from bounded JSON/XML/PEM structure. Body evidence records UTF-8 validity, declared-versus-observed byte-length agreement, complete-versus-prefix state, XML code/request-ID observed and omitted counts, stream-read failure, and stream-cancellation request. Cancellation is best-effort cleanup and is never awaited on a user path; `requested-unobserved` means cancellation was invoked but its provider-controlled promise was deliberately not allowed to delay the result. `null`, `unavailable`, `omitted`, `invalid-utf8`, `truncated`, complete-value, and prefix-only states are distinct; no missing field may be silently described as complete.

The production server has four external-provider boundaries:

- SES send failures and malformed or accepted responses retain every installed Smithy metadata field, fault/retry traits, low-level HTTP evidence, nested transport structure, unknown future fields, request shape, all bounded SES action/resource occurrences, Region/request matches, and independent provider-message and response-body evidence. Accepted-send metadata follows later bookkeeping failures so a provider acceptance can be reconciled without logging its message identifier.
- Turnstile Siteverify retains the endpoint/method, exact idempotency UUID, attempt policy, timeout, action, private token and expected-host fingerprints, HTTP/body/parsed-field/schema evidence, all provider error codes, actual match booleans, and both retry attempts. A complete body and an interrupted or oversized prefix are never conflated.
- DNS retains private query-name and resolver-host fingerprints, lookup/fallback/sibling-family context, resolver implementation and timeout/tries, duration, code/errno/syscall, safe unknown-field structure, and nested operational evidence. Partial A/AAAA degradation is recorded even when the sibling family keeps the address deliverable; expected negative answers remain non-alerting.
- SNS retains private per-envelope-value and canonical-message fingerprints, canonical field sequence, timestamp/type/topic-match and signature algorithm, certificate URL/HTTP/body/structure/cache evidence, bounded X.509 metadata, confirmation response evidence, and authenticated SES payload field/schema/event evidence. Invalid authenticated payloads and ignored event types remain diagnosable without provider IDs or event bodies.

Fastify's raw request logger is disabled. One application-owned completion record contains only request ID, method, matched route template, status, and duration; unmatched paths are never echoed. Unexpected HTTP responses include the same `x-request-id`, and browser `ApiError` objects retain only a validated request ID for operator correlation. Fatal browser recovery captures an exception once, then persists its bounded redacted diagnostic, exact character/UTF-8 byte lengths, stack topology, and asynchronous fingerprint with explicit complete-value or bounded-prefix coverage. It templates `/boards/:boardId` and `/local/:boardId`, allowlists static routes, and records every unknown path as `unmatched`. It never stores or renders the original query string, hash, concrete path identifier, or unbounded message/stack.

Together these are five external boundaries: the four server boundaries plus Cloudflare's browser script/widget, which is separate from server-side Siteverify. It keeps at most 20 local-only lifecycle records for script load/error/timeout, missing API, render/removal failure, completion, invalid token callback, provider error/timeout, and expiry. Records contain stage/action/attempt/timing/browser state, exact exception character/UTF-8 byte lengths, fixed stack-frame topology placeholders, complete-or-prefix fingerprint state, script host/path, and a syntactically bounded provider error code. Every stored record is reconstructed through an exact allowlist before reuse, so unknown or malformed localStorage fields are discarded. Records never contain a token, site key, widget ID, raw callback value, URL query, arbitrary exception prose, or provider-controlled stack frame and are never uploaded.

Expected invalid input remains a fixed public-safe rejection rather than an operational alert. A provider/network/database failure is not collapsed into that rejection: transient SNS certificate or authenticated feedback-processing failures return `503` so they are not falsely acknowledged, while invalid envelopes and signatures return `400`. SES, Turnstile, DNS, materialization, maintenance, collaboration, readiness, startup, shutdown, and command-entry failures retain their applicable bounded evidence without changing fail-closed behavior. Unknown thrown values, hostile/revoked proxies, getters, serializers, invalid UTF-8, contradictory length metadata, response streams, and cancellation failures cannot escape, delay, or break the diagnostic boundary.

## Import and export

The operations are deliberately different:

- **Export image:** PNG or portable SVG of the whole board or the objects selected before the dialog opens.
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
