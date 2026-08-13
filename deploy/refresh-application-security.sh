#!/bin/sh
# Resolves the retained application-security secret only inside asm-exec, then
# atomically refreshes the root-owned cache consumed by the server container.
set -eu
set +x
umask 077

usage() {
  printf '%s\n' \
    'Usage: refresh-application-security.sh SECRET_ARN REGION CACHE_DIR GENERATION RUNTIME_UID RUNTIME_GID' >&2
  exit 2
}

[ "$#" -eq 6 ] || usage
secret_arn=$1
region=$2
cache_dir=$3
generation=$4
runtime_uid=$5
runtime_gid=$6

case "$secret_arn" in
  arn:aws*:secretsmanager:"$region":*:secret:*) ;;
  *)
    printf '%s\n' 'Application security secret must be a full ARN in the selected Region.' >&2
    exit 2
    ;;
esac
case "$region" in
  ''|*[!a-z0-9-]*) usage ;;
esac
case "$cache_dir" in
  /*) ;;
  *)
    printf '%s\n' 'Application security cache directory must be absolute.' >&2
    exit 2
    ;;
esac
case "$generation:$runtime_uid:$runtime_gid" in
  *[!0-9:]*) usage ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
(
  cd "$script_dir"
  sha256sum --check --status asm-exec.sha256
) || {
  printf '%s\n' 'Pinned asm-exec checksum verification failed.' >&2
  exit 1
}

admission_reference="{{resolve:secretsmanager:${secret_arn}:SecretString:admissionHmacKey:AWSCURRENT}}"
turnstile_reference="{{resolve:secretsmanager:${secret_arn}:SecretString:turnstileSecret:AWSCURRENT}}"

# A minimal environment prevents unrelated host values from reaching either the
# resolver or materializer. Resolved values exist only in asm-exec and its child.
env -i \
  AWS_REGION="$region" \
  HOME="${HOME:-/root}" \
  PATH="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
  CHALKBOARD_MATERIALIZED_ADMISSION_HMAC_KEY="$admission_reference" \
  CHALKBOARD_MATERIALIZED_TURNSTILE_SECRET="$turnstile_reference" \
  "$script_dir/asm-exec" -- \
  node "$script_dir/materialize-application-security.mjs" \
    --cache-dir "$cache_dir" \
    --generation "$generation" \
    --runtime-uid "$runtime_uid" \
    --runtime-gid "$runtime_gid"
