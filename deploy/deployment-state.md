# Chalkboard deployment state

This document records what Chalkboard deploys as and what it requires of its environment. Use [`../docs/architecture.md`](../docs/architecture.md) for the runtime and trust boundaries these requirements protect.

Everything here is enforced by code rather than convention. Each rule fails closed and loudly, so a violation appears as a refused startup or an explicit error rather than as degraded behavior discovered later.

## Artifacts

Chalkboard deploys as two images, both built from the repository root.

| Image                    | Base                    | Serves                                  |
| ------------------------ | ----------------------- | --------------------------------------- |
| `apps/server/Dockerfile` | node:24-alpine, `node`  | Fastify REST, assets, Yjs WebSocket     |
| `apps/web/Dockerfile`    | nginx-unprivileged, 101 | Compiled SPA on 8080, proxies to server |

```bash
docker build -f apps/server/Dockerfile \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-arg APP_VERSION=0.1.0 \
  -t chalkboard-server:0.1.0 .

docker build -f apps/web/Dockerfile \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-arg APP_VERSION=0.1.0 \
  -t chalkboard-web:0.1.0 .
```

`VCS_REF` becomes `CHALKBOARD_COMMIT` and must be the 40-character lowercase commit SHA; `APP_VERSION` becomes `CHALKBOARD_VERSION`. Both are baked into the image and reported by `/api/diagnostics`. Production refuses to start when the commit is `development` or all zeroes, so a build that cannot be traced to a source revision cannot serve traffic.

The shared workspace package is source-only and is bundled into `dist` by `tsup` (`noExternal`), so the server image deliberately does not copy `apps/shared`. CI's `image` job builds the Dockerfile and boots the result, which is what proves the bundling still holds — a build that left `@chalkboard/shared` external fails there rather than in production.

The web image carries the content-security policy and the remaining browser-facing headers, serves hashed assets with a one-year cache and everything else uncached, and falls back to `index.html` so client routes deep-link correctly.

Images are architecture-specific. A build produced on an arm64 machine runs only on arm64 hosts; use `--platform` to cross-build.

## Topology and proxy depth

```text
browser ──HTTPS──▶ TLS terminator ──HTTP──▶ web (nginx :8080) ──▶ server (:3000) ──▶ PostgreSQL
```

The web image listens on plain HTTP and never terminates TLS, while `PUBLIC_ORIGIN` must be HTTPS outside local development. Something therefore always terminates TLS in front of it, and the resulting chain is two proxies deep: the terminator, then nginx, then Fastify.

`TRUST_PROXY_HOPS` must describe that depth exactly, and the schema constrains it to `1` or `2`. The default of `1` is correct only for local development, where nothing sits in front of nginx. **Every production deployment uses `2`**, and because the maximum is `2`, a third proxy cannot be expressed — a CDN placed in front of a separate TLS terminator is not a configuration this application accepts. A CDN may serve as the terminator itself, talking directly to nginx.

The value is not cosmetic. Fastify derives the client address from it, and a wrong depth either attributes every request to one proxy address — collapsing all callers into a single rate-limit bucket — or trusts a client-supplied `X-Forwarded-For`, letting a caller forge its own identity.

The web edge deliberately exposes less than the server does. `/health/ready` and `/metrics` return `404` through nginx because readiness runs a database query and metrics describe the private network. Scrape both by addressing the server directly.

## Required configuration

`loadConfig` validates the environment once at startup and refuses unsafe combinations rather than starting in a state it cannot serve correctly. In production the following are mandatory.

| Variable                   | Requirement                                                                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | PostgreSQL connection URL                                                                                                                                                                                                  |
| `PUBLIC_ORIGIN`            | The exact browser-facing origin, without path, query, or credentials. HTTPS unless the host is `localhost`, `127.0.0.1`, or `::1`. It pins the accepted request `Origin`, so a wrong value rejects every browser mutation. |
| `CHALKBOARD_COMMIT`        | 40-character lowercase SHA; `development` and an all-zero SHA are refused                                                                                                                                                  |
| `AWS_REGION`, `EMAIL_FROM` | Required together. The SES region, and a sender address that must be a verified SES identity.                                                                                                                              |

There is deliberately no credential setting. The SES client resolves credentials from the ambient AWS provider chain, so a deployment attaches an IAM role granting `ses:SendEmail` and `ses:GetAccount` rather than storing a long-lived secret in the environment. Every other setting has a bounded default; `.env.example` lists them and `apps/server/src/config.ts` validates them.

This deployment runs in `ap-southeast-1`, so that is the value of `AWS_REGION`.

## Migrations

Migrations are forward-only, applied under one advisory lock, and verified against stored checksums, so an edited historical migration fails loudly instead of silently redefining an applied schema version.

They run from the same image, with the server stopped, before the new version starts:

```bash
docker run --rm -e DATABASE_URL=postgresql://... \
  chalkboard-server:0.1.0 node dist/migrate.js
```

The runner reads **only** `DATABASE_URL`. Requiring the serving configuration would force an operator to hand a migration job a public origin and mail settings it would never use.

## Health, readiness, and drain

| Endpoint           | Meaning                                               |
| ------------------ | ----------------------------------------------------- |
| `/health/live`     | The process can answer. Use for liveness restarts.    |
| `/health/ready`    | The database answered and the server is not draining. |
| `/api/diagnostics` | Version and commit of the running build.              |
| `/metrics`         | Operational counters.                                 |

A load balancer watches `/health/ready`. During shutdown it returns `503` before connections close, so traffic drains before collaboration state is flushed.

The external kill deadline must exceed `SHUTDOWN_TIMEOUT_MS` (default 30s). The process force-exits at that deadline, so an equal or shorter deadline can lose a final compaction. Kubernetes' default grace period of 30s is exactly equal and must be raised.

## Verification email

Chalkboard sends mail through the Amazon SES API (`@aws-sdk/client-sesv2`). The reason is credentials: the SES client resolves them from the ambient AWS provider chain, so an instance role supplies them and nothing long-lived is stored in configuration or on disk.

`apps/server/src/accounts/verificationEmail.ts` is the only file that knows about the provider. Everything above it depends on the `VerificationEmailSender` interface — `send`, `verify`, `close` — so the delivery mechanism is replaceable without touching a route, a service, or a table.

Every verification message is subject-only: the short-lived code appears in the subject and the body is a single invisible space, so a recipient never needs to open the message. The body is a space rather than genuinely empty because some providers reject a zero-length content field.

Three flows send mail, and their failure semantics deliberately differ.

| Flow           | Delivery        | On failure                                                |
| -------------- | --------------- | --------------------------------------------------------- |
| Registration   | Awaited         | `502`, and the account is not usable until a code arrives |
| Email change   | Awaited         | `502`, and the address is unchanged                       |
| Password reset | Fire-and-forget | Logged only; the response is always `202`                 |

Password reset is asynchronous on purpose. Known and unknown addresses receive an identical `202`, and delivery proceeds after that response so delivery latency cannot reveal whether an address has an account.

Credentials are probed once when the server becomes ready, using a cheap authenticated SES call. A failure — missing role, wrong region, no permission — is logged at error level and **does not stop the server**: collaboration, boards, and every non-account route work without mail, so a provider outage must not prevent restarts. Configuration completeness is enforced separately at startup, so _missing_ settings in production are fatal while _unusable credentials_ are not.

When `AWS_REGION` and `EMAIL_FROM` are absent outside production, the sender does not deliver at all — it writes the subject to the log instead, which is how registration is exercised in development. Under `NODE_ENV=test` delivery is disabled unconditionally, so deterministic test codes cannot reach a real provider even when a developer's `.env` names a real identity. No AWS credentials are ever needed to run or test the application.

Two SES constraints apply regardless of configuration. `EMAIL_FROM` must be a **verified SES identity**, and a new SES account is **sandboxed** until AWS grants production access, delivering only to verified recipients. Because registration depends on delivery, sandbox mode limits who can create an account. Separately, a code-in-subject message with no body has weak spam-filter characteristics, so SPF and DKIM on the sending domain matter more than usual.

## One collaboration server

Production runs exactly one collaboration server, and the server enforces this itself rather than trusting the deployment. On becoming ready it takes the `chalkboard:single-collaboration-server` PostgreSQL advisory lock with `pg_try_advisory_lock`. A second instance fails immediately with `Another Chalkboard collaboration server holds the production runtime lock` instead of quietly serving the same boards.

Two pieces of in-process state are correct only because of it. A board's Yjs room is owned in memory by the process that loaded it, so two owners would reconcile only through PostgreSQL appends. And `createRateLimiter` counts per process, so one server means one true count; its key table is bounded and evicts the least recently used, so a flood of distinct keys cannot reset an actively limited caller.

The consequence for deployment is that the old container stops before the new one starts, because an overlapping start fails the lock. Rolling replacement is therefore impossible and brief downtime is part of every deploy. Scaling out is not a configuration change: it requires shared room ownership and shared rate-limit counters first.

## Persistence

PostgreSQL holds everything. `board_assets` stores uploaded images in the database rather than in object storage, so a single volume carries every board, account, and image in the system. Nothing in the application reports whether that volume is backed up.

The stack runs a `backup` service that dumps the database on an interval, verifies each dump by reading its table of contents, and prunes by age. One dump is a complete copy of the application's data, because there is no store outside PostgreSQL. The dumps are written to a volume on the same disk, so they answer deletion, corruption, and a bad migration — not the loss of the disk. Disk loss requires a snapshot of the volume itself, taken outside the application by the host platform, and the two mechanisms do not substitute for one another.

## Dependency advisories

`pnpm audit` reports one accepted low-severity advisory: esbuild's development server can read arbitrary files on Windows (GHSA-g7r4-m6w7-qqqr). It reaches the tree only through `tsup`, the server's build-time bundler.

Pinning does not fix it, because the patched release is outside the range `tsup` declares and forcing it would change bundler output for no security gain. It is unreachable here on three counts: `tsup` never calls esbuild's `serve` API, the advisory is Windows-only, and neither package exists in the production image, which installs with `--prod`. Re-check those three claims before accepting it again.

Advisories that _are_ fixable by pinning belong in `pnpm.overrides` in the root `package.json`, alongside the existing entries.

## Third-party licences

Chalkboard's own source is public domain under the Unlicense. The vendored Excalifont outlines remain under the SIL Open Font License, whose notice must travel with every copy of them.

The web build copies `OFL.txt`, `ATTRIBUTION.txt`, `KATEX_FONT_NOTICE.txt`, and `MATHLIVE_LICENSE.txt` into `dist/licenses/`, and the web image serves them at `/licenses/`. A missing notice fails the build rather than shipping. Do not strip or relicense them.
