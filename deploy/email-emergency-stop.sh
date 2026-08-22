#!/bin/sh
# Disables registration alone or every email-triggering flow. This is a
# production database mutation and must be run only after immediate approval.
set -eu
set +x

usage() {
  printf '%s\n' \
    'Usage: email-emergency-stop.sh COMPOSE_FILE registration|all REASON' >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
compose_file=$1
scope=$2
reason=$3

[ -f "$compose_file" ] || {
  printf '%s\n' 'Compose file does not exist.' >&2
  exit 2
}
case "$scope" in
  registration|all) ;;
  *) usage ;;
esac
case "$reason" in
  ''|*[!a-z0-9-]*)
    printf '%s\n' 'Reason must contain only lowercase letters, numbers, and hyphens.' >&2
    exit 2
    ;;
esac
[ "${#reason}" -le 80 ] || {
  printf '%s\n' 'Reason must be at most 80 characters.' >&2
  exit 2
}

if [ "$scope" = registration ]; then
  predicate="flow = 'registration'"
  expected_rows=1
else
  predicate="flow IN ('registration', 'password-reset', 'email-change')"
  expected_rows=3
fi

result=$(
  docker compose -f "$compose_file" exec -T postgres sh -c '
    psql -X -v ON_ERROR_STOP=1 \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -At -v expected_rows="$1" -v stop_reason="$2" <<SQL
WITH stopped AS (
  UPDATE email_flow_switches
  SET enabled = FALSE, reason = :'\''stop_reason'\'', updated_at = NOW()
  WHERE $3
  RETURNING flow
)
SELECT CASE
  WHEN count(*) = :expected_rows THEN '\''approved-email-emergency-stop-applied'\''
  ELSE ('\''unexpected-email-flow-row-count:'\'' || count(*))::integer::text
END
FROM stopped;
SQL
  ' sh "$expected_rows" "$reason" "$predicate"
)

[ "$result" = approved-email-emergency-stop-applied ] || {
  printf '%s\n' "$result" >&2
  exit 1
}
printf '%s\n' 'Approved email emergency stop was applied.'
