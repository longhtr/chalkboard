# Production stack

`compose.production.yaml` runs the whole application on one host: Caddy for TLS,
the web image for the compiled application, the server, PostgreSQL, and a backup
service that dumps the database on an interval. Only Caddy publishes ports.

Every value comes from the environment, so this directory holds no hostname,
address, or secret. Create `.env` beside this file on the host — it is
gitignored and must never be committed.

| Variable                  | Meaning                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `CHALKBOARD_SITE_ADDRESS` | Public hostname Caddy serves and requests a certificate for |
| `PUBLIC_ORIGIN`           | The same host as an `https://` origin, no trailing slash    |
| `CHALKBOARD_COMMIT`       | 40-character commit SHA the images were built from          |
| `CHALKBOARD_VERSION`      | Image tag, e.g. `0.1.0`                                     |
| `DATABASE_URL`            | `postgresql://user:password@postgres:5432/chalkboard`       |
| `POSTGRES_PASSWORD`       | Must match `DATABASE_URL`                                   |
| `AWS_REGION`              | SES region                                                  |
| `EMAIL_FROM`              | Verified SES sender identity                                |

Backups have defaults and need no configuration.

| Variable                  | Meaning                                 | Default |
| ------------------------- | --------------------------------------- | ------- |
| `BACKUP_INTERVAL_SECONDS` | Seconds between dumps                   | `86400` |
| `BACKUP_RETAIN_DAYS`      | Age at which a completed dump is pruned | `14`    |

There is deliberately no AWS key or secret. The server reads credentials from
the instance role through the metadata service, so the host needs a role
granting `ses:SendEmail` and `ses:GetAccount`.

## Deploying

Build both images from the commit being deployed, load them on the host, then:

```bash
docker compose -f compose.production.yaml up -d
```

`migrate` runs to completion first, the server waits for it, and nginx waits for
the server to answer — it resolves `server` once at startup and exits if the
name is missing.

## Updating

The server takes a PostgreSQL advisory lock, so two instances cannot overlap and
a rolling replacement will fail. Stop before starting:

```bash
docker compose -f compose.production.yaml stop server web
# load the new images
docker compose -f compose.production.yaml up -d
```

Brief downtime is unavoidable and expected. Allow the stop to take its full
grace period: the server drains connections and flushes collaboration state, and
`stop_grace_period` is deliberately longer than `SHUTDOWN_TIMEOUT_MS`.

## Backups

The `backup` service dumps the database on an interval. Because `board_assets`
stores uploaded images in PostgreSQL, one dump holds every board, account, and
image — there is no second store to capture separately.

Each dump is written under a `.partial` name and renamed only after `pg_restore
--list` reads its table of contents, so an interrupted run cannot leave a
truncated file that looks usable. A failed dump is logged and the loop
continues; the service does not exit on a database it cannot reach.

```bash
docker compose -f compose.production.yaml logs backup
docker compose -f compose.production.yaml exec backup ls -la /backups
```

**These dumps live on the same volume as the data they protect.** They cover
deletion, corruption, and a bad migration. They do not survive losing the
volume, which is what EBS snapshots are for. Both are necessary.

### Restoring

Stop the server first — restoring under a live server races its writes, and the
advisory lock does not protect against that.

```bash
docker compose -f compose.production.yaml stop server web

# Copy the chosen dump out of the backup volume.
docker compose -f compose.production.yaml exec backup \
  ls -1 /backups                       # pick a timestamp
docker compose -f compose.production.yaml exec backup \
  cat /backups/chalkboard-<timestamp>.dump > restore.dump

# Restore into an empty database, then start the stack again.
docker compose -f compose.production.yaml exec -T postgres \
  psql -U chalkboard -d postgres \
  -c 'DROP DATABASE chalkboard;' -c 'CREATE DATABASE chalkboard;'
docker compose -f compose.production.yaml exec -T postgres \
  pg_restore --dbname="$DATABASE_URL" --no-owner < restore.dump

docker compose -f compose.production.yaml up -d
```

A backup nobody has restored from is a guess. Do this once against a scratch
database before you need it for real.

## Checking

```bash
docker compose -f compose.production.yaml exec server \
  node -e "fetch('http://127.0.0.1:3000/api/diagnostics').then(r=>r.json()).then(console.log)"
```

The reported commit must match what was built. `docker compose logs server`
shows whether the SES credential probe succeeded; a failure there is logged and
tolerated, but it means verification emails will not send.
