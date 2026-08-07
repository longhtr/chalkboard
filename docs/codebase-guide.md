# Codebase guide

## 1. Purpose

This guide maps implementation and test ownership. [`architecture.md`](architecture.md) explains the stable runtime contracts; this document shows where to read and change them.

Start at the owning boundary below instead of searching from `Workspace.tsx` or adding another responsibility to a large component.

### Known design compromises

- `Workspace.tsx` is still a large composition root. Supporting behavior belongs in the chapter modules below; adding another independent lifecycle directly to the component is a design regression.
- `App.tsx` still coordinates route intent, sessions, and both board libraries; new account or navigation workflows should leave that component rather than enlarge it.
- `usePointerController.ts` remains one large gesture state machine. New gestures should extract transitions into `editor/interaction` instead of adding another branch in the hook.
- `InlineMathEditor.tsx` contains one long imperative effect because MathLive field construction, shadow-DOM readiness, selection, browser events, and teardown share one lifetime. Focused controllers own algorithms, but splitting lifetime ownership across effects would create races.
- Collaboration rooms live in one server process, and in-memory rate-limit counters depend on that. Production does not merely assume it: `RUNTIME_LOCK_NAME` is taken with `pg_try_advisory_lock` at readiness, so a second instance refuses to start rather than competing for Yjs room ownership. Relaxing that lock requires shared room ordering, fanout, and rate-limit counters first.
- Board text has structured storage and canonical compatibility source. That duplication exists for migration and archive compatibility; structured content wins when both are present.
- `accounts/passwordWorkController.ts` and `collaboration/compactionController.ts` implement the same bounded first-in, first-out admission queue twice. They stay separate because one gates the durability path and the other gates password hashing; a shared primitive would make every change to either force re-verification of both. Change them together only when the admission policy itself changes.
- Canvas geometry and DOM mathematics intentionally use different renderers. Shared camera and world-space contracts keep them aligned.

## 2. Runtime entry points

| Runtime             | Entry                               | Composition                                                                                                                       |
| ------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Web                 | `apps/web/src/main.tsx`             | Captures the entry URL, installs the application error boundary, and mounts `App`.                                                |
| Browser application | `apps/web/src/App.tsx`              | Resolves local/cloud routes, session state, board libraries, and the selected `Workspace`.                                        |
| Editor              | `apps/web/src/editor/Workspace.tsx` | Integrates tools, document state, persistence, collaboration, rendering, and dialogs. Treat as a high-risk orchestration hotspot. |
| API/server          | `apps/server/src/index.ts`          | Loads validated configuration, builds Fastify, handles signals, and starts listening.                                             |
| Fastify composition | `apps/server/src/app.ts`            | Installs security headers, REST, collaboration, diagnostics, health, metrics, and drain behavior.                                 |
| Database migration  | `apps/server/src/db/migrate.ts`     | Applies checksum-protected, locked, forward-only SQL migrations.                                                                  |

## 3. Browser ownership map

### Application, account, and routing

| Responsibility                                | Owner                                                                                     | Primary tests                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| Route parsing/path construction               | `account/boardRouting.ts`                                                                 | `boardRouting.test.ts`                      |
| Session bootstrap/cache                       | `account/useSession.ts`                                                                   | `useSession.test.tsx`                       |
| Invitation redemption                         | `account/useBoardInvitation.ts`                                                           | `App.test.tsx`, cloud E2E                   |
| REST transport, errors, and response decoding | `account/api.ts`                                                                          | `api.test.ts`, account/App tests            |
| Login, verified registration, and recovery    | `account/AccountForm.tsx`, `PasswordResetForm.tsx`, `VerificationCodeForm.tsx`            | adjacent tests and account browser stories  |
| Personal account settings                     | `account/AccountPanel.tsx`, `AccountSettings.tsx`                                         | adjacent tests and cloud E2E                |
| Board-level sharing                           | `account/BoardAccessPanel.tsx`, `MemberManager.tsx`, `BoardInviteLinks.tsx`               | adjacent tests and cloud E2E                |
| Local-board library UI                        | `account/LocalBoardLibrary.tsx`                                                           | component test, workspace/local restart E2E |
| Fatal recovery                                | `components/AppErrorBoundary.tsx`                                                         | `AppErrorBoundary.test.tsx`                 |
| Best-effort preference/compatibility cache    | `bestEffortStorage.ts`, `editor/local/browserState.ts`, `editor/workspace/preferences.ts` | adjacent tests, product-state E2E           |

### Editor chapters

`editor/Workspace.tsx` is the composition root. Its supporting code is grouped by ownership rather than kept in one flat directory:

| Chapter              | Responsibility                                                                 | Examples                                                                |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `editor/model`       | Board limits, serialization, title, element creation, committed history        | `editorState.ts`, `elementCreation.ts`                                  |
| `editor/interaction` | Geometry, selection, tools, keyboard commands, culling, canvas drawing         | `interactionGeometry.ts`, `rendering.ts`, `keyboardCommands.ts`         |
| `editor/equation`    | Board-level equation edits, sizing, recovery, hit testing, typing color        | `equationEditing.ts`, `renderedEquationHitTest.ts`                      |
| `editor/local`       | IndexedDB, migration, repository, recovery, persistence, trash                 | `boardStorage.ts`, `localBoardRepository.ts`                            |
| `editor/cloud`       | Device cloud cache, assets, and independent local/cloud copies                 | `cloudBoardCacheQueue.ts`, `localToCloud.ts`                            |
| `editor/portability` | Archives, import validation, ZIP, PNG/SVG export, structured reconciliation    | `boardArchive.ts`, `workspaceExport.ts`                                 |
| `editor/workspace`   | React controls and hooks composing camera, input, overlays, panels, and canvas | `usePointerController.ts`, `useImageWorkflow.ts`, `ObjectNavigator.tsx` |

Keep tests beside their owner. A new file belongs in one chapter; if it crosses chapters, fix the ownership boundary instead of creating a generic utility directory.

### Mathematics

| Responsibility                      | Owner                                                                                | Primary tests                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Mixed-source parser/normalization   | `math/mixedMath.ts`                                                                  | `mixedMath.test.ts`, equation fuzz                  |
| Structured mixed document           | `math/mixedDocument.ts`                                                              | adjacent test, cloud model tests                    |
| Static untrusted rendering cleanup  | `math/renderSanitizer.ts`                                                            | `renderSanitizer.test.ts`, equation/export E2E      |
| Static conversion/cache/decoration  | `math/staticMathMarkup.ts`, `staticMathDecoration.ts`                                | adjacent tests and equation browser stories         |
| Inactive rendering/measurement      | `math/MathElement.tsx`, `editor/workspace/useEquationMeasurementQueue.ts`            | adjacent tests and equation browser stories         |
| Shared static geometry observation  | `math/sharedResizeObserver.ts`                                                       | adjacent test and equation browser stories          |
| Active MathLive lifecycle/clipboard | `math/InlineMathEditor.tsx`, `editorEventLifecycle.ts`, `editorClipboard.ts`         | adjacent teardown test, equation specs/fuzz/history |
| Input event/publication boundary    | `math/InlineMathEditor.tsx`, `editorPublication.ts`                                  | equation editing and publication tests              |
| Active-editor position/selection    | `math/editorSelectionController.ts`, `editorPositions.ts`                            | adjacent tests and equation browser tests           |
| Command transactions/history        | `math/editorCommandController.ts`, `editorCommandTransaction.ts`, `editorHistory.ts` | adjacent tests and equation browser tests           |
| Font runtime/assets                 | `math/mathLiveRuntime.ts`, `workspaceFontAssets.ts`                                  | font/export browser tests                           |
| Searchable syntax reference         | `math/LatexCheatsheet.tsx`, `latexReference.ts`                                      | component behavior and browser stories              |

`InlineMathEditor.tsx` is a known review hotspot. New command logic belongs in tested command modules; new position or clipboard conversion logic belongs in its focused modules; do not extend its main lifecycle effect without a teardown and ownership review.

### Persistence and portability rules

Persistent writers live in `editor/local` or `editor/cloud`; archive and export boundaries live in `editor/portability`. They require compatibility fixtures and atomic-failure tests. Snapshot links are editable, URL-bounded copies—not authorization or backup.

### Collaboration client

| Responsibility                       | Owner                                                               | Primary tests                               |
| ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------- |
| Yjs element model/convergence        | `collaboration/cloudBoardModel.ts`                                  | `useCloudBoard.test.ts`, shared codec tests |
| Incremental local publication        | model updater plus `useCloudBoard.ts`                               | model identity test and cloud E2E           |
| WebSocket/replay/ack/reconnect state | `collaboration/useCloudBoard.ts`, `collaboration/cloudReconnect.ts` | hook tests and cloud E2E                    |
| Presence rendering                   | `editor/workspace/CollaborationOverlay.tsx`                         | cloud E2E                                   |

## 4. Server ownership map

| Responsibility                              | Owner                                                                                                        | Primary tests                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Configuration                               | `config.ts`                                                                                                  | `config.test.ts`                            |
| Security origin/rate primitives             | `api/security.ts`                                                                                            | `security.test.ts`                          |
| Shared REST admission/composition           | `api/routes.ts`, `api/requestAdmission.ts`                                                                   | route unit and PostgreSQL integration tests |
| Account/session HTTP protocol               | `api/authRoutes.ts`                                                                                          | password-work and route integration tests   |
| Accounts/passwords/sessions                 | `accounts/service.ts`, `accounts/passwordWorkController.ts`                                                  | route/controller/integration tests          |
| Verification codes and empty email delivery | `accounts/verificationCode.ts`, `accounts/verificationEmail.ts`, `api/accountRoutes.ts`, `api/authRoutes.ts` | adjacent and API integration tests          |
| Active boards and memberships               | `api/boardRoutes.ts`, `api/memberRoutes.ts`                                                                  | route integration and cloud E2E             |
| Board data/invites/trash                    | `boards/service.ts`, `api/{invite,boardTrash}Routes.ts`, migrations `0003`/`0004`                            | route integration and cloud E2E             |
| API/asset request admission                 | `api/requestAdmission.ts`                                                                                    | adjacent unit and route tests               |
| Asset HTTP boundary                         | `assets/routes.ts`                                                                                           | asset integration tests                     |
| Asset authorization                         | `assets/service.ts`                                                                                          | route and asset integration tests           |
| Asset byte/media/container limits           | `assets/{validation,rasterValidation}.ts`                                                                    | `validation.test.ts`, asset integration     |
| WebSocket upgrade/auth/invalidation         | `collaboration/gateway.ts`                                                                                   | `gateway.test.ts`, cloud E2E                |
| Room registry and connection queue          | `collaboration/hub.ts`                                                                                       | gateway, admission, crash, and fuzz tests   |
| Yjs room protocol and retirement            | `collaboration/room.ts`, `collaboration/persistenceQueue.ts`                                                 | gateway, admission, crash, and fuzz tests   |
| Yjs document/compaction admission           | `collaboration/documentAdmission.ts`, `collaboration/compactionController.ts`                                | adjacent unit and gateway tests             |
| Awareness ownership/limits                  | `collaboration/awarenessAdmission.ts`                                                                        | adjacent unit and gateway tests             |
| Yjs append/load/compaction                  | `collaboration/persistence.ts`                                                                               | persistence/crash integration tests         |
| PostgreSQL pool/runtime lock                | `db/database.ts`                                                                                             | app and migration integration tests         |
| Safety and ownership metrics                | `operations/metrics.ts`                                                                                      | metrics and application unit tests          |

Authorization changes must be tested independently at REST, asset, and WebSocket boundaries. UI role state is not evidence.

## 5. Shared boundary

`apps/shared/src` contains the environment-neutral implementation and its adjacent tests; package configuration remains in `apps/shared`.

- `elementSchema.ts`: board element contracts and limits.
- `geometry.ts`: bounds, transforms, canonical paths, and hit testing.
- `orthogonalFitting.ts`: bounded right-angle path fitting from pointer samples.
- `bezierFitting.ts`: intent filtering, adaptive sampling, geometrically validated C0/C1/C2 candidate selection, and safety fallback.
- `bezierContinuity.ts`: constrained C1 fitting, stable natural C2 fitting, periodic seams, and continuity-preserving handle projection.
- `curveGeometry.ts`: canonical distance, chord-parameter, cubic-evaluation, fit-cost, and polyline-to-cubic primitives used by fitters.
- `shapeGeometry.ts`: canonical shape outlines, corner rounding, and the scanline that clips hatch fills to them.
- `crc32.ts`: one checksum implementation for ZIP archives and PNG validation.
- `mixedContent.ts`: structured mixed-text schema.
- `yjsMixedContent.ts`: Yjs structured-content codec.
- `schemaVersions.ts`: centralized public schema versions.
- `accountContract.ts`: shared authenticated-user projection and account-field bounds.
- `boardContract.ts`: shared board roles, member/invitation/trash projections, and Unicode-safe title limits.
- `collaborationContract.ts`: stable browser/server binary message tags.
- `health.ts`: service health/diagnostic contracts.
- `index.ts`: supported public exports.

Do not import browser or server runtime modules into this boundary.

## 6. Tests as examples

Nullable setup observations must use the runtime-specific `requiredTestValue` or `assertValue` helper. A test must fail when a required row, browser bound, fixture entry, or callback is missing; it must not silently return or hide the precondition with a non-null assertion.

Use exact commands; `pnpm --filter ... test -- name` may run the whole Vitest project depending on argument forwarding.

```bash
# One browser-module test
pnpm --filter @chalkboard/web exec vitest run \
  src/editor/model/editorState.test.ts

# One server test
pnpm --filter @chalkboard/server exec vitest run src/api/security.test.ts

# Every colocated unit and component example
pnpm test

# One browser story
pnpm playwright test tests/workspace-drawing.spec.ts \
  --project=chromium --grep "exact test name"

# PostgreSQL boundaries
TEST_DATABASE_URL=postgresql://... pnpm test:integration
E2E_DATABASE_URL=postgresql://... pnpm test:e2e:cloud
```

Browser-story ownership:

- `workspace*.spec.ts`: local editor behavior, board management, exports, and fonts;
- `equation*.spec.ts` and `math-line-spacing.spec.ts`: MathLive lifecycle, commands, multiline source, and line spacing;
- `pointer-input.spec.ts`, `spline.spec.ts`, and `trapezoid.spec.ts`: pointer modalities and geometry;
- `storage-recovery.spec.ts` and `local-restart.spec.ts`: storage faults and browser restart;
- `editable-portability.spec.ts`: archive portability across browser engines;
- `media-corpus*.spec.ts`: image decoding and PostgreSQL-backed asset round trips;
- `product-states.spec.ts` and `accessibility.spec.ts`: recovery layouts and accessibility contracts;
- `account*.cloud.spec.ts` and `cloud-recovery.cloud.spec.ts`: accounts, roles, replay, restart, and durable acknowledgement.

## 7. Trust-boundary checklist

Before changing authentication, roles, links, persistence, imports, assets, save status, or recovery:

1. Name the authoritative state and enforcement layer.
2. List every entry point and independent boundary.
3. Define replay, tampering, revocation, expiry, concurrency, and failure behavior.
4. Add a negative/bypass test before the positive UI test.
5. Preserve previous durable state until replacement commits.
6. Keep user-facing wording narrower than the proven evidence.
7. Update architecture, limits, and compatibility fixtures together.

## 8. Generated and vendored content

Generated material is never part of the source tree. Remove dependency directories, build output, test output, and tool caches before handoff. Local PostgreSQL data remains ignored under `.data`.

`apps/web/src/vendor/excalifont/**` is different: it is a checked-in third-party artifact with its own checksum, license, and rendering instructions. It keeps only what the browser runtime loads; the upstream handoff's audit reports, review specimens, and OpenType export faces are not retained. Change it only through that documented process.
