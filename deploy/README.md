# Production runbook

This directory contains the production controls:

| File                                        | Purpose                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `compose.production.yaml`                   | Runs PostgreSQL, one-shot jobs, application services, backup worker, and edge proxy                           |
| `Caddyfile`                                 | Terminates TLS and forwards public traffic to the web container                                               |
| `backup.sh`                                 | Creates, verifies, rotates, and retries PostgreSQL logical backups                                            |
| `account-email.yaml`                        | Defines the two retained secrets and the exact runtime read permission                                        |
| `account-email.guard`                       | Enforces focused CloudFormation security and retention invariants                                             |
| `asm-exec`, `asm-exec.sha256`               | Pinned dynamic-reference resolver and checksum                                                                |
| `refresh-application-security.sh`           | Resolves and atomically refreshes application-security material without exposing values                       |
| `materialize-application-security.mjs`      | Validates, fsyncs, atomically activates, and bounds complete private cache releases                           |
| `email-emergency-stop.sh`                   | Disables registration alone or every email-triggering flow                                                    |
| `account-email-operations.md`               | Runs provider setup, materialization, incident response, canary, appeal, and alternate-provider cutover gates |
| `materialize-application-security.test.mjs` | Covers cache creation, no-op refresh, bounded rotation, failure preservation, rollback, and resolver pinning  |
| `account-email-infrastructure.test.mjs`     | Covers template syntax/invariants, least privilege, feedback scope, mounts, and emergency-stop behavior       |

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

The Compose control bounds memory and process counts for every service and applies `no-new-privileges`. Application, nginx, Caddy, migration, seeding, and backup containers have read-only root filesystems, explicit writable volumes or memory-backed temporary paths, and minimal Linux capabilities. Do not remove these controls to work around a startup failure. Reproduce the failure against the release images, identify the exact required path or capability, and make the narrowest reviewed change.

The server performs singleton daily maintenance after UTC rollover. It transactionally removes public demo boards and sessions, expires stale account-action/session rows, removes expired or long-revoked invitations, and permanently deletes boards that have remained in trash for 30 days. A failed transaction rolls back and retries without taking login, local boards, cloud boards, collaboration, health, or backups offline.

## Host environment

Create `.env` beside `compose.production.yaml`. Set mode `0600` and never commit it.

| Variable                     | Meaning                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `CHALKBOARD_SITE_ADDRESS`    | Canonical apex hostname; Caddy redirects its `www` name |
| `PUBLIC_ORIGIN`              | Exact public `https://` origin                          |
| `CHALKBOARD_COMMIT`          | Full commit represented by both application images      |
| `CHALKBOARD_VERSION`         | Application image tag and release version               |
| `DATABASE_URL`               | PostgreSQL URL using the private `postgres` service     |
| `POSTGRES_PASSWORD`          | Password matching `DATABASE_URL`                        |
| `ACCOUNT_REGISTRATION_LIMIT` | Canary verified-account ceiling, at most 250            |
| `EMAIL_DAILY_SEND_LIMIT`     | Canary capacity, at most the hard limit of 100          |
| `EMAIL_FROM`                 | Exact approved `Chalkboard <support@chalkboard.space>`  |
| `EMAIL_MONTHLY_SEND_LIMIT`   | Rolling-month capacity, at most the hard limit of 3,000 |
| `EMAIL_REPLY_TO`             | Exact monitored `support@chalkboard.space` address      |
| `TURNSTILE_SITE_KEY`         | Public browser widget key                               |

Optional backup settings:

| Variable                  | Default | Meaning                       |
| ------------------------- | ------: | ----------------------------- |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Wait after a successful dump  |
| `BACKUP_RETRY_SECONDS`    |    `60` | Wait after a failed dump      |
| `BACKUP_RETAIN_DAYS`      |    `14` | Retention for completed dumps |

Do not put AWS access keys, Turnstile private values, admission HMAC material, codes, or provider credentials in `.env`. The server obtains temporary AWS credentials from the EC2 instance role through IMDSv2. That role needs only the two secret reads used by materialization plus the managed-node permissions required by Systems Manager; it grants no email send permission, because delivery authenticates with a provider API key.

`AWS_REGION`, `EMAIL_CONFIGURATION_SET`, `SES_FEEDBACK_TOPIC_ARN`, and `SNS_CONFIRM_SUBSCRIPTION` are retired. Compose no longer passes them, so a stale entry in `.env` never reaches the server, but remove them anyway so the file does not imply a transport that no longer exists. If any of them does reach the process the parser refuses to start rather than ignoring it.

Email in production needs one complete materialized cache. It holds five values:

- the admission HMAC key, and its positive generation marker;
- the Turnstile validation value;
- the provider API key;
- the provider webhook signing secret.

The server reads these as bounded files from the configured paths, and refuses any that are group- or other-readable or owned by the wrong user.

Nothing else depends on them. If the cache is missing entirely, login, boards, collaboration, health, and backups all stay up. The provider credentials sit in their own failure domain too: lose only those and email delivery fails closed while human verification and board admission carry on.

None of the tracked material contains a value — not the resolver, the checksum, the materializer, the tests, or the read-only server-only mounts.

Use [`account-email-operations.md`](account-email-operations.md) for the approved runtime resolution, rotation, revocation, rollback, outage, canary, and purge procedures. Do not enable an email flow until that cache and the signed webhook path have both been reviewed and tested.

Validate safely:

```bash
chmod 600 .env
docker compose -f compose.production.yaml config --quiet
```

## Transactional email and feedback setup

Read and follow [`account-email-operations.md`](account-email-operations.md) for the complete account-email release sequence. The summary below does not replace its secret, identity, DNS, IAM, incident, canary, or appeal gates.

`account-email.yaml` creates only the two retained Secrets Manager objects and one exact runtime read permission. It creates no SES identity, configuration set, SNS topic, or send permission of any kind: transactional delivery goes to Resend over HTTPS authenticated by an API key. The application verifies every inbound webhook's Svix HMAC-SHA256 signature over the exact raw bytes, rejects a timestamp outside five minutes, stores minimum provider metadata, suppresses permanent bounces and complaints, and disables registration on any complaint.

Creating or updating the stack, changing `.env`, recreating the server, confirming a subscription, sending mail, and enabling a flow are production mutations. Get explicit approval immediately before each operation. The safe order is:

1. validate the template against the target Region with `cfn-lint`, the selected `cfn-guard` rules, and a CloudFormation change set;
2. update the `chalkboard-account-email` stack with the existing instance-role name; its inline policy on `chalkboard-server` stays named `account-email`, and both secrets must remain retained rather than replaced;
3. read the two secret ARN outputs and the approved sender outputs without exposing unrelated account data;
4. have the operator enter `turnstileSecret` into the application-security secret and both `resendApiKey` and `resendWebhookSecret` into the provider secret, through the console only;
5. install `Chalkboard <support@chalkboard.space>` as `EMAIL_FROM`, `support@chalkboard.space` as `EMAIL_REPLY_TO`, and approved private runtime material; during the coordinated cutover publish and verify the provider records for the apex `chalkboard.space`, deploy with every database email-flow switch still disabled, and verify `/api/email-feedback/resend` rejects unsigned input;
6. perform one explicitly approved controlled delivery, prove delivery/bounce/complaint event authentication and idempotency, then enable only the intended canary flow.

Never log a webhook body or signature header, and never expose a signing secret. Keep the registration emergency switch off after a complaint until the event is investigated.

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
4. Run cloud browser tests, both Arm64 container image smoke tests, dependency audits, and CloudFormation validation for `account-email.yaml`.
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

Save the images and every host-side runtime control from the same clean commit
under the project `tmp/` directory:

```bash
release_dir="$PWD/tmp/release-$short_commit"
mkdir -p "$release_dir/controls"

docker save "chalkboard-server:$version" | \
  gzip > "$release_dir/chalkboard-server-$version-$short_commit.tar.gz"

docker save "chalkboard-web:$version" | \
  gzip > "$release_dir/chalkboard-web-$version-$short_commit.tar.gz"

for control in \
  compose.production.yaml Caddyfile backup.sh asm-exec asm-exec.sha256 \
  refresh-application-security.sh materialize-application-security.mjs \
  email-emergency-stop.sh; do
  cp "deploy/$control" "$release_dir/controls/$control"
done
(
  cd "$release_dir"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | \
    xargs -0 sha256sum > SHA256SUMS
  sha256sum --check SHA256SUMS
)
```

Transfer the complete release directory using strict host-key checking into a
new staging directory named for the commit. On the host, verify `SHA256SUMS`
before loading an image or installing a control. Do not copy only the Compose
file: first materialization, rotation, emergency stop, backup, edge, and
rollback all depend on the exact staged controls.

## 4. Stage the release without downtime

While the old containers remain live:

1. Verify the complete staged `SHA256SUMS`. Create a mode-`0600` staged copy of `.env`, preserve every existing value, and change only the release commit/version plus the separately approved non-secret account-registration ceiling, sender, Reply-To, Turnstile site key, and send canary limits. Remove `AWS_REGION`, `EMAIL_CONFIGURATION_SET`, `SES_FEEDBACK_TOPIC_ARN`, and `SNS_CONFIRM_SUBSCRIPTION`; Compose no longer passes them and the parser refuses any that reach the process. Never print either file. Validate the staged Compose file with `--env-file <staged-env> ... config --quiet`; leave the live `.env` untouched.
2. Tag the current application images with rollback names containing their commit.
3. Preserve every currently installed Compose, Caddy, backup, resolver, materialization, and emergency-stop control, plus a mode-`0600` copy of the live `.env`, under the rollback revision.
4. Load both images and verify their architecture and revision labels.
5. Verify the staged resolver against its staged `asm-exec.sha256`. Confirm `asm-exec`, `refresh-application-security.sh`, `email-emergency-stop.sh`, and `backup.sh` are executable before any approved material refresh.
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
4. Install the verified staged Compose, Caddy, backup, resolver, materialization, and emergency-stop controls with their reviewed modes while the edge and writers are stopped. Verify their staged checksums and executable modes again before continuing.
5. Atomically install the already validated staged `.env` with mode `0600`; do not edit or reconstruct secret-bearing configuration during cutover.
6. Confirm the complete materialized cache exists or deliberately accept fail-closed email diagnostics, then run `docker compose ... config --quiet` against the installed controls.

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

### Operational failure evidence

Before diagnosing or changing a failed production boundary, preserve the bounded records from the failure window. Do not recreate a container before preserving its current and previous bounded logs; Docker rotation retains only three 10 MiB files. Never print a raw provider payload, request body, destination, address, code, token, cookie, database URL, confirmation URL, board/user content, or `.env` value.

Correlate one failure with, in order:

1. the browser-displayed validated `x-request-id` when one exists;
2. the server event name and request ID;
3. the stable operational fingerprint, type, safe code/status, bounded summary/stack, nested cause, aggregate members, and cleanup failure;
4. the complete typed provider record, not a hand-selected subset: request shape, attempts/stage, safe correlation IDs, HTTP/header/body/read/cancellation evidence, UTF-8 and declared-length integrity, parsed structure/schema, future-field structure, exact adapter-owned safe scalar facts, private value fingerprints/byte lengths, and explicit observed/omitted/completeness state;
5. provider-specific reconstruction: send certainty, failure class, documented provider error type and attempts made plus accepted-send reconciliation, Turnstile server idempotency/match evidence plus the local browser lifecycle, DNS fallback/sibling/resolver context, or webhook signature/timestamp/payload evidence; and
6. the live source/configuration/policy readback that governed that exact request.

Two things a fingerprint does _not_ tell you, both of which have misled people here:

- **Repeated matching fingerprints are one incident, not several.** A fingerprint proves two retained raw inputs were byte-identical. It says nothing about what those bytes were, and seeing it twice is not independent evidence.
- **A fingerprint is not a substitute for the safe evidence beside it** — correlation IDs, parsed structure, occurrence counts, field inventories, and policy reconstruction.

Stream cancellation is best-effort cleanup and must never delay a request. `requested-unobserved` means cancellation was invoked without awaiting the provider-controlled promise; it is not a report that cancellation succeeded.

**Stop before changing production if the evidence is uncertain in any of these ways:**

- a complete-value flag is false, or UTF-8 is invalid;
- declared and observed lengths disagree;
- an observed or omitted count is nonzero;
- a stream cancellation or read failed, or a cancellation outcome is unobserved;
- a summary or inspection was truncated;
- a request ID is absent, or an arbitrary field is unavailable;
- the classification does not match the request.

In any of those cases, say which uncertainty you hit, and do not make a speculative change. Preserve the live before-state and the rollback material, reproduce the fault in simulation or an isolated test if you can, and change production only once you have modelled the complete request.

Unexpected HTTP failures return a fixed message plus request ID; do not replace it with the underlying server error. Fastify logs only request ID, method, matched route template, status, and duration. Unmatched raw URLs are not retained. Fatal browser recovery stores only a bounded redacted diagnostic/fingerprint in local storage, templates `/boards/:boardId` and `/local/:boardId`, allowlists static routes, and records every other path as `unmatched`.

Turnstile's browser script and widget form their own provider boundary, with their own evidence kept in the browser.

Before reloading a failed form, save only the bounded records under `chalkboard:turnstile-provider-diagnostics`, using developer tools or a local support view. Do not export the whole of local storage.

Those records hold at most 20 entries, and each keeps script and widget stages, actions, attempts, timing, browser state, exact exception character and UTF-8 byte lengths, fixed stack topology, whether a fingerprint covers a complete value or a bounded prefix, and a safe callback code. Reading them back reconstructs only allowlisted fields and discards anything unknown.

They contain no token, site key, widget ID, URL query, raw callback, arbitrary exception prose, or provider-controlled stack frame, and they are never uploaded. Clear the record once the incident is resolved.

Also verify:

- the `www` hostname permanently redirects every path to the canonical apex;
- HTTPS redirects, TLS, security headers, and intended public ports;
- collaboration between two browser sessions and durable acknowledgement;
- account, role, asset, and WebSocket boundaries;
- email flow switches remain in the release's intended disabled/canary state;
- one explicitly approved controlled delivery and authenticated feedback event when email is being enabled;
- disk, memory, CPU credits, certificate expiry, logs, and reboot state;
- the backup worker's immediate write and retry behavior.

Verify delivery to a real external address once the sending domain is verified. Sending test mail requires explicit approval.

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

After reboot, verify the unchanged stack as if it had just been deployed. Docker does not replay Compose dependency health ordering during daemon startup, so inspect every service and confirm the backup worker wrote successfully. Also recheck collaboration, materialized provider credentials, logs, restart counts, OOM state, disk, TLS, and public boundaries.

Do not widen SSH access, weaken IMDSv2, publish internal ports, or reboot as a shortcut for diagnosis.
