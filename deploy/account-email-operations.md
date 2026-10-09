# Account-email operations

This runbook owns application-security materialization, emergency stops, email-provider staging, credential recovery, canary admission, and the SES purge. Read `deploy/README.md` first. Every production, AWS, IAM, secret, DNS, provider, webhook, controlled-message, database-switch, push, and deployment mutation requires immediate operator approval.

No command in this document retrieves or prints a secret. The operator enters private provider values directly through the approved Secrets Manager console workflow. The agent must never receive, retrieve, transform, validate, or paste those values.

## Tracked controls

| Control                                | Responsibility                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `account-email.yaml`                   | The two retained secrets and the exact runtime read permission, with no send permission of any kind                  |
| `account-email.guard`                  | Focused retained-secret, operator-entered-provider-secret, least-privilege, and no-provider-resource invariants      |
| `asm-exec` and `asm-exec.sha256`       | Pinned runtime-only dynamic-reference resolver and its tracked checksum                                              |
| `refresh-application-security.sh`      | Minimal-environment `asm-exec` invocation using four `{{resolve:secretsmanager:...}}` references across two secrets  |
| `materialize-application-security.mjs` | Strict validation, fsync, complete-release staging, atomic activation, and one retained rollback release             |
| `email-emergency-stop.sh`              | One-way database control that disables registration or every email-triggering flow                                   |
| `compose.production.yaml`              | Read-only mounts of the five materialized files into only the non-root server container                              |
| `*.test.mjs`                           | Resolver pin, template, mount, no-op, atomicity, partial-failure, rotation, rollback, and emergency-stop regressions |

## Non-negotiable state

- Registration, password-reset initiation, and email-change initiation are separate database switches.
- Migration `0007_email_security.sql` creates all three switches disabled with reason `awaiting-account-email-canary`.
- The initial verified-account limit is 10. The database trigger never permits a configured limit above 250.
- Production Compose defaults to 10 provider sends per rolling day and 100 per rolling 30 days. Runtime validation never permits more than 100 and 3,000, which match the provider free plan’s monthly allowance.
- Login, sessions, local boards, cloud boards, collaboration, account deletion, health, PostgreSQL, and backups remain available when email material or a provider is unavailable.
- Delivery authenticates with a provider API key read from a mounted file. The instance role holds no send permission of any kind, and never a static AWS access key.
- The durable send-intent UUID is the provider idempotency key. The adapter makes at most two HTTP attempts and retries only an ambiguous transport failure; an explicit refusal is never retried and no manual resend is ever authorized for an ambiguous outcome.
- Open and click tracking stay disabled at the provider. An engagement event must never appear.
- Do not enable an email flow before exact-SHA deployment acceptance, proven webhook refusal behavior, and current recovery evidence.

## Local validation before any change set

The release gate runs:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:e2e:cloud
cfn-lint --format json --regions ap-southeast-1 \
  --template deploy/account-email.yaml
cfn-guard validate \
  --rules deploy/account-email.guard \
  --data deploy/account-email.yaml \
  --output-format json
docker compose -f deploy/compose.production.yaml config --quiet
```

The runtime policy no longer grants any service action beyond reading two secrets, so there is no send permission to generate or review. Confirm by reading the template that its only action is `secretsmanager:GetSecretValue` against exactly `ApplicationSecuritySecret` and `EmailProviderSecret`.

CloudFormation service validation and a reviewed change set happen only after exact-SHA CI and immediate approval. The change set must not replace EC2, networking, EBS, DLM, the existing instance role, or either retained secret.

## Provider and infrastructure preparation

This sequence prepares external dependencies for the one coordinated deployment. It does not require early host staging: keep the production host untouched until the non-secret stack outputs, approved addresses, and Turnstile site key are known.

1. Confirm credits currently cover Secrets Manager and transfer usage. Confirm that Resend, Turnstile, and the human-support mailbox remain on their approved free plans with no trial conversion or paid upgrade. Stop if an out-of-pocket charge could occur.
2. The approved email values are `Chalkboard <support@chalkboard.space>` for `EMAIL_FROM` and `support@chalkboard.space` for `EMAIL_REPLY_TO`. The verified sending domain is the apex `chalkboard.space`. The provider requires the From address to sit on the verified domain, so verifying a subdomain would change the approved sender; the approved sender is fixed, and the domain follows from it rather than the other way round. Zoho receives human correspondence and replies at the same visible address but is never the automated account-message transport. The configuration parser also rejects `noreply` and `no-reply` senders. The approved Turnstile widget is named `Chalkboard account security`, uses Managed mode, and is restricted to the exact `chalkboard.space` hostname. Initial canary values remain 10 verified normal accounts, 10 provider sends per rolling day, and 100 per rolling month; every email flow remains disabled during deployment.
3. The operator creates one Turnstile managed widget restricted to the exact `chalkboard.space` hostname. The application supplies and verifies only the `registration` and `password-reset` actions. Only the public site key enters ordinary deployment configuration.
4. Create a CloudFormation change set from `account-email.yaml` for the exact stack name `chalkboard-account-email` with `CAPABILITY_IAM`. Its inline policy on `chalkboard-server` must be named `account-email`. Wait for terminal status, retrieve pre-deployment validation with `cloudformation describe-events` against the exact change-set ARN, and review every resource and policy statement. The change set must remove every SES and SNS resource and leave both retained secrets in place: `ApplicationSecuritySecret` and `EmailProviderSecret` both carry `DeletionPolicy: Retain`, so confirm in the change set that neither is scheduled for replacement or deletion. Ask immediately before executing it, and clean up an abandoned change set with separate approval.
5. The stack generates only `admissionHmacKey`. Through the approved console interface, the operator preserves that generated field and adds `turnstileSecret` directly to the application-security secret. `EmailProviderSecret` is created with no value at all: the operator adds `resendApiKey` and `resendWebhookSecret` to it directly. Never copy any of these fields through chat, shell history, `.env`, source, logs, or a change-set parameter. Until both provider fields exist, materialization fails and every email flow stays closed, which is the intended signal.
6. In the Resend console the operator adds the apex `chalkboard.space` sending domain, creates one sending API key with permission to send only, and creates one webhook endpoint at `https://chalkboard.space/api/email-feedback/resend` subscribed to exactly `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, and `email.failed`. Click tracking is **enabled by default** in the provider's add-domain form and must be turned off; open tracking defaults to off. Confirm both are off in the domain settings after creation, because the add-domain form may not allow changing them. Click tracking rewrites every link in the body and routes it through a tracking domain, which has no place in an account-security message. The endpoint signing secret is the `resendWebhookSecret` value. The application refuses any webhook whose signature does not verify, whose timestamp is outside five minutes, or whose signed headers are repeated, so the endpoint may exist before the application is deployed without weakening anything.
7. Prepare, but do not yet publish, one exact authoritative-DNS change plan containing:
   - the exact records the Resend console specifies. Expect a DKIM record under its own selector, which cannot collide with the three existing SES DKIM records, and return-path records the provider places under a `send` subdomain. Those envelope records are the provider's own and do not change the From address. If the console instead asks for a change to the apex SPF TXT, treat it as the shared-record hazard below rather than a routine addition;
   - a `www` CNAME to the canonical apex without changing the apex A record;
   - the exact Zoho Free MX records approved in the operator console;
   - the exact Zoho DKIM record while preserving the existing Zoho domain-verification record; and
   - the apex SPF TXT record is **not** changed when the provider is added. The provider scopes its own SPF to its return-path subdomain, so apex verification needs no include at the apex. The record is edited only once, at the purge, to drop the SES include. It is a single merged string shared with Zoho: **edit it in place; never delete it and never add a second SPF record.** Deleting it breaks the human support mailbox, and two SPF records make the domain fail SPF outright.
     Preserve DMARC unless a complete legitimate-sender review authorizes a policy change.
8. Simulate and read back the stack-managed runtime policy. It must grant only `secretsmanager:GetSecretValue`, on exactly the two retained secrets, through exactly two statements with no condition. There must be no `ses:SendEmail`, no `ses:GetAccount`, no wildcard resource, and no send permission of any kind: delivery authenticates with a provider API key, not an IAM principal. Keep the previous broad `ses-send` inline policy attached while the old production server is running; remove it only during the edge-closed cutover after the replacement server passes private checks, then recheck the exact policy and Systems Manager before reopening the edge.
9. Do not enable any email flow until the webhook endpoint has been proven to reject an unsigned request against the deployed application.

## Host release staging

After provider preparation supplies every non-secret deployment value, stage the release without downtime by following `deploy/README.md`:

1. Reconfirm that local and remote `main`, the successful exact-SHA CI run, both Arm64 image labels, the complete release archive, and every staged control represent one commit.
2. Transfer the complete release directory to a new commit-named host directory and verify `SHA256SUMS` there before loading or installing anything.
3. Prepare and validate the mode-`0600` staged `.env` with only the approved release, canary, From, Reply-To, and Turnstile public values. Remove `AWS_REGION`, `EMAIL_CONFIGURATION_SET`, `SES_FEEDBACK_TOPIC_ARN`, and `SNS_CONFIRM_SUBSCRIPTION`. Compose no longer passes them so a stale entry cannot reach the server, but the file should not imply a transport that no longer exists; the parser refuses any that do reach the process. Leave the live `.env` untouched.
4. Preserve rollback images, controls, and the live `.env`; load and inspect the release images; verify executable modes and the resolver checksum; restart only the backup worker; and require a new structurally valid, fully scratch-restored logical dump.

Staging is not deployment. Do not replace a live control, environment file, image used by a running container, or application service during this section.

## Materializing private runtime files

The tracked resolver is checksum-pinned. Do not replace `deploy/asm-exec` without reviewing the entire replacement, updating `asm-exec.sha256`, and rerunning all materializer tests.

Before first refresh, verify the server image runtime identity rather than assuming it:

```bash
runtime_identity=$(docker run --rm --entrypoint node \
  "chalkboard-server:${CHALKBOARD_VERSION}" \
  -p '`${process.getuid()}:${process.getgid()}`')
runtime_uid=${runtime_identity%:*}
runtime_gid=${runtime_identity#*:}
```

The backticks above are JavaScript template delimiters passed literally to Node. Do not substitute a shell command into them.

Use only the two non-secret stack output ARNs and a positive HMAC generation number. The two ARNs must be different; the wrapper refuses them if they match, because one ARN supplied twice would silently resolve the provider keys from the wrong secret. On the production host, run the resolver from the verified exact-SHA staging directory and write the cache where the production Compose file mounts it. Set `staged_control_dir` explicitly to that reviewed directory; do not source `.env` to obtain it:

```bash
cd /home/ubuntu/chalkboard
staged_control_dir="$PWD/staging-<short-commit>/controls"
test -x "$staged_control_dir/refresh-application-security.sh"
test -f "$staged_control_dir/materialize-application-security.mjs"

sudo "$staged_control_dir/refresh-application-security.sh" \
  "$APPLICATION_SECURITY_SECRET_ARN" \
  "$EMAIL_PROVIDER_SECRET_ARN" \
  "$AWS_REGION" \
  "$PWD/runtime/application-security" \
  1 \
  "$runtime_uid" \
  "$runtime_gid"
```

The wrapper:

1. disables shell tracing;
2. verifies the pinned resolver checksum;
3. starts from a minimal environment;
4. passes dynamic references to `asm-exec`;
5. validates every resolved value before writing;
6. stages all five files in a new owner-only release;
7. fsyncs files and directories;
8. atomically changes `current` only after the complete release is durable; and
9. prints status only, never values.

The cache root is owned by root with mode `0700`. Material files are owned by the verified container runtime UID/GID with no group/other permissions. Compose mounts the exact files read-only into only `/run/secrets` in the server. A refresh takes effect only after the stopped server and web are recreated under the single-server procedure.

An identical refresh is a no-op. A validation, resolution, permission, or partial-write failure leaves `current` and the running service unchanged. Before a new rotation is staged, inactive stale releases are removed; after activation, only `current` and its one root-only predecessor remain for reviewed rollback.

## Missing material and first-start behavior

If no complete cache exists, Docker may create empty source directories for the three file mounts. The server rejects them as unsafe material, starts its core features, reports material as unavailable in diagnostics, and makes all email-triggering workflows fail closed. Do not weaken file checks or place values in environment variables to bypass this state.

After a successful first refresh, verify the release metadata and file ownership without printing material, but do not recreate a live service yet. Continue into the coordinated cutover below so the old and new collaboration servers never overlap.

## Coordinated deployment and DNS activation

This is the single coordinated account-email application deployment. Obtain immediate deployment approval and follow the complete edge-closed procedure in `deploy/README.md`.

1. Stop Caddy, then stop the old web and server with the full drain period. Install only checksum-verified staged controls and the already validated staged `.env`; run migrations and demo seeding once; start the replacement server and web without opening the edge.
2. Require private health, exact-SHA diagnostics, second-server lock refusal, graceful drain/restart, SPA/API/license boundaries, and these email diagnostics: `material=materialized`, `humanVerification=turnstile`, `delivery=resend`, and the intended database flow states. Require unsigned feedback to return 400 and core account/board/asset/collaboration/deletion/backup behavior to remain healthy.
3. While the edge remains closed and the replacement has passed private checks, apply the previously reviewed DNS plan after immediate approval. Query the authoritative name servers directly and require the exact provider records, the Zoho records, a single apex SPF record that still authorizes both Zoho and the provider, a safe DMARC record, and the `www` record. Confirm in the provider console that the sending domain reports verified. The existing SES records stay in place for now and are removed only during the purge. If DNS or provider state is incomplete, keep every email flow off and either correct it or roll back before reopening the edge.
4. While the edge remains closed, remove the old broad `ses-send` inline policy after immediate approval. Simulate and read back the remaining permissions, require no runtime SES grant of any kind and no wildcard resource, and verify Systems Manager remains online. Never remove this policy earlier while the old server is still the production runtime.
5. Start Caddy only after the application, DNS authoritative readback, exact runtime policy, Systems Manager, and rollback path all pass. Verify the public policies now truthfully disclose Zoho before relying on the new MX path; verify the `www` redirect, TLS, security headers, public routes, diagnostics, and private readiness/metrics boundaries.
6. Wait for public DNS and the provider console to show `chalkboard.space` verified, including its DKIM and return-path records. A pending state is not success. Verify the application is configured to send as `Chalkboard <support@chalkboard.space>` with replies directed to the same monitored Zoho mailbox. Verify Zoho receives and can reply through `support@chalkboard.space` only with separately approved, content-free operator test messages.

Rollback needs care here: a release earlier than the cutover still expects the SES settings this release refuses to accept. Rolling back therefore means restoring that release's `.env` alongside its images. Keep all email-triggering flows unavailable until the rollback sender and its permissions are explicitly reconciled, and never restore wildcard SES access merely to make a rollback send email.

## Webhook endpoint ownership

The provider webhook needs no confirmation handshake: it authenticates every request with the endpoint signing secret. Ownership is proven by demonstrating refusal rather than by accepting a challenge.

1. After the edge reopens, verify from outside that `POST https://chalkboard.space/api/email-feedback/resend` with no signature headers returns `400` and processes nothing.
2. Verify that a request carrying a valid body but a signature computed under a different secret also returns `400`.
3. Verify that a correctly signed request whose timestamp is older than five minutes returns `400`, so a captured body cannot be replayed later.
4. Confirm in the provider console that the endpoint is subscribed to exactly the six delivery events and that open and click tracking remain disabled.
5. Never log or retain a signature header, signing secret, or webhook body.

## Provider failure evidence and diagnosis

Evidence preservation is the first gate before any correction. Do not recreate a container before preserving its current and previous bounded logs from the exact failure window. Do not send again, change IAM, alter DNS, rotate material, or change an email-flow switch merely to obtain clearer evidence.

“Lossless” here means losing no root-cause information, after the privacy and security rules below have been applied. It does not mean keeping the raw payload.

What to preserve:

- Exact safe scalar facts owned by the adapter, and the correlations between them.
- For every private value: full SHA-256, byte length, value kind, classification, and completeness.
- For fields a provider may add later: bounded structure, field identities or name fingerprints, and observed/omitted counts.

How to keep it straight:

- Keep raw-body correlation separate from parsed JSON/XML/PEM structure, HTTP metadata, nested transport evidence, and cancellation or read state.
- Record UTF-8 validity, and whether the declared and observed byte lengths agree.
- Before keeping any nominally safe header, reason, URL, provider code or type, service, or X.509 name or serial, run it through a strict grammar first. If it does not pass, keep only the private fingerprint and length.
- Capture mutable error properties once, so the fingerprints, lengths, and topology all describe the same snapshot.

Never claim something is complete when it was not. That applies to a stream, an inspection prefix, a field list, a header list, a schema-issue list, an XML code or request-ID inventory, a stack/cause/aggregate inspection, or a parser — if any of them was truncated, unavailable, invalid, or omitted, say so.

This transformation is what the architecture guide calls an information-preserving transformation.

For every send failure preserve the complete `accountEmailDeliveryFailure` record before any retry, container recreation, IAM change, or DNS change:

- application purpose, certainty, failure class, stable classified error name, and the provider's own documented error type when it matched a known value;
- HTTP status and client/server fault;
- the exact non-private request facts: `resend:SendEmail`, one destination, configured From match, one Reply-To, simple HTML/text content, attempts made against the two-attempt maximum, the idempotency window, and timeout;
- the provider refusal message as fingerprint and UTF-8 byte length only, never as prose, because refusal text can quote the recipient address;
- response field names; and
- the server request ID when a synchronous route owns one.

Certainty is the field that decides what to do next. `rejected` means the provider stated a refusal and no message was accepted, so the pending code was cancelled. `ambiguous` means acceptance is unknown: the pending code and its reservation are deliberately kept, no new intent is created, and the send is never repeated outside the adapter's own single idempotent retry. Never convert an ambiguous outcome into a manual resend.

An accepted response also has an `acceptanceDiagnostic`: private message-ID fingerprint/length, response field names, and request shape. If database bookkeeping fails, preserve the complete `accountEmailBookkeepingFailure` record. That is the evidence needed to reconcile an accepted provider send without logging or replaying its message ID.

The transformed summary must never retain a destination, provider message ID, API key, webhook signing secret, message body, verification code, password, Turnstile token/secret/site key/widget ID, session/cookie, intent/destination digest, or raw provider response. A SHA-256 fingerprint supports equality and correlation only.

For server-side Turnstile, preserve:

- the endpoint and method, the action, the attempt number, the exact idempotency UUID, the maximum-attempt policy, and the timeout;
- fingerprints of the private token and the expected host, plus the expected and actual match booleans;
- the category and status, every error-code classification, and private value diagnostics;
- every response field, and any future field, as safe structure or private fingerprints, along with schema issues;
- HTTP headers, status, and private reason; and the private body's fingerprint, length, UTF-8 validity, and read/cancellation completeness.

Retry rules, which matter more than they look:

- One interrupted network operation may be retried once, and only with the same idempotency UUID.
- Stream cancellation is requested at most once, as best-effort cleanup, and is never awaited. `requested-unobserved` is explicit evidence of that, not a success.
- Never retry an explicit HTTP, malformed, invalid-UTF-8, oversized, schema-invalid, mismatch, stale, declined, or provider-callback outcome.

The browser keeps its own record of Turnstile, separate from the server's: at most 20 local-only lifecycle records under `chalkboard:turnstile-provider-diagnostics`. Preserve them before reloading when you are diagnosing script load or error, a 10-second timeout, a missing API, a render or removal failure, an invalid token callback, a provider error or timeout, expiry, or completion ordering.

Each provider exception is captured once. A record keeps the exact message and stack character and UTF-8 byte lengths, fixed frame-count and topology placeholders, and a SHA-256 marked explicitly as either complete-value or bounded-prefix coverage. On the way back in, the reader rebuilds only allowlisted fields and discards anything malformed or unknown.

These records are never uploaded, and contain no token, site key, widget ID, URL query, raw callback value, arbitrary exception prose, or provider-controlled stack frame. Clear them once the incident is resolved, rather than copying browser storage wholesale.

For DNS preserve private query-name and error-hostname fingerprints/lengths, lookup type, initial-MX versus fallback context, sibling A/AAAA outcome, resolver implementation/configured timeout/tries, elapsed time, source (`resolver` or `application-timeout`), code/errno/syscall, root field inventory/future-field structure, and nested operational fingerprint/code/stack/cause topology. Never retain the address, domain, MX exchange, or returned IP. Expected negative answers are not outages; partial family degradation is recorded even when another family remains deliverable.

For the webhook, preserve the complete typed `resendFeedbackFailure` or ignored-event diagnostic. That covers signed-header presence and repetition, timestamp skew against the enforced tolerance, observed and malformed signature entry counts with the offered versions, payload schema issues and their counts, and the names of any unexpected top-level fields.

No value from a verified payload is ever kept, because the payload carries the plaintext recipient and subject.

The status code carries meaning here, so get it right. An invalid signature, timestamp, header, body, or payload returns `400`. An authenticated request that then fails in the database returns `503`, so the provider is not falsely told we accepted it and will retry the delivery.

Never log a webhook body, signature header, signing secret, provider ID, or recipient.

Before concluding a credential or permission cause, group the complete record by provider error type and HTTP status. `InvalidApiKey`, `MissingApiKey`, and `RestrictedApiKey` mean the mounted API key is wrong, absent, or scoped too narrowly; a `403` validation error means the sending domain is unverified or claimed elsewhere. None of these is an IAM problem: the instance role holds no send permission, and adding one would not help. Verify the materialized cache and the provider console before changing anything. If evidence is incomplete, stop and report the precise gap rather than guessing.

## Controlled delivery evidence

Every message and every temporary database-switch change requires separate immediate approval. Public registration remains disabled throughout this procedure.

The provider supplies test destinations that produce real events without reaching a person: `delivered@resend.dev` for a successful delivery, `bounced@resend.dev` for a permanent bounce, and `complained@resend.dev` for a spam complaint. Each accepts `+` labelling, so a distinct label per case keeps intents separable.

1. For the one complete ordinary-delivery path, temporarily enable only password reset, keep the account ceiling and send canary limits unchanged, and use the public Turnstile-protected form for an existing operator-controlled account. Confirm one branded message, one durable application intent, and authenticated send and delivery webhooks. Immediately disable password reset again. Do not retain the destination, code, token, body, or intent metadata.
2. Test permanent-bounce and complaint handling through the normal authenticated email-change initiation path. For each separately approved message, enable only email change, re-enter the current password, request the change to the applicable provider test destination, and do not complete the code. This creates a real application intent and does not change the account address. Respect the one-minute account limiter, then disable email change immediately after the final case. Do not send directly through the provider API: an external test message has no application intent and can prove authenticated event receipt, but cannot prove destination suppression.
3. Verify each event is signature-authenticated and correlated to its application intent, the permanent-bounce destination becomes application-suppressed, the complaint destination becomes suppressed, and the complaint leaves registration disabled with the emergency reason. Treat provider test traffic only as functional control evidence, never as reputation or ordinary-user sending history.
4. Prove idempotent retry once. The provider retries a webhook that did not return `2xx` using the same message identifier, so a transient `503` from the application must produce exactly one stored feedback row after the retry succeeds. Replay only a signed local duplicate fixture to prove the deduplication path directly.
5. Prove the send-side idempotency key separately with a local fixture: two attempts under one intent identifier must produce one accepted message, never two.
6. Verify no open or click event appears at all, and that no destination, code, token, body, raw webhook payload, signature header, or private application data appears in retained evidence. Keep all three database email-flow switches false after the procedure and allow the uncompleted test email-change records to expire through bounded maintenance.

Do not enable registration, create a disposable production account, alter the persisted account address, or bypass Turnstile merely to produce evidence.

## Emergency stop

A complaint automatically disables registration. For a credible listbombing event, credential exposure, signature-verification defect, quota defect, unbounded storage path, provider-cost risk, or uncertain incident scope, obtain immediate approval and disable all email flows:

From `/home/ubuntu/chalkboard`, using the installed checksum-verified controls:

```bash
sudo ./email-emergency-stop.sh \
  ./compose.production.yaml \
  all \
  credential-or-abuse-investigation
```

To stop only new registration when the other two authenticated/existing-account paths remain demonstrably safe, use scope `registration`. The script cannot enable a flow.

After stopping:

- verify diagnostics show the intended false switches;
- inspect only aggregate counters and event types;
- never extract destination digests, raw addresses, codes, tokens, or bodies;
- preserve logs and minimum event metadata within existing retention;
- group matching fingerprints and correlate valid request IDs rather than treating repeated lines as new failures;
- verify that no raw `err`/`error`, request URL/body, destination, address, code, token, provider payload, confirmation URL, or user content entered logs; and
- keep flows disabled until the root cause, quota accounting, signature path, and cost exposure are resolved.

## Turnstile outage or provider outage

- Do not bypass Turnstile, accept a missing token, add a second provider, or disable server-side hostname/action/freshness checks.
- Keep the affected email-triggering flows disabled or fail closed.
- Verify login, sessions, boards, collaboration, deletion, health, and backups remain healthy.
- Retry only a single ambiguous Turnstile network failure with the same idempotency UUID. Do not retry malformed or explicit provider responses.
- Inspect only the bounded Turnstile attempt/category/status/error-code/response-length/fingerprint diagnostic; never retrieve or log the token, secret, or raw response.
- Treat a DNS timeout/outage as temporary and inspect only its lookup type, safe resolver code, and fingerprint; never log the address/domain.
- Never manually retry an ambiguous send result or create another intent for it. The adapter's own single idempotent retry has already happened.

## Secret materialization failure

1. Do not remove or edit the current cache. Preserve the bounded `application-security.materialization` failure record before recreating any service.
2. Verify the resolver checksum, Region, exact secret ARN, instance-role read permission, cache owner/mode, disk space, and child exit status without printing values.
3. Run an identical approved refresh. It must either no-op or atomically activate a complete release.
4. If no current cache exists, leave email flows off and core service online.
5. Never use `GetSecretValue`, `BatchGetSecretValue`, direct Secrets Manager Agent requests, shell tracing, environment dumps, or ad hoc plaintext files.

## Routine Turnstile rotation

The admission HMAC key is not routinely rotated.

1. Disable all email flows with approval.
2. The operator updates only `turnstileSecret` in the provider console and Secrets Manager console, preserving `admissionHmacKey` exactly.
3. Refresh with the same HMAC generation.
4. Recreate server and web, verify diagnostics and controlled Turnstile behavior, then enable only the previously approved flows.
5. Revoke the old Turnstile value through the provider console after the new path succeeds.

## Admission-key compromise

A suspected HMAC-key compromise is different from routine rotation:

1. Disable all email flows immediately after approval.
2. The operator installs a newly generated admission key directly in the retained secret and preserves/updates the Turnstile field as intended.
3. Increment the materialized generation number and refresh atomically.
4. Keep all email flows disabled for at least 24 hours, the longest old keyed admission window, so new digests cannot bypass live old counters.
5. Do not roll back to a compromised release. Quarantine or delete compromised cache releases only through a separately approved root-only cleanup.
6. After the wait, recheck global send intents, switches, material diagnostics, provider limits, and cost before any canary enablement.

## Revocation and cache rollback

To revoke local material after provider revocation, first disable all email flows and stop server/web. With approval, atomically rename the `current` link to a root-only `revoked-<timestamp>` name, then recreate server and web. Missing mounted values must produce `email.material=unavailable` while core features remain healthy.

For rollback after a bad non-compromise rotation, select the one retained predecessor by metadata and ownership only, never by printing file contents. Atomically point a temporary relative symlink at that release, rename it over `current`, fsync the cache directory, and recreate server/web. Do not use rollback after credential exposure or provider revocation.

An old EBS snapshot can contain a former complete cache. After restore, keep email flows off, verify whether provider credentials are still current, and prefer rotation before enabling. A stale provider value must degrade only the email workflows.

## Account and content deletion

Ordinary account deletion is self-service. Never ask for, receive, log, or place a user's password in an operator command, support issue, or database query. Do not run direct SQL for an ordinary deletion request or treat control of an email address or browser session as sufficient deletion authority.

The normal-account protocol is deliberately two-step:

1. The signed-in user enters the current password in Account settings. `POST /api/account/deletion/verify-password` verifies it on the server. A rejection must leave the destructive confirmation closed. This response creates no reusable deletion token or durable authorization.
2. Confirmation sends `DELETE /api/account` with the current password again. The server repeats password verification, locks the user row, and rejects the deletion if the account became a demo identity or the password hash changed between verification and the transaction.
3. In one transaction, deletion removes every board owned by the account, then removes assets uploaded by the account to another owner's board, and finally removes the normal user row. Foreign keys and quota triggers remove owned-board assets, invitations, memberships, Yjs state, storage ledgers, all sessions, and pending email-change/reset state. Membership in someone else's board is removed without deleting that board. Minimum pseudonymous send/feedback records retained for abuse and delivery handling lose their user link and expire through bounded maintenance.
4. Only after commit, the response clears the browser session cookie and the collaboration gateway invalidates the deleted user and every deleted owned board. Stale HTTP cookies therefore fail authentication and active sockets lose authority immediately.

Demo identities are service fixtures and must remain undeletable. Their content and sessions use the separate daily reset procedure. Local boards are browser-owned and are not part of cloud-account deletion; the user removes them from the local-board library or clears site storage separately.

For ordinary acceptance, verify through the user interface that a wrong password never opens confirmation, the destructive request asks for the password again, successful deletion returns to signed-out state, former sessions fail, owned cloud boards disappear, and a board owned by another account remains. Do not retain the password, address, board identifiers, or content as evidence. Retain only aggregate outcomes and the bounded `account.delete-authorization` and `account.delete` security event types.

Deleting live data does not rewrite a recovery copy that already exists. Logical dumps remain for at most 14 days. Scheduled encrypted snapshots age out under their configured recovery-point retention, while separately approved manual recovery snapshots may remain longer for disaster recovery, and deleting one needs its own approval.

This creates a trap when restoring. A recovery point predates any account deletion made after it, so restoring it can bring deleted accounts back. Before restoring, work out which deletions happened after that point, using the minimum security records available, and reconcile them before reopening public access. If you cannot reconcile them reliably, stop and get an operator decision on privacy and recovery. Do not restore silently.

An operator-assisted database deletion is exceptional and destructive. It requires a separately reviewed identity-verification procedure, a fresh structurally valid backup, immediate approval, stopped writers, exact transaction scope, post-commit collaboration invalidation, aggregate-only verification, and a rollback/privacy review. A public issue, possession of an address, or inability to sign in is not enough. Do not invent an ad hoc manual deletion command.

## Quota, credit, disk, CPU, database, or backup stop

- Disable all email flows before the configured send limit, provider free limit, or AWS credit condition could cause an unapproved cash charge.
- Never raise the 100/day, 3,000/month, 250-account, storage, demo, or collaboration hard caps to work around demand.
- Lowering a limit blocks new work and never deletes existing normal data.
- On disk, CPU-credit, PostgreSQL, or backup pressure, keep registration off and follow the existing health, backup, and rollback sections in `deploy/README.md`.
- Do not launch while the latest logical backup is structurally invalid, off-instance snapshot evidence is stale, production is unhealthy, or rollback cannot be exercised.

## Enabling the canary

Enable public registration only after exact deployed controls, approved production-path evidence, and a fresh backup.

The operator keeps `ACCOUNT_REGISTRATION_LIMIT` and the database fallback ceiling no higher than 10 for the first canary and retains Compose send defaults of 10/day and 100/month. Enablement is one approved transaction that updates only the intended `email_flow_switches`; changing either account ceiling is a separate reviewed mutation. Verify the resulting booleans, effective ceiling, and aggregate count through diagnostics without extracting users.

Immediately exercise registration, verification, login, reset, email change, deletion, boards, assets, quotas, and collaboration. Observe provider delivery and feedback, bounded logs, diagnostics, CPU credits, disk, PostgreSQL, and backups for at least 48 hours. Raise limits only from measured legitimate demand and never above source hard caps.

Confirm the provider free plan's own daily and monthly ceilings remain above the configured canary limits, and that no automatic paid upgrade is enabled. A `QuotaExceeded` refusal means the provider ceiling was reached; treat it as a capacity signal, not as a reason to upgrade the plan.

## SES purge (completed 2026-08-22)

The application has contained no SES or SNS code, dependency, permission, or
configuration since the Resend cutover. The AWS-side and DNS-side removal is now
also complete.

Removed from DNS, in this order, before the AWS resources:

- the three SES DKIM CNAME records, whose hosts matched the identity's reported
  DKIM tokens exactly;
- the `mail.chalkboard.space` MX record pointing at
  `feedback-smtp.ap-southeast-1.amazonses.com`; and
- the `mail.chalkboard.space` SPF TXT record.

Removed from AWS afterwards: the `chalkboard-account-email` configuration set,
the `chalkboard.space` domain identity (which carried the custom MAIL FROM), and
the operator sandbox-recipient identity. The feedback SNS topic and every SES
statement in the runtime policy had already gone with the cutover.

Verified empty afterwards: identities, configuration sets, templates, contact
lists, SNS topics, the account suppression list, and dedicated IPs. The runtime
policy holds exactly two `secretsmanager:GetSecretValue` statements.

Preserved, and deliberately untouched: the apex Zoho MX records, the `_dmarc`
record, the Zoho domain-verification and `zmail._domainkey` TXT records, the A
and `www` records, both Secrets Manager objects with their runtime read
permission, and every Resend record.

**The trap to remember.** Resend runs on top of Amazon SES, so its own records
also name `amazonses.com` and `feedback-smtp`. Two pairs looked nearly
identical and only one pair was ours:

| Record     | Value                                        | Owner         |
| ---------- | -------------------------------------------- | ------------- |
| `MX mail`  | `feedback-smtp.ap-southeast-1.amazonses.com` | ours, removed |
| `MX send`  | `feedback-smtp.ap-northeast-1.amazonses.com` | Resend, kept  |
| `TXT mail` | `v=spf1 include:amazonses.com ~all`          | ours, removed |
| `TXT send` | `v=spf1 include:amazonses.com ~all`          | Resend, kept  |

The region segment is the only thing that distinguishes the MX pair. Deleting
the `send` records would break all account email.

The apex SPF is one merged string shared with Zoho and the provider. It is
edited in place to drop only the SES include, never deleted and never
duplicated: deleting it breaks the human support mailbox, and a second SPF
record makes the domain fail SPF outright.

It now reads exactly `v=spf1 include:zohomail.com ~all`. The trailing `~all` is
part of the record, not decoration: without a final `all` mechanism a
non-matching sender gets a neutral result rather than a softfail, which is
weaker than the record it replaced. Re-check it after any edit.

Account-level SES sending remains enabled but is inert, because the account
holds no verified identity to send from.

AWS-controlled records cannot be deleted: the regional SES service record, the
prior review decision, the Support case, CloudTrail history, billing records,
and service-retained abuse or security data all persist. Never describe them as
purged.
