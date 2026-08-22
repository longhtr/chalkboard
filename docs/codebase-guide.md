# Codebase guide

Use this guide to find the owner of a behavior and the tests that protect it. Read [architecture.md](architecture.md) first when changing durability, synchronization, authorization, or compatibility. Account-email production procedures and evidence gates belong in [the account-email operations runbook](../deploy/account-email-operations.md).

## Entry points

| Area                | Entry point                              | Role                                                                                       |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Browser boot        | `apps/web/src/main.tsx`                  | Captures the entry URL, installs the error boundary, and mounts React                      |
| Browser application | `apps/web/src/App.tsx`                   | Coordinates routes, sessions, board libraries, and the selected workspace                  |
| Editor              | `apps/web/src/editor/Workspace.tsx`      | Composes editor state, interaction, persistence, collaboration, rendering, and dialogs     |
| Server process      | `apps/server/src/index.ts`               | Loads configuration, builds Fastify, handles signals, and listens                          |
| Fastify application | `apps/server/src/app.ts`                 | Installs security, routes, collaboration, diagnostics, health, metrics, and drain behavior |
| Database migration  | `apps/server/src/db/migrate.ts`          | Runs locked, checksum-protected, forward-only migrations                                   |
| Demo seed           | `apps/server/src/db/seedDemoAccounts.ts` | Restores the five public demo identities and credentials                                   |

`Workspace.tsx` and `App.tsx` are composition roots. Add behavior to the focused owners below instead of adding another independent lifecycle directly to either file.

## Browser application

### Accounts and routing

| Behavior                                        | Owner                                                                                  | Main tests                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| Board routes and URLs                           | `account/boardRouting.ts`                                                              | `boardRouting.test.ts`                |
| Session bootstrap and cache                     | `account/useSession.ts`                                                                | `useSession.test.tsx`                 |
| REST transport, errors, and response validation | `account/api.ts`                                                                       | `api.test.ts`, account tests          |
| Sign-in and registration                        | `account/AccountForm.tsx`, `VerificationCodeForm.tsx`                                  | adjacent tests, account browser tests |
| Human verification                              | `account/HumanVerification.tsx`                                                        | adjacent and cloud browser tests      |
| Password recovery                               | `account/PasswordResetForm.tsx`                                                        | adjacent tests, cloud browser tests   |
| Local captured-email inbox                      | `account/DevelopmentEmailInboxPage.tsx`                                                | local account testing                 |
| Demo sign-in                                    | `account/DemoAccountsDialog.tsx`                                                       | adjacent tests, cloud browser tests   |
| Account settings and email verification dialog  | `account/AccountPanel.tsx`, `AccountSettings.tsx`, `EmailChangeVerificationDialog.tsx` | adjacent tests, cloud browser tests   |
| Members and invite links                        | `account/BoardAccessPanel.tsx`, `MemberManager.tsx`, `BoardInviteLinks.tsx`            | adjacent tests, cloud browser tests   |
| Local board library                             | `account/LocalBoardLibrary.tsx`                                                        | component and restart tests           |
| Application crash recovery                      | `components/AppErrorBoundary.tsx`                                                      | `AppErrorBoundary.test.tsx`           |

### Editor folders

`apps/web/src/editor/Workspace.tsx` composes the editor. Supporting code is grouped by responsibility:

| Folder               | Owns                                                                        | Examples                                           |
| -------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| `editor/model`       | Board limits, serialization, element creation, title, and committed history | `editorState.ts`, `elementCreation.ts`             |
| `editor/interaction` | Geometry, selection, tools, keyboard commands, culling, and drawing         | `interactionGeometry.ts`, `rendering.ts`           |
| `editor/equation`    | Board-level equation edits, sizing, recovery, and hit testing               | `equationEditing.ts`, `renderedEquationHitTest.ts` |
| `editor/local`       | IndexedDB, migration, recovery, persistence, assets, and trash              | `boardStorage.ts`, `localBoardRepository.ts`       |
| `editor/cloud`       | Browser cloud cache, cloud assets, and local/cloud copying                  | `cloudBoardCacheQueue.ts`, `localToCloud.ts`       |
| `editor/portability` | Archive import/export and PNG/SVG export                                    | `boardArchive.ts`, `workspaceExport.ts`            |
| `editor/workspace`   | React controls and hooks for camera, input, overlays, panels, and canvases  | `usePointerController.ts`, `ObjectNavigator.tsx`   |

Keep tests beside their owner. `editor/workspace/preferences.ts` owns disposable browser preferences; grid values are theme-scoped, and spacing is additionally scoped to dots or lines. `editor/workspace/ExportDialog.tsx` owns export-scope availability and its explanatory hint, while the portability folder owns image generation. If a new module appears to belong to several folders, clarify ownership rather than creating a generic utility folder.

### Editing orthogonal paths

An orthogonal path stores sharp corners and rounds them only when drawing, the
same way a shape stores its rectangle and rounds at trace time. Keeping the
stored geometry sharp is what lets corner handles and corner rounding coexist:
handles sit on the real turns rather than sliding onto arc endpoints.

Three pieces cooperate:

- `linePathVertices` in `geometry.ts` is the single source of corner positions.
  Handles, rounding, and SVG export all read it, so they cannot drift apart.
- `moveOrthogonalVertex` in `orthogonalFitting.ts` moves one corner and pulls
  its neighbours along the coordinate each shared run depends on, so every run
  stays axis-aligned. It deliberately preserves the vertex count even when a
  drag collapses a run, because handle indexes must stay stable for the whole
  pointer lifetime.
- `roundedPolylineCorners` in `shapeGeometry.ts` insets each interior turn,
  leaving both endpoints sharp. One inset serves both sides of a turn and is
  capped at half the shorter adjoining run, so neighbouring arcs cannot overlap.

Orthogonal paths expose node handles but never cubic control handles: moving a
control would tilt a run off its axis. Both renderers must trace the same
outline — the canvas in `interaction/rendering.ts` and the exporter in
`portability/vectorSvgMarkup.ts` — or a rounded path on screen exports with
sharp corners.

### Turning shapes and paths

An element stores an angle and nothing else. Its `x`, `y`, `width`, `height`,
points, and control points always describe the shape as if it were standing
upright. Drawing turns the canvas around the middle of that upright box and then
draws the ordinary, unturned shape into it.

That one decision keeps every piece of geometry simple, and it costs exactly one
rule, which the whole feature rests on:

> Anything that has to answer "where is this on screen?" must apply the angle
> for itself. Anything that reads or writes stored geometry must undo it first.

`elementRotationCenter` in `apps/shared/src/geometry.ts` is the single source of
the point an element turns around: the middle of `elementBounds`. Everything --
drawing, hit testing, export -- derives it from there, because two places
computing it differently is exactly how a shape ends up drawn in one spot and
clickable in another.

Two helpers do the work everywhere else:

- `rotatedElementBounds` is the upright box around what an element covers _after_
  its turn. Anything that sizes or crops around content wants this one, not
  `elementBounds`: a canvas sized from the stored box crops a turned shape's
  overhanging ends. `rotatedSelectionBounds` is the same thing for a whole
  selection.
- `rotatePoint(point, centre, -angle)` turns a pointer position back into the
  element's own upright coordinates. Every handle drag does this before touching
  stored geometry, so a downward drag on a shape lying on its side changes the
  shape's _width_, which is what the reader sees happen.

Here is the whole cast, with what each one is responsible for:

| Concern                          | Where                                              |
| -------------------------------- | -------------------------------------------------- |
| Drawing an element turned        | `interaction/rendering.ts`, `drawElements`         |
| Answering a click                | `hitTestElement` in `shared/geometry.ts`           |
| Sizing the canvas a run draws on | `interaction/layerRendering.ts`, `layerCrop`       |
| Culling and spatial indexing     | `viewportCulling.ts`, `elementSpatialIndex.ts`     |
| The selection box and handles    | `selectionFrame`, `frameHandlePoints`              |
| Finding a handle under a pointer | `pointInFrame`, `pointInElementFrame`              |
| Which cursor a handle shows      | `visualResizeHandle`                               |
| Turning, resizing, direct drags  | `interaction/selectionInteraction.ts`              |
| Export                           | `portability/boardExport.ts`, `vectorSvgMarkup.ts` |

`tests/workspace-rotation.spec.ts` is the guard. Every test there compares what
is **drawn** (pixels read back off the canvas) against what **responds to a
click** (the cursor the canvas offers), because those are two different code
paths and a disagreement between them is the bug this feature keeps producing.
Each one has been checked to fail when its rotation code is removed; a test that
passes either way is not protecting anything.

Two details worth knowing before you touch this:

- A group turns as one arrangement. Each piece both spins and travels around the
  shared centre, so `updateRotatingInteraction` moves elements as well as
  changing their angles. Turning each piece where it stands looks like the
  selection exploding.
- Drag thresholds must be measured in the same frame as the drag. The trapezoid
  corner handle only travels along the shape's own top edge, so its threshold
  measures movement along that edge; measuring it across the screen ignores the
  entire drag on a shape turned a quarter turn.

### Mathematics

| Behavior                                | Owner                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Mixed-source parsing and normalization  | `math/mixedMath.ts`                                                                  |
| Structured mixed documents              | `math/mixedDocument.ts`                                                              |
| Sanitizing static markup                | `math/renderSanitizer.ts`                                                            |
| Static conversion and decoration        | `math/staticMathMarkup.ts`, `staticMathDecoration.ts`                                |
| Inactive rendering and measurement      | `math/MathElement.tsx`, `editor/workspace/useEquationMeasurementQueue.ts`            |
| Active MathLive lifecycle and clipboard | `math/InlineMathEditor.tsx`, `editorEventLifecycle.ts`, `editorClipboard.ts`         |
| Input publication                       | `math/editorPublication.ts`                                                          |
| Position and selection conversion       | `math/editorSelectionController.ts`, `editorPositions.ts`                            |
| Source/rendered caret alignment         | `math/sourceCaretMapping.ts`, `sourceCaretSynchronization.ts`                        |
| Commands and history                    | `math/editorCommandController.ts`, `editorCommandTransaction.ts`, `editorHistory.ts` |
| Font loading                            | `math/mathLiveRuntime.ts`, `workspaceFontAssets.ts`, `workspaceFontRevision.ts`      |
| Glyph and line corrections              | `math/excalifontLayout.ts`, `lineClearance.ts`                                       |
| Searchable syntax help                  | `math/LatexCheatsheet.tsx`, `latexReference.ts`                                      |

`InlineMathEditor.tsx` has one large imperative lifetime because field creation, shadow-DOM readiness, browser events, selection, and teardown must stay ordered. Put algorithms in focused modules. Any change to the main effect needs explicit teardown and race testing.

### Placing a caret

Two files decide where the caret goes.

**`sourceCaretMapping.ts` — switching between source view and rendered view.**
The same document is spelled two different ways. A line break is a `\n` character in source view, but an invisible marker character in the rendered field. Bold text is `\textbf{...}` in source, but a pair of invisible markers in the field. To move the caret from one view to the other, the code lines the two versions up token by token.

`mixedMath.ts` holds the list of which marker means what. Always read that list from there instead of copying it, because once the copies drifted apart the caret could no longer reach about a third of the positions in a multi-row block.

Lining the two up can fail for reasons we do not control, such as an old saved file or a new version of MathLive. So the code does not depend on it working. It guarantees these on its own:

- positions stay in left-to-right order;
- no two positions share the same spot while the document has room, which is what makes every position reachable;
- switching to source view and back puts the caret where it started;
- a very long block is measured approximately instead of freezing the editor.

**`editorSelectionController.ts` — clicking in the rendered field.**
It works out _which row_ you clicked first, from the line-break markers, and only then looks for the nearest character within that row. Doing it the other way round is wrong: if you click past the end of a short row, the nearest character on screen belongs to the row below, so the caret jumps down a row.

Two traps when searching inside a row:

- Do not work out which boxes belong to the row by comparing heights. In mathematics a fraction is tall and its digits are small, so a rule like "ignore anything more than twice the height of the shortest box" throws away every real character as soon as one small box appears. Identify the line-break marker by name instead.
- `getElementInfo` does not always report where something is on screen. MathLive gives re-drawn characters coordinates as if the block were a single long row. That is what `beginPointerGeometry` takes a snapshot to avoid during a drag.

**Tests.** `sourceCaretAlignment.test.ts` checks the two spellings really do produce the same tokens, and that every marker is registered. `sourceCaretRecovery.test.ts` feeds in deliberately mismatched input and checks the caret still lands somewhere sensible. `equation-source-caret-reachability.spec.ts` and `equation-multiline-caret-tracking.spec.ts` run the same checks against a real editor, which is the only place a MathLive change will show up.

Check every position in a block, not a few hand-picked ones. The bug these were written for survived a test suite that checked a handful of offsets in a block with only one row.

### Decorating rendered blocks

A rendered block is MathLive markup written once with `dangerouslySetInnerHTML` and then corrected in place: Excalifont glyph tags, sentinel splitting, colour runs, and line clearance. Three rules keep that affordable and correct.

Hold the `{ __html }` object steady while the markup is unchanged. React compares that prop by reference and rewrites innerHTML whenever the object differs, so a fresh literal per render reparses the whole block and destroys its decoration. A block rerenders on every camera change, so an unmemoized literal costs a full reparse and redecoration of every visible block on every frame of every scroll.

Redecorate only on the inputs decoration actually reads: markup, colour, and the workspace font revision. The camera and the font size stay out on purpose, because the clearance is measured in device pixels and stored in `em` and so survives both. `equation-decoration-cadence.spec.ts` holds both halves.

The corrections walk the same tree the active field uses, which contains MathLive's `ML__keyboard-sink` -- a contenteditable span mirroring the selection that holds the field's focus. It is an input surface, not rendered writing: rewriting it destroys the focused element, and Firefox then drops focus to the document body without firing a blur. Any new correction that restructures nodes must skip it.

### Local persistence and portability

Persistent writers belong in `editor/local` or `editor/cloud`. Archive and visual-export boundaries belong in `editor/portability`.

Changes require:

- compatibility fixtures;
- stale-revision tests;
- atomic-failure tests;
- proof that a failed destination does not mutate its source.

### Collaboration client

| Behavior                                       | Owner                                                 | Main tests                          |
| ---------------------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| Yjs board model and convergence                | `collaboration/cloudBoardModel.ts`                    | model tests and shared codec tests  |
| Local publication and semantic reconciliation  | `collaboration/useCloudBoard.ts`                      | hook tests and cloud browser tests  |
| Reconnect, replay, acknowledgement, and status | `collaboration/useCloudBoard.ts`, `cloudReconnect.ts` | hook tests and cloud recovery tests |
| Presence overlay                               | `editor/workspace/CollaborationOverlay.tsx`           | cloud browser tests                 |

## Server

| Behavior                                | Owner                                                                                                              | Main tests                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Configuration                           | `config.ts`                                                                                                        | `config.test.ts`                    |
| Origin and rate primitives              | `api/security.ts`                                                                                                  | `security.test.ts`                  |
| Request admission and route composition | `api/requestAdmission.ts`, `api/routes.ts`                                                                         | route unit and integration tests    |
| Account and session protocol            | `api/authRoutes.ts`, `api/accountRoutes.ts`                                                                        | route integration tests             |
| Password hashing and sessions           | `accounts/service.ts`, `accounts/passwordWorkController.ts`                                                        | controller and integration tests    |
| Verification codes and message delivery | `accounts/verificationCode.ts`, `accounts/verificationEmail.ts`, `accounts/resendVerificationEmail.ts`             | adjacent and route tests            |
| Email workflow ordering                 | `email/workflows.ts`, `email/addressValidation.ts`                                                                 | adjacent and integration tests      |
| Durable email admission and cleanup     | `email/emailSecurity.ts`, migrations `0007_email_security.sql` and `0009_maintenance_cleanup_indexes.sql`          | unit and PostgreSQL race tests      |
| Turnstile verification                  | `humanVerification/humanVerifier.ts`                                                                               | adjacent tests                      |
| Authenticated provider feedback         | `email/resendFeedback.ts`, `email/feedback.ts`, `api/resendFeedbackRoutes.ts`                                      | unit and PostgreSQL tests           |
| Application security-file boundary      | `email/applicationSecurity.ts`                                                                                     | adjacent tests                      |
| Demo-account lock and seed              | `db/seedDemoAccounts.ts`, `api/accountRoutes.ts`, shared `demoAccounts.ts`                                         | seed and route integration tests    |
| Boards, members, invites, and trash     | `api/boardRoutes.ts`, `api/memberRoutes.ts`, `api/inviteRoutes.ts`, `api/boardTrashRoutes.ts`, `boards/service.ts` | integration and cloud browser tests |
| Asset HTTP and authorization            | `assets/routes.ts`, `assets/service.ts`                                                                            | asset integration tests             |
| Asset byte and media validation         | `assets/validation.ts`, `assets/rasterValidation.ts`                                                               | validation and asset tests          |
| WebSocket admission and authorization   | `collaboration/gateway.ts`                                                                                         | gateway and cloud browser tests     |
| Room registry and lifecycle             | `collaboration/hub.ts`, `collaboration/room.ts`                                                                    | admission, crash, and fuzz tests    |
| Persistence queue and compaction        | `collaboration/persistenceQueue.ts`, `compactionController.ts`, `persistence.ts`                                   | gateway and PostgreSQL tests        |
| Document and Awareness limits           | `collaboration/documentAdmission.ts`, `awarenessAdmission.ts`                                                      | adjacent and gateway tests          |
| PostgreSQL pool and runtime lock        | `db/database.ts`                                                                                                   | application and migration tests     |
| Metrics                                 | `operations/metrics.ts`                                                                                            | metrics and application tests       |

Every implementation and test module begins with a short ownership or safety comment. Keep that documentation current when moving responsibilities or adding a boundary.

An authorization change is incomplete until REST, assets, and WebSockets have each been considered and tested independently.

## Deployment and account-email operations

| Behavior                                                                                                   | Owner                                                                                 | Main tests                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Retained application-security and provider-credential secrets with the exact runtime read permission       | `deploy/account-email.yaml`                                                           | `deploy/account-email-infrastructure.test.mjs`, `deploy/account-email.guard` |
| Runtime-only secret resolution and resolver pin                                                            | `deploy/asm-exec`, `deploy/asm-exec.sha256`, `deploy/refresh-application-security.sh` | `deploy/materialize-application-security.test.mjs`, infrastructure test      |
| Strict validation, fsync, atomic cache activation, rotation, and rollback                                  | `deploy/materialize-application-security.mjs`                                         | adjacent Node test and server `email/applicationSecurity.test.ts`            |
| Server-only read-only secret mounts and canary capacities                                                  | `deploy/compose.production.yaml`, server `config.ts`                                  | infrastructure, configuration, and application tests                         |
| Docker/package artifact privacy                                                                            | `.dockerignore`, `.npmignore`                                                         | infrastructure tests and release artifact scans                              |
| Complaint, abuse, credential, quota, and cost emergency stop                                               | `deploy/email-emergency-stop.sh`, database email switches                             | infrastructure and PostgreSQL email-security tests                           |
| Provider setup, feedback confirmation, material recovery, incidents, canary, appeal, and conditional purge | `deploy/account-email-operations.md`                                                  | reviewed release checklist and operational acceptance                        |
| Bounded server failure evidence, redaction, fingerprinting, causes, and startup-tool output                | server `operations/errorDiagnostics.ts`, `operations/serverLogger.ts`                 | adjacent unit tests and `deploy/observability-policy.test.mjs`               |
| HTTP route/request correlation and fatal browser recovery evidence                                         | server `app.ts`, web `account/api.ts`, web `components/browserErrorDiagnostics.ts`    | application, API, browser-diagnostic, and error-boundary tests               |
| Transaction operation-plus-rollback failure preservation                                                   | server `db/transactionFailure.ts` and transaction owners                              | adjacent unit test, integration suites, and observability policy test        |

The root `pnpm test` command runs `test:operations` after workspace tests so tracked deployment scripts and infrastructure cannot silently escape ordinary CI. Provider credentials and AWS access are not required.

## Shared package

`apps/shared/src` contains environment-neutral contracts and algorithms:

| File                                                          | Purpose                                               |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `elementSchema.ts`                                            | Board elements and limits                             |
| `geometry.ts`                                                 | Bounds, transforms, paths, and hit testing            |
| `orthogonalFitting.ts`                                        | Right-angle path fitting and corner dragging          |
| `bezierFitting.ts`, `bezierContinuity.ts`, `curveGeometry.ts` | Curve fitting and continuity                          |
| `shapeGeometry.ts`                                            | Shape and polyline outlines, rounding, hatch clipping |
| `mixedContent.ts`, `yjsMixedContent.ts`                       | Structured mixed text and its Yjs codec               |
| `schemaVersions.ts`                                           | Public schema versions                                |
| `accountContract.ts`, `boardContract.ts`                      | Account, board, role, invitation, and title contracts |
| `demoAccounts.ts`                                             | Public demo identities shared by browser and seed job |
| `collaborationContract.ts`                                    | Browser/server binary message tags                    |
| `health.ts`                                                   | Health and diagnostics contracts                      |
| `crc32.ts`                                                    | ZIP and PNG checksum implementation                   |
| `index.ts`                                                    | Supported package exports                             |

Do not import browser or server runtime modules into this package.

## Known hotspots

- `Workspace.tsx` is a large composition root. New independent behavior belongs in a chapter module.
- `App.tsx` still coordinates routes, sessions, and both board libraries. New account workflows should leave it rather than enlarge it.
- `usePointerController.ts` is a large gesture state machine. Extract transitions when adding gestures.
- `InlineMathEditor.tsx` intentionally keeps one lifecycle effect, but its algorithms should remain outside that effect.
- Collaboration and in-memory rate limits support one server process. Do not relax the runtime lock without shared ordering, fanout, room ownership, and counters.
- Structured math content and canonical source deliberately coexist for compatibility. Structured content is authoritative.
- Password work and collaboration compaction use separate bounded FIFO controllers because they protect different critical paths.

## Running focused tests

Use `exec vitest run` for an exact file. Passing a filename through `pnpm ... test --` may run the whole project.

```bash
# One web test
pnpm --filter @chalkboard/web exec vitest run \
  src/editor/model/editorState.test.ts

# One server test
pnpm --filter @chalkboard/server exec vitest run \
  src/api/security.test.ts

# All unit and component tests
pnpm test

# One browser test
pnpm playwright test tests/workspace-drawing.spec.ts \
  --project=chromium --grep "exact test name"

# PostgreSQL suites
TEST_DATABASE_URL=postgresql://... pnpm test:integration
E2E_DATABASE_URL=postgresql://... pnpm test:e2e:cloud
```

Local account-email testing uses only `@chalkboard.test` destinations. Complete the visible local human-verification checkbox, open `/development/emails`, and copy the body code; the development sender performs no provider request and retains at most 20 in-memory messages until API restart.

External-provider diagnostics are owned by:

- `apps/server/src/operations/providerDiagnostics.ts`: privacy transformation, complete/private fingerprints, arbitrary-field and HTTP/header inventories, UTF-8 and declared-length integrity, bounded body structure/reads, and non-blocking cancellation-request evidence;
- `apps/server/src/accounts/resendVerificationEmail.ts` plus `email/deliveryDiagnostics.ts`: provider failure classification, idempotent retry bounds, accepted-response reconciliation, workflow propagation, and logging;
- `apps/server/src/humanVerification/humanVerifier.ts` plus `operations/externalProviderLogger.ts`: Turnstile Siteverify request/response evidence and logging;
- `apps/server/src/email/addressValidation.ts` plus the same logger: DNS resolver/fallback evidence;
- `apps/server/src/email/resendFeedback.ts` and `api/resendFeedbackRoutes.ts`: webhook signature, replay-window, and authenticated payload evidence; and
- `apps/web/src/account/turnstileBrowserDiagnostics.ts` plus `HumanVerification.tsx`: bounded local-only Cloudflare script/widget lifecycle.

Adding a new way for the app to talk to the outside world — a `fetch`, an AWS SDK client, a DNS/HTTP/TLS client, a browser script or frame, or a provider callback — means adding a new place where private data could leak into a log. So there is a checklist.

Do all four:

- add it to the provider-boundary inventory;
- use the shared diagnostic contracts rather than inventing a shape;
- prove it reaches either the production logger or bounded local-browser storage;
- update the architecture and operations docs.

Never do any of these:

- ad hoc `console` logging;
- raw `Error` fields, or raw response text;
- a record that is only a hash.

Then test the awkward cases, because these are the ones that have bitten before: complete and partial streams; cancellation that never settles; invalid UTF-8; a declared length that disagrees with the observed one; hostile or mutable getters and proxies; depth and cycle omissions; fields a provider adds later; unknown headers; malformed success _and_ error responses; and that private values really are excluded.

Browser-test groups:

- `workspace*.spec.ts`: editor behavior, board management, export, and fonts;
- `equation*.spec.ts`, `math-line-spacing.spec.ts`: MathLive and equation behavior;
- `pointer-input.spec.ts`, `spline.spec.ts`, `trapezoid.spec.ts`: pointer and geometry behavior;
- `storage-recovery.spec.ts`, `local-restart.spec.ts`: local durability and restart;
- `editable-portability.spec.ts`: archives across browser engines;
- `media-corpus*.spec.ts`: image decoding and cloud asset round trips;
- `product-states.spec.ts`, `accessibility.spec.ts`: recovery UI and accessibility;
- `account*.cloud.spec.ts`, `cloud-recovery.cloud.spec.ts`: accounts, roles, replay, restart, and durable acknowledgement.

Required test observations must use the runtime's `requiredTestValue` or `assertValue` helper. A missing row, browser value, fixture, or callback must fail the test rather than silently return.

## Review checklist for boundary changes

Before changing authentication, roles, links, persistence, imports, assets, save status, or recovery:

1. Identify the authoritative state and enforcement layer.
2. List every input and independent authorization boundary.
3. Define tampering, replay, revocation, expiry, concurrency, cancellation, and failure behavior.
4. Add a negative or bypass test before relying on a positive UI test.
5. Keep previous durable state until replacement commits.
6. Use user-facing wording no stronger than the evidence.
7. Update limits and compatibility fixtures with the implementation.

## Generated and vendored files

Do not commit dependencies, build output, test output, caches, or local PostgreSQL data under `data/`.

`apps/web/src/vendor/excalifont/**` is intentionally tracked third-party material. Change it only with its checksum, license, browser, geometry, and export review. Keep all required notices with the runtime files.

`patches/` holds dependency patches applied by `pnpm install` through `pnpm.patchedDependencies`. Both Dockerfiles copy the directory into the build context before their install step, because pnpm applies patches at install time rather than at build time. `patches/README.md` records what each patch changes, why it cannot live in our own code, and how to re-derive it after an upgrade. Check upstream before carrying one forward.

`deploy/asm-exec` is an intentionally tracked copy of the reviewed resolver supplied with the local `aws-secrets-manager` skill. `deploy/asm-exec.sha256` pins its exact bytes, and every runtime refresh verifies that checksum before resolving a dynamic reference. A replacement requires full source review, checksum update, materializer tests, and the normal release gate.
