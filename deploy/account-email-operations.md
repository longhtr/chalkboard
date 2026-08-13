# Account-email operations

This runbook owns application-security materialization, emergency stops, SES sending-identity and feedback staging, credential recovery, canary admission, and the final SES outcome. Read `deploy/README.md` first. Every production, AWS, IAM, secret, DNS, provider, subscription, controlled-message, database-switch, push, and deployment mutation requires immediate operator approval.

No command in this document retrieves or prints a secret. The operator enters private provider values directly through the approved Secrets Manager console workflow. The agent must never receive, retrieve, transform, validate, or paste those values.

## Tracked controls

| Control                                | Responsibility                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ses-feedback.yaml`                    | Retained application secret, exact SES runtime policy, configuration set, authenticated SNS feedback, and MAIL FROM outputs |
| `account-email.guard`                  | Focused retained-secret, least-privilege, existing-identity, VDM, and SNS signature invariants                              |
| `asm-exec` and `asm-exec.sha256`       | Pinned runtime-only dynamic-reference resolver and its tracked checksum                                                     |
| `refresh-application-security.sh`      | Minimal-environment `asm-exec` invocation using two `{{resolve:secretsmanager:...}}` references                             |
| `materialize-application-security.mjs` | Strict validation, fsync, complete-release staging, atomic activation, and one retained rollback release                    |
| `email-emergency-stop.sh`              | One-way database control that disables registration or every email-triggering flow                                          |
| `compose.production.yaml`              | Read-only mounts of the three materialized files into only the non-root server container                                    |
| `*.test.mjs`                           | Resolver pin, template, mount, no-op, atomicity, partial-failure, rotation, rollback, and emergency-stop regressions        |

## Non-negotiable state

- Registration, password-reset initiation, and email-change initiation are separate database switches.
- Migration `0007_email_security.sql` creates all three switches disabled with reason `awaiting-account-email-canary`.
- The initial verified-account limit is 10. The database trigger never permits a configured limit above 250.
- Production Compose defaults to 10 provider sends per rolling day and 100 per rolling 30 days. Runtime validation never permits more than 80 and 2,400.
- Login, sessions, local boards, cloud boards, collaboration, account deletion, health, PostgreSQL, and backups remain available when email material or a provider is unavailable.
- SES uses the EC2 instance role. Never create or install a static AWS access key.
- `ses:GetAccount` is not a runtime permission. Account and review state are operator preflight evidence only.
- While the Region remains in the SES sandbox, a send to a separately verified recipient is also authorized against that recipient's SES identity. Grant only the exact approved recipient identity through the no-echo stack parameter, never `identity/*`, and remove the grant after production access.
- Do not enable an email flow before exact-SHA deployment acceptance, authenticated feedback, current recovery evidence, and the applicable SES approval state.

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
  --template deploy/ses-feedback.yaml
cfn-guard validate \
  --rules deploy/account-email.guard \
  --data deploy/ses-feedback.yaml \
  --output-format json
docker compose -f deploy/compose.production.yaml config --quiet
```

Run IAM Policy Autopilot against the exact TypeScript source containing the SES SDK call. Use an absolute source path and discovered Region/account variables; never add `--upload-policies`:

```bash
source_file=$(realpath apps/server/src/accounts/verificationEmail.ts)
UV_CACHE_DIR="$PWD/tmp/uv-cache" \
XDG_CACHE_HOME="$PWD/tmp/cache" \
uvx iam-policy-autopilot@latest generate-policies \
  "$source_file" \
  --region "$AWS_REGION" \
  --account "$AWS_ACCOUNT_ID" \
  --service-hints ses \
  --pretty
```

Review that its runtime action is `ses:SendEmail`, then compare the template policy with the current AWS service authorization reference. The allowed resources must be only the existing `chalkboard.space` sending identity, the exact configuration set, and, only while sandboxed, the one exact separately verified recipient identity. Do not upload a generated policy.

CloudFormation service validation and a reviewed change set happen only after exact-SHA CI and immediate approval. The change set must not replace EC2, networking, EBS, DLM, the existing instance role, or an existing SES identity/topic.

## Provider and infrastructure preparation

This sequence prepares external dependencies for the one coordinated deployment. It does not require early host staging: keep the production host untouched until the non-secret stack outputs, approved addresses, and Turnstile site key are known.

1. Confirm credits currently cover Secrets Manager, SES, SNS, and transfer usage. Confirm that Turnstile and the human-support mailbox remain on their approved free plans with no trial conversion or paid upgrade. Stop if an out-of-pocket charge could occur.
2. The approved email values are `Chalkboard <support@chalkboard.space>` for `EMAIL_FROM`, `support@chalkboard.space` for `EMAIL_REPLY_TO`, the existing verified `chalkboard.space` SES identity, and `mail.chalkboard.space` for custom MAIL FROM with fail-closed `REJECT_MESSAGE` behavior. No new SES identity is created. Zoho receives human correspondence and replies at the same visible address but is never the automated account-message transport. The configuration parser also rejects `noreply` and `no-reply` senders. The approved Turnstile widget is named `Chalkboard account security`, uses Managed mode, and is restricted to the exact `chalkboard.space` hostname. Initial canary values remain 10 verified normal accounts, 10 provider sends per rolling day, and 100 per rolling month; every email flow remains disabled during deployment.
3. The operator creates one Turnstile managed widget restricted to the exact `chalkboard.space` hostname. The application supplies and verifies only the `registration` and `password-reset` actions. Only the public site key enters ordinary deployment configuration.
4. Create a CloudFormation `CREATE` change set from `ses-feedback.yaml` for the exact stack name `chalkboard-account-email`, with `CreateHttpsSubscription=false`, `SendingIdentityDomain=chalkboard.space`, the exact separately verified recipient as `SandboxRecipientEmailIdentity` while the Region remains sandboxed, and `CAPABILITY_IAM`. Treat that recipient parameter as no-echo operational data: never print it or place it in tracked files. Its SES configuration set must also be named `chalkboard-account-email`, and its inline policy on `chalkboard-server` must be named `account-email`. Wait for terminal status, retrieve pre-deployment validation with `cloudformation describe-events` against the exact change-set ARN, and review every resource and policy statement. The stack must contain no `AWS::SES::EmailIdentity` resource and must not import, replace, or otherwise take ownership of the existing root identity. Creating the change set creates no resources but leaves a new stack in `REVIEW_IN_PROGRESS`; ask immediately before executing it, and clean up the change set and review stack with separate approval if execution is abandoned.
5. The stack generates only `admissionHmacKey`. Through the approved console interface, the operator preserves that generated field and adds `turnstileSecret` directly. Never copy either field through chat, shell history, `.env`, source, logs, or a change-set parameter.
6. Read the non-secret stack outputs and prepare, but do not yet publish, one exact authoritative-DNS change plan containing:
   - the custom MAIL FROM MX/TXT outputs for `mail.chalkboard.space`, while leaving the existing verified root identity's three Easy DKIM CNAMEs unchanged;
   - a `www` CNAME to the canonical apex without changing the apex A record;
   - replacement of the five existing registrar-forwarding MX records with the exact Zoho Free MX records approved in the operator console;
   - the exact Zoho DKIM record while preserving the existing Zoho domain-verification record; and
   - exactly one apex SPF TXT record that authorizes every still-legitimate apex sender. Replace the existing SPF record rather than adding a second SPF record, and retain the SES include until a read-only sender inventory proves it is no longer needed.
     Preserve DMARC unless a complete legitimate-sender review authorizes a policy change. Do not activate Zoho mail routing before the Zoho disclosure is installed and ready to become public in the coordinated cutover.

   CloudFormation deliberately does not own the existing root identity and therefore does not configure its custom MAIL FROM or feedback-forwarding attributes. Prepare these exact commands, but do not run them until the separately approved edge-closed DNS step:

   ```bash
   aws sesv2 put-email-identity-mail-from-attributes \
     --email-identity chalkboard.space \
     --mail-from-domain mail.chalkboard.space \
     --behavior-on-mx-failure REJECT_MESSAGE \
     --region "$AWS_REGION"

   aws sesv2 put-email-identity-feedback-attributes \
     --email-identity chalkboard.space \
     --no-email-forwarding-enabled \
     --region "$AWS_REGION"
   ```

7. Add one explicitly approved operator notification subscription to the new feedback topic and confirm it through the operator-owned channel. Do not remove the old confirmed notification until the replacement application subscription and operator notification are proven.
8. Simulate and read back the stack-managed runtime policy. It must grant only `secretsmanager:GetSecretValue` on the retained application secret and `ses:SendEmail` through three separate statements while sandboxed: the existing `chalkboard.space` identity with `StringEquals` requiring `ses:FromAddress` to equal `support@chalkboard.space`, the exact configuration set without that identity-oriented condition, and the one exact separately verified sandbox-recipient identity with the same strict sender condition. Never use `identity/*`, combine the configuration-set resource under the sender condition, or add a negated `IfExists` deny for that key. Simulate the complete real resource set: sender identity, configuration set, and sandbox recipient identity. Inspect `ResourceSpecificResults` rather than only the top-level decision; require the approved three-resource request to be allowed and missing/wrong sender, another recipient identity, `SendRawEmail`, and `GetAccount` to remain implicitly denied. Set `SandboxRecipientEmailIdentity` back to its empty default and execute the reviewed policy-only update immediately after SES production access, because recipient identity authorization is no longer required outside the sandbox. Keep the previous broad `ses-send` inline policy attached while the old production server is running; remove it only during the edge-closed cutover after the replacement server passes private checks, then recheck the exact policy and Systems Manager before reopening the edge.
9. Keep `CreateHttpsSubscription=false` until the exact application endpoint is deployed and rejects unsigned requests.

## Host release staging

After provider preparation supplies every non-secret deployment value, stage the release without downtime by following `deploy/README.md`:

1. Reconfirm that local and remote `main`, the successful exact-SHA CI run, both Arm64 image labels, the complete release archive, and every staged control represent one commit.
2. Transfer the complete release directory to a new commit-named host directory and verify `SHA256SUMS` there before loading or installing anything.
3. Prepare and validate the mode-`0600` staged `.env` with only the approved release, canary, SES, Reply-To, feedback-topic, and Turnstile public values. Leave the live `.env` untouched.
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

Use only the non-secret stack output ARN and a positive HMAC generation number. On the production host, run the resolver from the verified exact-SHA staging directory and write the cache where the production Compose file mounts it. Set `staged_control_dir` explicitly to that reviewed directory; do not source `.env` to obtain it:

```bash
cd /home/ubuntu/chalkboard
staged_control_dir="$PWD/staging-<short-commit>/controls"
test -x "$staged_control_dir/refresh-application-security.sh"
test -f "$staged_control_dir/materialize-application-security.mjs"

sudo "$staged_control_dir/refresh-application-security.sh" \
  "$APPLICATION_SECURITY_SECRET_ARN" \
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
5. validates both resolved values before writing;
6. stages all three files in a new owner-only release;
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
2. Require private health, exact-SHA diagnostics, second-server lock refusal, graceful drain/restart, SPA/API/license boundaries, and these email diagnostics: `material=materialized`, `humanVerification=turnstile`, `delivery=ses`, and all three database flows false. Require unsigned feedback to return 400 and core account/board/asset/collaboration/deletion/backup behavior to remain healthy.
3. While the edge remains closed and the replacement has passed private checks, apply the previously reviewed DNS plan after immediate approval. Query the authoritative name servers directly and require the unchanged existing SES Easy DKIM records, exact `mail.chalkboard.space` MX/TXT records, Zoho records, single apex SPF record, safe DMARC record, and `www` record. Then obtain separate immediate approval to run the two prepared SES identity-attribute commands. Read back only identity status, MAIL FROM attributes, and the feedback-forwarding boolean; require `chalkboard.space` verification and DKIM success, `mail.chalkboard.space` MAIL FROM success with `REJECT_MESSAGE`, and email forwarding disabled. If DNS or SES state is incomplete, keep every email flow off and either correct it or roll back before reopening the edge.
4. While the edge remains closed, remove the old broad `ses-send` inline policy after immediate approval. Simulate and read back the remaining permissions, require no runtime `ses:GetAccount` or wildcard SES grant, and verify Systems Manager remains online. Never remove this policy earlier while the old server is still the production runtime.
5. Start Caddy only after the application, DNS authoritative readback, exact runtime policy, Systems Manager, and rollback path all pass. Verify the public policies now truthfully disclose Zoho before relying on the new MX path; verify the `www` redirect, TLS, security headers, public routes, diagnostics, and private readiness/metrics boundaries.
6. Wait for public DNS and read-only SES checks to show the existing `chalkboard.space` identity and Easy DKIM still verified and `mail.chalkboard.space` custom MAIL FROM successful. A pending state is not success. Verify SES is configured to send as `Chalkboard <support@chalkboard.space>` with replies directed to the same monitored Zoho mailbox. Verify Zoho receives and can reply through `support@chalkboard.space` only with separately approved, content-free operator test messages.

If application rollback is required after the old broad policy is removed, keep all email-triggering flows unavailable until the rollback sender and least-privilege policy are explicitly reconciled. Do not restore wildcard SES access merely to make a rollback send email.

## HTTPS feedback ownership

After the dark deployment is healthy:

1. With immediate approval, stop Caddy, then stop and recreate server/web under the deployment procedure with `SNS_CONFIRM_SUBSCRIPTION=true` and without overlapping a server.
2. Complete the private checks, then restart Caddy and verify the signed feedback endpoint is publicly reachable. SNS cannot confirm an HTTPS endpoint while the public edge is stopped.
3. Update the stack with `CreateHttpsSubscription=true` after immediate approval while Caddy and the confirmed-ready application endpoint remain online.
4. The application verifies the exact topic and SNS signature, then follows only the exact regional `ConfirmSubscription` URL whose topic and token match the signed envelope.
5. After the subscription is confirmed, stop Caddy, restore `SNS_CONFIRM_SUBSCRIPTION=false`, recreate server and web, complete private checks, restart Caddy, and verify the subscription remains confirmed.
6. Never log or retain the confirmation URL or token.

## Provider failure evidence and diagnosis

Evidence preservation is the first gate before any correction. Do not recreate a container before preserving its current and previous bounded logs from the exact failure window. Do not send again, change IAM, alter DNS, rotate material, or change an email-flow switch merely to obtain clearer evidence.

“Lossless” provider evidence means lossless root-cause information after required privacy/security information-preserving transformation, not raw-payload retention. Preserve exact safe adapter-owned scalar facts and correlations. For every private value preserve full SHA-256, byte length, value kind, classification, and completeness; for arbitrary future fields preserve bounded structure, field identities or name fingerprints, and observed/omitted counts. Keep raw-body correlation separate from parsed JSON/XML/PEM structure, HTTP metadata, nested transport evidence, and cancellation/read state. Record UTF-8 validity and declared-versus-observed byte-length agreement. Apply a strict grammar before retaining any nominally safe header, reason, URL, provider code/type, service, or X.509 name/serial value; otherwise retain only private fingerprint/length evidence. Never claim completeness when a stream, inspection prefix, field list, header list, schema-issue list, XML code/request-ID inventory, stack/cause/aggregate inspection, or parser was truncated, unavailable, invalid, or omitted. Capture mutable error properties once so fingerprints, lengths, and topology describe one snapshot.

For every SES send failure preserve the complete `accountEmailDeliveryFailure` record before any retry, container recreation, IAM change, or DNS change:

- application purpose, certainty, failure class, stable classified error name, and the provider's original bounded error type in `providerOperationalError`;
- every installed Smithy `$metadata` field: HTTP status, canonical `providerRequestId`, AWS extended/CloudFront IDs, attempts, total retry delay, and clock-skew correction, plus all future metadata fields as safe scalar/private-fingerprint structure;
- `$fault`, `$retryable` presence/throttling, `$service`, nested cause/aggregate/code/status/stack topology, root error-field inventory, low-level HTTP status/reason/header/body evidence, and `$responseBodyText` private fingerprint/length plus safe JSON/XML error structure;
- the exact non-private request facts: `ses:SendEmail`, Region, named configuration set, one destination, configured From match, one Reply-To, simple HTML/text content, one SDK attempt, and timeout;
- `providerMessageFingerprint`, provider-message UTF-8 byte length, separate inspection and summary completeness, canonical `providerResponseTruncated`, and bounded transformed summary;
- every bounded `ses:*` action occurrence and every denied SES ARN occurrence, not only the first: private full-ARN fingerprint, partition/service/Region/resource type, occurrence count, Region match, request match/category, observed/omitted counts, and parser completeness; and
- the server request ID when a synchronous route owns one.

An accepted SES response also has an `acceptanceDiagnostic`: private message-ID fingerprint/length, full response metadata, HTTP data if exposed, response fields/future values, and request shape. If database bookkeeping fails, preserve the complete `accountEmailBookkeepingFailure` record. That is the evidence needed to reconcile an accepted provider send without logging or replaying its message ID.

The transformed summary may retain service, Region, action, and resource type, but must replace the AWS account ID and resource value. Never retain a destination, full ARN, provider message ID, message body, verification code, password, Turnstile token/secret/site key/widget ID, session/cookie, intent/destination digest, raw AWS error object, or raw provider response. A SHA-256 fingerprint supports equality/correlation only; it does not replace AWS request IDs, HTTP/Smithy metadata, parsed structure, action/resource occurrence accounting, completeness flags, or policy reconstruction.

For server-side Turnstile preserve endpoint/method, action, attempt, exact idempotency UUID, maximum-attempt policy, timeout, private token/expected-host fingerprints, expected and actual match booleans, category/status, all error-code classifications plus private value diagnostics, every response field and future-field value as safe structure/private fingerprints, schema issues, HTTP headers/status/private reason, and private body fingerprint/length/UTF-8/read/cancellation completeness. One interrupted network operation may retry once only with the same idempotency UUID. Stream cancellation is requested at most once as best-effort cleanup and is never awaited; `requested-unobserved` is explicit evidence, not success. Do not retry explicit HTTP, malformed, invalid-UTF-8, oversized, schema-invalid, mismatch, stale, declined, or provider-callback outcomes.

The browser separately keeps at most 20 local-only Turnstile lifecycle records under `chalkboard:turnstile-provider-diagnostics`. Preserve them before reload when diagnosing script load/error/10-second timeout, missing API, render/removal failure, invalid token callback, provider error/timeout, expiry, or completion ordering. Each provider exception is captured once; records retain exact message/stack character and UTF-8 byte lengths, fixed frame-count/topology placeholders, and a SHA-256 explicitly marked as complete-value or bounded-prefix coverage. The reader reconstructs only allowlisted fields and discards malformed or unknown localStorage content. Records are never uploaded and contain no token, site key, widget ID, URL query, raw callback value, arbitrary exception prose, or provider-controlled stack frame. Clear them after the incident is resolved rather than copying browser storage wholesale.

For DNS preserve private query-name and error-hostname fingerprints/lengths, lookup type, initial-MX versus fallback context, sibling A/AAAA outcome, resolver implementation/configured timeout/tries, elapsed time, source (`resolver` or `application-timeout`), code/errno/syscall, root field inventory/future-field structure, and nested operational fingerprint/code/stack/cause topology. Never retain the address, domain, MX exchange, or returned IP. Expected negative answers are not outages; partial family degradation is recorded even when another family remains deliverable.

For SNS preserve the complete typed `snsFeedbackFailure`, `snsSubscriptionConfirmation`, or authenticated SES payload diagnostic. This includes per-envelope-value and canonical-message private fingerprints/lengths, canonical field sequence, field/schema inventories and omission counts, parsed timestamp/type/topic match, signature version/algorithm, certificate URL fingerprint, fetch/redirect/cache/HTTP/body/UTF-8/declared-length/structure/read/cancel evidence, bounded XML code/request-ID diagnostics and counts, transformed and fingerprinted X.509 metadata, confirmation response evidence, and authenticated SES payload/event/provider-ID fingerprints. Invalid envelope/topic/signature/input failures return `400`; retryable certificate retrieval/response/validity, confirmation transport, unclassified parser failure, and authenticated database processing return `503` so AWS is not falsely acknowledged. Never log an envelope, PEM body, confirmation URL/token, provider ID, recipient, destination array, or SES message.

Before concluding an SES IAM cause, group the complete record by AWS request ID and provider-message fingerprint, then reconstruct every resource SES evaluated for the exact SDK call: sending identity, named configuration set, and, while sandboxed, every separately verified recipient identity SES mentions. Compare all retained denied-resource occurrences, Regions, resource types, request-match booleans, and `ses:*` actions. Simulate the complete resource set with the exact action and `ses:FromAddress` context, then read back the live policy after propagation. A source template, first-ARN classification, partial simulation, one action, or one resource category is not proof. If action/resource parsing is incomplete, body/message inspection was truncated, AWS request metadata is absent, policy simulation differs from live readback, or another resource appears, stop and report the precise evidence gap rather than guessing.

## Controlled SES evidence

Every message and every temporary database-switch change requires separate immediate approval. Public registration remains disabled throughout this procedure.

1. For the one complete ordinary-delivery path, temporarily enable only password reset, keep the account ceiling and send canary limits unchanged, and use the public Turnstile-protected form for an existing operator-controlled account whose destination is already verified in the SES sandbox. Confirm one branded message, one durable application intent, the named configuration set, and authenticated send/delivery feedback. Immediately disable password reset again. Do not retain the destination, code, token, body, or intent metadata.
2. Test permanent-bounce and complaint handling with the minimum official SES mailbox-simulator cases through the normal authenticated email-change initiation path. For each separately approved message, enable only email change, re-enter the current password, request the change to the applicable simulator destination, and do not complete the code. This creates a real application intent and does not change the account address. Respect the one-minute account limiter, then disable email change immediately after the final case. Do not use a direct provider send: an external simulator message has no application intent and can prove authenticated event receipt, but cannot prove destination suppression.
3. Verify each simulator event is authenticated and correlated to its application intent, the permanent-bounce destination becomes application-suppressed, the complaint destination becomes suppressed, the complaint leaves registration disabled with the emergency reason, and the replacement operator notification arrives. Treat simulator traffic only as functional control evidence, never as reputation or ordinary-user sending history.
4. Replay only a signed local duplicate fixture to prove idempotency. Do not deliberately publish a duplicate production SNS message.
5. Verify no open/click event and no destination, code, token, body, raw envelope, confirmation URL, or private application data appears in retained evidence. Keep all three database email-flow switches false after the procedure and allow the uncompleted simulator email-change records to expire through bounded maintenance.
6. After both the application subscription and replacement operator notification are proven, inventory the old feedback topic, policy, publishers, and subscriptions read-only. If it is Chalkboard-exclusive, obtain separate immediate approval to remove the obsolete identity notification wiring, subscriptions, and topic. If any part is shared, preserve the shared resource but replace the broad legacy policy with documented exact service, source-account, and source-ARN conditions. Do not proceed to the appeal while a broad legacy Chalkboard feedback policy remains.

If the existing-account destination is not verified in the sandbox, stop the ordinary-delivery case. Do not enable registration, create a disposable production account, alter the persisted account address, or bypass Turnstile merely to produce evidence.

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
- Never retry an ambiguous SES `SendEmail` result or create another intent for it.

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

Live deletion does not rewrite an existing recovery copy. Logical dumps remain for at most 14 days. Scheduled encrypted snapshots age out under their configured recovery-point retention; separately approved manual recovery snapshots may remain longer for disaster recovery and require separately approved deletion. Before restoring any recovery point, identify account deletions made after that point from the minimum available security records and reconcile them before reopening public access. If those deletions cannot be reconciled reliably, stop and obtain an operator privacy/recovery decision rather than silently restoring deleted accounts to service.

An operator-assisted database deletion is exceptional and destructive. It requires a separately reviewed identity-verification procedure, a fresh structurally valid backup, immediate approval, stopped writers, exact transaction scope, post-commit collaboration invalidation, aggregate-only verification, and a rollback/privacy review. A public issue, possession of an address, or inability to sign in is not enough. Do not invent an ad hoc manual deletion command.

## Quota, credit, disk, CPU, database, or backup stop

- Disable all email flows before the configured send limit, provider free limit, or AWS credit condition could cause an unapproved cash charge.
- Never raise the 80/day, 2,400/month, 250-account, storage, demo, or collaboration hard caps to work around demand.
- Lowering a limit blocks new work and never deletes existing normal data.
- On disk, CPU-credit, PostgreSQL, or backup pressure, keep registration off and follow the existing health, backup, and rollback sections in `deploy/README.md`.
- Do not launch while the latest logical backup is structurally invalid, off-instance snapshot evidence is stale, production is unhealthy, or rollback cannot be exercised.

## Enabling a granted SES canary

SES `PENDING` is not approval. Enable public registration only after `GRANTED`, exact deployed controls, approved production-path evidence, and a fresh backup.

The operator keeps `ACCOUNT_REGISTRATION_LIMIT` and the database fallback ceiling no higher than 10 for the first canary and retains Compose send defaults of 10/day and 100/month. Enablement is one approved transaction that updates only the intended `email_flow_switches`; changing either account ceiling is a separate reviewed mutation. Verify the resulting booleans, effective ceiling, and aggregate count through diagnostics without extracting users.

Immediately exercise registration, verification, login, reset, email change, deletion, boards, assets, quotas, and collaboration. Observe SES reputation and feedback, bounded logs, diagnostics, CPU credits, disk, PostgreSQL, and backups for at least 48 hours. Raise limits only from measured legitimate demand and never above source hard caps.

## Final SES reconsideration

After the exact deployment passes ordinary acceptance, immediately run a read-only accuracy check of SES/account state, public pages, DNS, configuration, switches, quotas, feedback, recovery, and evidence. Remove every unsupported statement from the prepared request.

Ask immediately before one reconsideration in `ap-southeast-1`. It must be transactional only, request the minimum practical allowance, disclose the earlier denial when appropriate, and contain no invented customer, company, consent, age, volume, billing, reputation, or monitoring claim. Retain only the exact submitted text and redacted non-secret evidence privately.

- `GRANTED`: use the controlled canary above and do not create Resend resources.
- `PENDING`: wait and answer narrowly in the same case. Do not submit elsewhere.
- Terminal `DENIED` or final refusal: record the trigger and consider the alternate-provider cutover only after a new execution review. Do not run SES and Resend as automatic failover.

## Alternate-provider purge boundary

An alternate-provider cutover is not authorized by this runbook alone. Its removal inventory must classify every SES identity, configuration set, event destination, SNS topic/subscription, IAM policy, suppression entry, and DNS record as exclusive or shared. Separate approvals are required to remove each customer-controlled resource. Preserve DMARC and any DNS needed by another sender. AWS-controlled review, Support, CloudTrail, billing, and abuse records cannot be deleted and must never be described as purged.
