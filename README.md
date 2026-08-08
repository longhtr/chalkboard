# Chalkboard

Chalkboard is a collaborative canvas for mathematics, diagrams, and prose. It works without an account for local boards. An account adds cloud boards and live collaboration.

The public application is available at [chalkboard.space](https://chalkboard.space).

## What it does

- Draw shapes, arrows, paths, freehand strokes, text, mathematics, and images.
- Edit prose and mathematics in the same text block.
- Keep local boards in IndexedDB so ordinary editing does not depend on the server.
- Synchronize cloud boards through Yjs and PostgreSQL.
- Import and export editable `.chalkboard` files.
- Export boards as PNG or SVG.
- Provide keyboard controls and an object navigator alongside the visual canvas.

## Run it locally

### Requirements

- Node.js 24 or newer
- pnpm 10.34.5 through Corepack
- PostgreSQL 18 for accounts, cloud boards, and collaboration
- Docker Compose if you want to use the included development database

### Full application

```bash
corepack enable
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed-demo
pnpm dev
```

Open <http://localhost:5173>. Vite serves the browser application and proxies API and WebSocket traffic to the server on port 3000.

### Local editor only

The local editor does not need PostgreSQL or the server:

```bash
corepack enable
pnpm install
pnpm --filter @chalkboard/web dev
```

Open <http://localhost:5173>.

### Configuration

Development works with the defaults. [`.env.example`](.env.example) lists every server setting and its default. Runtime validation lives in `apps/server/src/config.ts`.

Do not commit a real `.env` file or include its values in logs, screenshots, or bug reports.

## Test and build

Run the smallest relevant check while developing. Run the complete set before a release.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The database-backed suites need explicit test database URLs:

```bash
TEST_DATABASE_URL=postgresql://... pnpm test:integration
E2E_DATABASE_URL=postgresql://... pnpm test:e2e:cloud
```

See the [codebase guide](docs/codebase-guide.md) for focused test commands and test ownership.

## Repository layout

| Path              | Contents                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `apps/web`        | React application, editor, local storage, collaboration client, imports, and exports          |
| `apps/server`     | Fastify API, accounts, authorization, assets, collaboration rooms, and PostgreSQL persistence |
| `apps/shared/src` | Contracts and algorithms used by both browser and server                                      |
| `tests`           | Browser tests for behavior that crosses modules or runtimes                                   |
| `docs`            | Architecture, code navigation, and editable-file format                                       |
| `deploy`          | Production Compose configuration, TLS configuration, backup script, and runbook               |

`apps/shared` must remain independent of browser-only and server-only APIs.

## Important design rules

- IndexedDB is the authority for local boards.
- PostgreSQL is the authority for cloud boards.
- A cloud update is not reported as saved until the server has stored it durably.
- Camera and device pixels never become persisted board geometry.
- UI role state is not authorization. REST, assets, and WebSockets enforce access separately.
- Imports, images, API responses, and WebSocket frames are untrusted input and have explicit limits.
- Production supports one collaboration server process. A second process is rejected by a PostgreSQL advisory lock.

The [architecture guide](docs/architecture.md) explains these boundaries.

## Current limitations

- Cloud collaboration is intentionally limited to one server process.
- Invitation links require an account.
- PDF export, comments, mentions, and a version-history interface are not implemented.
- Automated accessibility tests do not replace testing with real assistive technology.
- The current source includes five shared demo accounts for environments where normal email registration cannot be exercised. Their credentials and content are public and must never be used for private data.

## Documentation

Start with [`docs/README.md`](docs/README.md).

- [`docs/architecture.md`](docs/architecture.md): how the system stores, synchronizes, and protects data.
- [`docs/codebase-guide.md`](docs/codebase-guide.md): where each behavior and test belongs.
- [`docs/board-file-format.md`](docs/board-file-format.md): the `.chalkboard` archive contract.
- [`deploy/README.md`](deploy/README.md): build, update, backup, restore, and rollback procedures.

Source code and tests are authoritative when documentation and behavior disagree.

## License

Chalkboard's source is released under the [Unlicense](LICENSE).

Vendored font and MathLive material keeps its original license:

| Component                                                      | License                   | Notices                               |
| -------------------------------------------------------------- | ------------------------- | ------------------------------------- |
| Excalifont outlines in `apps/web/src/vendor/excalifont/fonts/` | SIL Open Font License 1.1 | `OFL.txt` and `ATTRIBUTION.txt`       |
| MathLive adapter and stylesheets in the same directory         | MIT                       | `MATHLIVE_LICENSE.txt`                |
| KaTeX-compatible font metadata and names                       | SIL Open Font License 1.1 | `KATEX_FONT_NOTICE.txt` and `OFL.txt` |

The web build copies these notices to `dist/licenses/`, and the production web image serves them at `/licenses/`. Keep them with every distribution.
