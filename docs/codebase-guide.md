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
| Public policy and contact pages                 | `public/PublicInformationPage.tsx`, `public/publicRoutes.ts`                           | `PublicInformationPage.test.tsx`      |
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
| Commands and history                    | `math/editorCommandController.ts`, `editorCommandTransaction.ts`, `editorHistory.ts` |
| Font loading                            | `math/mathLiveRuntime.ts`, `workspaceFontAssets.ts`                                  |
| Searchable syntax help                  | `math/LatexCheatsheet.tsx`, `latexReference.ts`                                      |

`InlineMathEditor.tsx` has one large imperative lifetime because field creation, shadow-DOM readiness, browser events, selection, and teardown must stay ordered. Put algorithms in focused modules. Any change to the main effect needs explicit teardown and race testing.

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
| Verification codes and message delivery | `accounts/verificationCode.ts`, `accounts/verificationEmail.ts`                                                    | adjacent and route tests            |
| Email workflow ordering                 | `email/workflows.ts`, `email/addressValidation.ts`                                                                 | adjacent and integration tests      |
| Durable email admission and cleanup     | `email/emailSecurity.ts`, migrations `0007_email_security.sql` and `0009_maintenance_cleanup_indexes.sql`          | unit and PostgreSQL race tests      |
| Turnstile verification                  | `humanVerification/humanVerifier.ts`                                                                               | adjacent tests                      |
| Authenticated SES feedback              | `email/snsFeedback.ts`, `email/feedback.ts`, `api/emailFeedbackRoutes.ts`                                          | unit and PostgreSQL tests           |
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
| Retained secret, existing-identity IAM, configuration set, SNS policy/events, sender and MAIL FROM outputs | `deploy/ses-feedback.yaml`                                                            | `deploy/account-email-infrastructure.test.mjs`, `deploy/account-email.guard` |
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
| `orthogonalFitting.ts`                                        | Right-angle path fitting                              |
| `bezierFitting.ts`, `bezierContinuity.ts`, `curveGeometry.ts` | Curve fitting and continuity                          |
| `shapeGeometry.ts`                                            | Shape outlines, rounding, and hatch clipping          |
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
- `apps/server/src/accounts/verificationEmail.ts` plus `email/deliveryDiagnostics.ts`: SES failure, accepted-response reconciliation, workflow propagation, and logging;
- `apps/server/src/humanVerification/humanVerifier.ts` plus `operations/externalProviderLogger.ts`: Turnstile Siteverify request/response evidence and logging;
- `apps/server/src/email/addressValidation.ts` plus the same logger: DNS resolver/fallback evidence;
- `apps/server/src/email/snsFeedback.ts` and `api/emailFeedbackRoutes.ts`: SNS envelope/signature/certificate/confirmation and authenticated SES payload evidence; and
- `apps/web/src/account/turnstileBrowserDiagnostics.ts` plus `HumanVerification.tsx`: bounded local-only Cloudflare script/widget lifecycle.

When adding an outbound provider primitive (`fetch`, AWS SDK client, DNS/HTTP/TLS client, browser external script/frame, or provider callback), update the provider-boundary inventory, use the shared diagnostic contracts, prove adapter-to-production-logger or bounded local-browser persistence, and update architecture/operations docs. Do not add ad hoc `console` logging, raw `Error` fields, raw response text, or a hash-only record. Test complete and partial streams, never-settling non-blocking cancellation, invalid UTF-8, declared-length mismatch, hostile and mutable getters/proxies, depth/cycle omissions, future fields, unknown headers, malformed success/error responses, and private-value exclusion.

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

`deploy/asm-exec` is an intentionally tracked copy of the reviewed resolver supplied with the local `aws-secrets-manager` skill. `deploy/asm-exec.sha256` pins its exact bytes, and every runtime refresh verifies that checksum before resolving a dynamic reference. A replacement requires full source review, checksum update, materializer tests, and the normal release gate.
