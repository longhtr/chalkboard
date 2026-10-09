#!/bin/sh
# Periodic logical backup of the Chalkboard database.
#
# `board_assets` stores uploaded images in PostgreSQL rather than in object
# storage, so one dump captures every board, account, and image in the system.
#
# This protects against deletion, corruption, and a bad migration. It does NOT
# protect against losing the volume, because the dumps land on that same disk.
# Volume loss is covered by EBS snapshots, which back up the disk itself.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_RETRY_SECONDS="${BACKUP_RETRY_SECONDS:-60}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"

log() {
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup: $*"
}

take_backup() {
  timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  final="${BACKUP_DIR}/chalkboard-${timestamp}.dump"
  # Dump to a partial name and rename only on success, so an interrupted run
  # never leaves a truncated file that looks like a usable backup.
  partial="${final}.partial"

  if ! pg_dump --format=custom --file="$partial" "$DATABASE_URL"; then
    log "FAILED: pg_dump did not complete"
    rm -f "$partial"
    return 1
  fi

  # Reading the archive's table of contents proves the file is a complete,
  # parseable dump rather than a plausible-looking truncation.
  if ! pg_restore --list "$partial" >/dev/null 2>&1; then
    log "FAILED: dump did not verify"
    rm -f "$partial"
    return 1
  fi

  mv "$partial" "$final"
  log "wrote $(basename "$final") ($(wc -c <"$final") bytes)"

  # Prune only verified backups; a partial file is removed by the run that
  # created it, never by retention.
  deleted="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'chalkboard-*.dump' \
    -mtime "+${BACKUP_RETAIN_DAYS}" -print -delete | wc -l)"
  if [ "$deleted" -gt 0 ]; then
    log "pruned ${deleted} backup(s) older than ${BACKUP_RETAIN_DAYS} days"
  fi
}

if [ "${DATABASE_URL:-}" = '' ]; then
  log 'FATAL: DATABASE_URL is not set'
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Only one backup process runs, and it removes its own partial file on failure.
# Any partial present at startup was therefore abandoned by a killed container,
# and retention will never reclaim it because that matches completed dumps only.
abandoned="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.partial' -print -delete | wc -l)"
if [ "$abandoned" -gt 0 ]; then
  log "removed ${abandoned} abandoned partial backup(s) from a previous run"
fi

log "starting: every ${BACKUP_INTERVAL_SECONDS}s, retrying failures after ${BACKUP_RETRY_SECONDS}s, retaining ${BACKUP_RETAIN_DAYS} days"

# One backup immediately, so a fresh deployment is protected within seconds
# rather than after the first full interval. Docker does not reapply Compose's
# dependency conditions when the daemon restarts, so PostgreSQL can still be
# starting at this point; retry that failure promptly instead of waiting a day.
while true; do
  if take_backup; then
    sleep "$BACKUP_INTERVAL_SECONDS"
  else
    log "retrying after a failed backup in ${BACKUP_RETRY_SECONDS}s"
    sleep "$BACKUP_RETRY_SECONDS"
  fi
done
