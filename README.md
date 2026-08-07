# Chalkboard

Chalkboard is a local-first collaborative mathematics canvas. Its browser editor, IndexedDB storage, Yjs collaboration, WebSocket transport, and PostgreSQL service keep transient presentation state separate from durable board state.

## Core behavior

- World-space geometry stays independent of camera and device pixels.
- Prose and mathematics share one editable structured document.
- Transient pointer state stays separate from committed undo history.
- IndexedDB remains authoritative while small browser caches aid recovery.
- Yjs updates are replayed, persisted, acknowledged, and compacted.
- Authorization is enforced independently at REST, asset, and WebSocket boundaries.
- Hostile images and editable archives are validated before storage.
- An accessible object navigator complements the visual canvas.
- Tests cover model, component, protocol, database, and browser contracts.

## Repository map

```text
apps/web
  React application, canvas editor, MathLive integration,
  local persistence, collaboration client, imports, and exports

apps/server
  Fastify API, authentication, authorization, assets,
  Yjs room lifecycle, PostgreSQL persistence, and migrations

apps/shared/src
  Environment-neutral account and board contracts, geometry,
  mixed content, Yjs codecs, schema versions, and health contracts

docs
  Architecture, code navigation, and archive-format explanations

deploy
  Production compose stack, TLS terminator config, and the
  deployment state the running system requires

tests
  Browser stories for visible behavior and recovery boundaries
```

`apps/shared` is a workspace because both runtimes depend on it. It must not import browser-only or server-only APIs.

## Read the code as chapters

1. Start with [`docs/architecture.md`](docs/architecture.md) for the state and trust boundaries.
2. Use [`docs/codebase-guide.md`](docs/codebase-guide.md) to find the module that owns a behavior.
3. Follow a local edit from `apps/web/src/editor/Workspace.tsx` into `editor/model`, `editor/interaction`, and `editor/local`.
4. Follow a cloud edit from `apps/web/src/collaboration/useCloudBoard.ts` through `apps/server/src/collaboration/gateway.ts`, `hub.ts`, and `room.ts` into PostgreSQL persistence.
5. Read adjacent tests as executable examples of each contract.
6. Read [`docs/board-file-format.md`](docs/board-file-format.md) for a complete hostile-input boundary.

## Run locally

Requirements:

- Node.js 24+
- pnpm 10.34.5 through Corepack
- PostgreSQL 18 for server and cloud work
- Docker Compose if you want the checked-in development database

Run the complete local application:

```bash
corepack enable
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open <http://localhost:5173>. The Vite server proxies API, health, and collaboration requests to Fastify on port 3000.

For the local-only editor, PostgreSQL and the server are unnecessary:

```bash
pnpm install
pnpm --filter @chalkboard/web dev
```

The server is configured by environment variables. Every one has a default, so development needs none of them. [`.env.example`](.env.example) lists them all with their defaults; `apps/server/src/config.ts` is what validates them at startup.

Production also needs `AWS_REGION` and `EMAIL_FROM` for Amazon SES, which sends account verification codes. There is no key or secret setting; the SES client reads AWS credentials from the environment it runs in. Verification emails put the code in the subject and have an empty body.

## Main editor controls

- `Ctrl/Command + 1–6`: selection, canvas drag, shapes, paths, mixed text, and freehand
- `Space` + drag: pan
- wheel or trackpad scroll: pan
- pinch or zoom controls: zoom
- `Ctrl/Command + M`: switch mixed-text input between text and math
- `Alt + Arrow`: move between mixed-text blocks
- `Alt + J/K`: cycle the future typing color
- `Ctrl/Command + Z`: undo in the active text or board context
- `Ctrl/Command + Shift + Z`: redo
- `Ctrl/Command + C/V`: copy and paste selected objects
- `Delete` or `Backspace`: delete selected objects

The board menu owns board creation/opening, image import, editable board import/export, image export, grid settings, and the Math/LaTeX reference. Share appears only on cloud boards and owns membership and invitation access.

## Checks

Install dependencies first, then run the smallest check that covers the boundary you changed:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Database-backed suites are separate:

```bash
TEST_DATABASE_URL=postgresql://... pnpm test:integration
E2E_DATABASE_URL=postgresql://... pnpm test:e2e:cloud
```

The repository keeps tests beside their implementation when they cover a local contract. Browser stories live under `tests` when behavior crosses modules or runtimes.

## Current limitations

- Cloud collaboration uses one server process because room ownership is in memory.
- Invitation links require an account; anonymous public collaboration is not implemented.
- Automated accessibility checks do not replace testing with real assistive technology.
- PDF export, comments, mentions, and version-history UI are not implemented.

These limitations are architectural facts, not a roadmap.

## Documentation

[`docs/README.md`](docs/README.md) is the documentation index.

- [`docs/architecture.md`](docs/architecture.md) explains runtime, state, durability, and trust boundaries.
- [`docs/codebase-guide.md`](docs/codebase-guide.md) maps each responsibility to its implementation and tests.
- [`docs/board-file-format.md`](docs/board-file-format.md) explains the editable archive format and validation sequence.
- [`deploy/deployment-state.md`](deploy/deployment-state.md) records the artifacts, configuration, and constraints a running deployment requires.

## License

Chalkboard's own source is public domain under the [Unlicense](LICENSE). Use it
for anything, with or without attribution.

Bundled third-party material keeps its own terms:

| Component                                                     | License                                                  | Retained notices                            |
| ------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Excalifont outlines (`apps/web/src/vendor/excalifont/fonts/`) | SIL Open Font License 1.1                                | `OFL.txt` and `ATTRIBUTION.txt` beside them |
| MathLive adapter and stylesheets (same directory)             | MIT                                                      | `MATHLIVE_LICENSE.txt` beside them          |
| KaTeX compatibility names                                     | naming notice only                                       | `KATEX_FONT_NOTICE.txt` beside them         |
| Installed dependencies                                        | Apache-2.0, BSD-3-Clause, BlueOak-1.0.0, ISC, MIT, MIT-0 | `pnpm-lock.yaml`                            |

The OFL requires its notice to travel with the fonts, so the build copies all of
the above into `dist/licenses/` and the web image serves them at `/licenses/`.
Keep those files; the Unlicense does not permit relicensing them.
