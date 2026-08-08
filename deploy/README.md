# Production runbook

This directory contains the production controls:

| File                      | Purpose                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `compose.production.yaml` | Runs PostgreSQL, one-shot jobs, application services, backup worker, and edge proxy |
| `Caddyfile`               | Terminates TLS and forwards public traffic to the web container                     |
| `backup.sh`               | Creates, verifies, rotates, and retries PostgreSQL logical backups                  |

The deployment is one Arm64 host running Docker Compose. Only Caddy publishes host ports. The database, Fastify server, nginx, and metrics endpoints remain private to the Compose network.

This document is a procedure, not a record of a particular host. Before operating production, obtain the current host, image, commit, backup, and recovery details from the operator's private handoff.

## Safety rules

- Ask before a deployment, reboot, restore, snapshot-policy change, security-group change, or other infrastructure mutation.
- Use the exact pushed commit that passed all required local and CI checks.
- Never amend or squash a commit after building production images from it.
- Never print `.env` or run `docker compose config` without `--quiet` in captured output.
- Never publish PostgreSQL, Fastify, nginx, or metrics ports.
- Never prune Docker volumes or remove images used by the running or rollback stack.
- Keep Caddy closed while privately validating a replacement server and web container.
- Preserve a logical dump and off-instance recovery point before changing the database or application.
- Expect downtime. This is a single-host, single-server deployment.

## Services and startup order

Compose runs these services:

1. `postgres`: PostgreSQL data and assets.
2. `migrate`: verifies and applies checksum-protected migrations, then exits.
3. `demo-accounts`: restores the public demo identities, then exits.
4. `server`: Fastify API and collaboration server.
5. `web`: nginx static site and private reverse proxy.
6. `backup`: periodic PostgreSQL logical dumps.
7. `caddy`: public TLS edge.

`migrate` and `demo-accounts` must exit with code 0. PostgreSQL and the server must become healthy. A successful `docker compose up -d` command alone does not prove any of that.

## Host environment

Create `.env` beside `compose.production.yaml`. Set mode `0600` and never commit it.

| Variable                  | Meaning                                             |
| ------------------------- | --------------------------------------------------- |
| `CHALKBOARD_SITE_ADDRESS` | Hostname served by Caddy                            |
| `PUBLIC_ORIGIN`           | Exact public `https://` origin                      |
| `CHALKBOARD_COMMIT`       | Full commit represented by both application images  |
| `CHALKBOARD_VERSION`      | Application image tag and release version           |
| `DATABASE_URL`            | PostgreSQL URL using the private `postgres` service |
| `POSTGRES_PASSWORD`       | Password matching `DATABASE_URL`                    |
| `AWS_REGION`              | Region used by Amazon SES                           |
| `EMAIL_FROM`              | Sender under a verified SES identity                |

Optional backup settings:

| Variable                  | Default | Meaning                       |
| ------------------------- | ------: | ----------------------------- |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Wait after a successful dump  |
| `BACKUP_RETRY_SECONDS`    |    `60` | Wait after a failed dump      |
| `BACKUP_RETAIN_DAYS`      |    `14` | Retention for completed dumps |

Do not put AWS access keys in `.env`. The server obtains temporary credentials from the EC2 instance role through IMDSv2. The role needs the SES actions used by the application and the managed-node permissions required by Systems Manager.

Validate safely:

```bash
chmod 600 .env
docker compose -f compose.production.yaml config --quiet
```

## Release checklist

A release has four phases:

1. freeze and test the source commit;
2. prove recovery;
3. build and stage the exact images;
4. cut over, verify, and retain rollback material.

Do not combine an unverified reboot with an application cutover.

## 1. Freeze and test the release

1. Finish source, tests, and documentation.
2. Run focused regressions and the complete local gate.
3. Run PostgreSQL integration tests and the complete browser matrix.
4. Run cloud browser tests, container image smoke tests, and dependency audits.
5. Push the intended release commit.
6. Require every CI job to pass on that exact commit.
7. Keep the working tree clean while building images.

Typical local gate:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
TEST_DATABASE_URL=postgresql://... pnpm test:integration
E2E_DATABASE_URL=postgresql://... pnpm test:e2e:cloud
```

## 2. Prove recovery

Before deployment, require both:

- a recent logical dump that has been fully restored into a scratch database;
- a recent completed, encrypted, off-instance EBS snapshot produced by the intended lifecycle policy.

Periodically prove that a policy snapshot can restore, not merely that it exists:

1. create a temporary volume from the snapshot in the instance's Availability Zone;
2. attach only the temporary volume;
3. mount the restored filesystem read-only;
4. copy the PostgreSQL Docker-volume directory into an isolated scratch Docker volume;
5. start the pinned PostgreSQL image without publishing a port;
6. verify readiness, migrations, and representative counts without extracting user content;
7. remove the scratch container and Docker volume;
8. unmount and detach the temporary volume;
9. delete the temporary volume.

Never detach, modify, or mount the production root volume as the restored source. Creating, attaching, or deleting EBS resources requires explicit approval.

A manual snapshot can protect one maintenance operation. It does not prove the lifecycle schedule.

## 3. Build the exact Arm64 images

From the clean repository root:

```bash
version="$(node -p "require('./package.json').version")"
commit="$(git rev-parse HEAD)"
short_commit="${commit:0:12}"

docker build -f apps/server/Dockerfile \
  --build-arg VCS_REF="$commit" \
  --build-arg APP_VERSION="$version" \
  -t "chalkboard-server:$version" .

docker build -f apps/web/Dockerfile \
  --build-arg VCS_REF="$commit" \
  --build-arg APP_VERSION="$version" \
  -t "chalkboard-web:$version" .
```

Verify architecture and revision labels:

```bash
docker image inspect "chalkboard-server:$version" \
  --format '{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}'

docker image inspect "chalkboard-web:$version" \
  --format '{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}'
```

Both must report `arm64` and the full release commit.

Save and checksum the images:

```bash
docker save "chalkboard-server:$version" | \
  gzip > "chalkboard-server-$version-$short_commit.tar.gz"

docker save "chalkboard-web:$version" | \
  gzip > "chalkboard-web-$version-$short_commit.tar.gz"

sha256sum \
  "chalkboard-server-$version-$short_commit.tar.gz" \
  "chalkboard-web-$version-$short_commit.tar.gz"
```

Transfer both archives and stage the next Compose file using strict host-key checking. Use a `.next.yaml` name so the running control file is not replaced early.

## 4. Stage the release without downtime

While the old containers remain live:

1. Validate the staged Compose file with `config --quiet`.
2. Tag the current application images with rollback names containing their commit.
3. Preserve the current Compose file and a mode-`0600` copy of `.env`.
4. Compare transferred archive checksums.
5. Load both images and verify their architecture and revision labels.
6. Restart only the backup worker so it writes immediately.
7. Wait for a new successful backup log entry.
8. Validate that dump with `pg_restore --list`.
9. Fully restore it into a scratch database and inspect migrations and counts.

Existing containers keep using their original image IDs when a tag is replaced.

## 5. Cut over with the public edge closed

The server owns a PostgreSQL advisory lock, so old and new servers cannot overlap. nginx also caches the server container address. Never recreate only the server while leaving the old web container running.

1. Stop Caddy so no request reaches a partially updated stack.
2. Stop `web` and `server`, allowing the full 60-second grace period.
3. Confirm the old server completed its drain.
4. Atomically install the staged Compose file.
5. Update only the commit and version values in `.env`; preserve mode `0600`.
6. Run `docker compose ... config --quiet`.

Run each one-shot job separately and inspect its exit code:

```bash
docker compose -f compose.production.yaml \
  up -d --no-deps --force-recreate migrate
migrate_id="$(docker compose -f compose.production.yaml ps -aq migrate)"
docker wait "$migrate_id"
test "$(docker inspect "$migrate_id" --format '{{.State.ExitCode}}')" = 0

docker compose -f compose.production.yaml \
  up -d --no-deps --force-recreate demo-accounts
seed_id="$(docker compose -f compose.production.yaml ps -aq demo-accounts)"
docker wait "$seed_id"
test "$(docker inspect "$seed_id" --format '{{.State.ExitCode}}')" = 0
```

Then validate the private application:

1. Recreate only `server` with `--no-deps`.
2. Wait for private health and verify diagnostics.
3. Start a temporary second server and confirm the runtime lock rejects it.
4. Stop the target server gracefully and verify drain behavior.
5. Restart it and wait for health again.
6. Recreate `web` with `--no-deps`.
7. From the Compose network, test the SPA, a deep link, API proxy, liveness, private readiness/metrics boundaries, license files, and relative redirects.
8. Start Caddy only after all private checks pass.

The explicit stop/start proves target shutdown behavior without relying on nginx's cached address.

## Verify production

### Service state

```bash
docker compose -f compose.production.yaml ps -a
```

Require:

- `postgres` and `server` healthy;
- `migrate` and `demo-accounts` exited 0;
- `web`, `backup`, and `caddy` running;
- no unexpected restart count or OOM kill.

### Provenance

Check private diagnostics:

```bash
docker compose -f compose.production.yaml exec -T server \
  node -e "fetch('http://127.0.0.1:3000/api/diagnostics').then(r => r.json()).then(console.log)"
```

The version and commit must match `.env` and both image labels.

### Public routes

```bash
curl -fsS https://<host>/api/diagnostics
curl -fsS https://<host>/health/live
curl -fsS -o /dev/null -w '%{http_code}\n' https://<host>/deep/link
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/metrics
curl -fsS https://<host>/licenses/OFL.txt >/dev/null
```

Expected statuses are `200`, `200`, `200`, `404`, `404`, and `200`.

Also verify:

- HTTPS redirects, TLS, security headers, and intended public ports;
- collaboration between two browser sessions and durable acknowledgement;
- account, role, asset, and WebSocket boundaries;
- the SES startup credential probe;
- disk, memory, CPU credits, certificate expiry, logs, and reboot state;
- the backup worker's immediate write and retry behavior.

After SES production access, verify delivery to an address that is not separately verified in SES. Sending test mail requires explicit approval.

### Demo accounts

The current source defines five intentionally public demo accounts in `apps/shared/src/demoAccounts.ts`. The browser dialog and seed job consume that one list.

The seed job restores names and credentials, removes conflicting pending registrations, and revokes old sessions while preserving boards. Account routes prevent identity-field changes. The accounts and all of their boards are public.

While demo accounts are part of a release:

1. require the seed job to report exactly five accounts;
2. sign in with every credential displayed by the browser;
3. verify display-name, email, and password changes are rejected;
4. create and reload a disposable cloud board;
5. collaborate from a second demo identity;
6. never put operator or user data in these accounts.

Removing demo accounts is an application and database migration, not an edit to production data by hand. Remove the shared contract, UI, seed command, Compose job, route locks, tests, and seeded rows together after normal registration is proven.

## Logical backups

The `backup` service stores custom-format `pg_dump` archives in the `postgres-backups` Docker volume. Assets are stored in PostgreSQL, so they are included.

The script:

1. writes to a `.partial` file;
2. verifies it with `pg_restore --list`;
3. atomically renames it;
4. waits the configured interval after success;
5. retries after the configured short delay on failure;
6. removes completed dumps older than the retention period.

Inspect and structurally validate backups:

```bash
docker compose -f compose.production.yaml logs backup

docker compose -f compose.production.yaml exec -T backup sh -c '
  for file in /backups/chalkboard-*.dump; do
    pg_restore --list "$file" >/dev/null || exit 1
    echo "$(basename "$file"): valid"
  done
'
```

These backups share the host's EBS volume with PostgreSQL. They protect against logical errors but not loss of the instance or volume. Keep an independently verified off-instance snapshot policy.

## Scratch-test a logical dump

Structural validation is not a restore test. Copy one completed dump to a temporary host file and restore it into a scratch database without stopping production.

```bash
dump=chalkboard-<timestamp>.dump

docker compose -f compose.production.yaml exec -T backup \
  sh -c "cat '/backups/$dump'" > restore.dump

docker compose -f compose.production.yaml exec -T postgres sh -c '
  dropdb -U "$POSTGRES_USER" --if-exists chalkboard_restore_check
  createdb -U "$POSTGRES_USER" chalkboard_restore_check
'

docker compose -f compose.production.yaml exec -T postgres sh -c '
  pg_restore -U "$POSTGRES_USER" -d chalkboard_restore_check \
    --no-owner --exit-on-error
' < restore.dump

docker compose -f compose.production.yaml exec -T postgres sh -c '
  psql -U "$POSTGRES_USER" -d chalkboard_restore_check \
    -c "SELECT name, applied_at FROM schema_migrations ORDER BY name;"
'
```

Inspect representative counts and metadata without extracting user content. Then clean up:

```bash
docker compose -f compose.production.yaml exec -T postgres sh -c '
  dropdb -U "$POSTGRES_USER" chalkboard_restore_check
'
rm -f restore.dump
```

## Restore production from a logical dump

This operation replaces the production database and discards newer writes. It requires explicit approval and a completed off-instance snapshot first.

1. Stop Caddy.
2. Stop all writers, including `server`, `web`, and `backup`.
3. Copy and structurally validate the selected dump.
4. Preserve rollback controls and images.
5. Replace the database.
6. Verify migrations and representative data before reopening the edge.

```bash
docker compose -f compose.production.yaml stop caddy server web backup

docker compose -f compose.production.yaml exec -T postgres \
  psql -U chalkboard -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'chalkboard';" \
  -c 'DROP DATABASE chalkboard;' \
  -c 'CREATE DATABASE chalkboard OWNER chalkboard;'

docker compose -f compose.production.yaml exec -T postgres \
  pg_restore -U chalkboard -d chalkboard --no-owner --exit-on-error \
  < restore.dump
```

Run migration verification and the required seed job, then privately verify the complete stack before starting Caddy. Remove the temporary dump after success.

## Rollback

Before migration or seeding writes new state, rollback is straightforward:

1. keep Caddy stopped;
2. restore the previous Compose file and `.env`;
3. restore rollback-tagged application images;
4. start and privately verify the old stack;
5. reopen Caddy.

If the new release has written database state that the old application cannot understand, perform a database rollback:

1. keep Caddy stopped;
2. stop server, web, and backup writers;
3. restore the predeployment logical dump;
4. restore previous controls and images;
5. privately verify the old stack;
6. reopen Caddy.

A database rollback discards writes made after cutover. Make the decision immediately during acceptance testing.

## Reboot and host maintenance

Reboot only when required and explicitly approved. A reboot causes downtime.

Before reboot:

1. prove a recent logical restore;
2. confirm a completed encrypted off-instance snapshot;
3. inspect service state, image provenance, disk, and reboot reason;
4. do not combine the reboot with an unverified release.

After reboot, verify the unchanged stack as if it had just been deployed. Docker does not replay Compose dependency health ordering during daemon startup, so inspect every service and confirm the backup worker wrote successfully. Also recheck collaboration, SES credentials, logs, restart counts, OOM state, disk, TLS, and public boundaries.

Do not widen SSH access, weaken IMDSv2, publish internal ports, or reboot as a shortcut for diagnosis.
