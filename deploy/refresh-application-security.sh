#!/bin/sh
# Resolves the retained application-security and email-provider secrets only
# inside asm-exec, then atomically refreshes the root-owned cache consumed by
# the server container.
set -eu
set +x
umask 077

usage() {
  printf '%s\n' \
    'Usage: refresh-application-security.sh SECRET_ARN PROVIDER_SECRET_ARN REGION CACHE_DIR GENERATION RUNTIME_UID RUNTIME_GID' >&2
  exit 2
}

[ "$#" -eq 7 ] || usage
secret_arn=$1
provider_secret_arn=$2
region=$3
cache_dir=$4
generation=$5
runtime_uid=$6
runtime_gid=$7

case "$secret_arn" in
  arn:aws*:secretsmanager:"$region":*:secret:*) ;;
  *)
    printf '%s\n' 'Application security secret must be a full ARN in the selected Region.' >&2
    exit 2
    ;;
esac
case "$provider_secret_arn" in
  arn:aws*:secretsmanager:"$region":*:secret:*) ;;
  *)
    printf '%s\n' 'Email provider secret must be a full ARN in the selected Region.' >&2
    exit 2
    ;;
esac
if [ "$secret_arn" = "$provider_secret_arn" ]; then
  printf '%s\n' 'Application security and email provider secrets must be distinct.' >&2
  exit 2
fi
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
resend_api_key_reference="{{resolve:secretsmanager:${provider_secret_arn}:SecretString:resendApiKey:AWSCURRENT}}"
resend_webhook_reference="{{resolve:secretsmanager:${provider_secret_arn}:SecretString:resendWebhookSecret:AWSCURRENT}}"

# A minimal environment prevents unrelated host values from reaching either the
# resolver or materializer. Resolved values exist only in asm-exec and its child.
env -i \
  AWS_REGION="$region" \
  HOME="${HOME:-/root}" \
  PATH="${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
  CHALKBOARD_MATERIALIZED_ADMISSION_HMAC_KEY="$admission_reference" \
  CHALKBOARD_MATERIALIZED_TURNSTILE_SECRET="$turnstile_reference" \
  CHALKBOARD_MATERIALIZED_RESEND_API_KEY="$resend_api_key_reference" \
  CHALKBOARD_MATERIALIZED_RESEND_WEBHOOK_SECRET="$resend_webhook_reference" \
  "$script_dir/asm-exec" -- \
  node "$script_dir/materialize-application-security.mjs" \
    --cache-dir "$cache_dir" \
    --generation "$generation" \
    --runtime-uid "$runtime_uid" \
    --runtime-gid "$runtime_gid"
