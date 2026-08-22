/** Guards account-email infrastructure, resolver pinning, exact permissions, and server-only secret mounts. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const templatePath = resolve('deploy/account-email.yaml');
const template = readFileSync(templatePath, 'utf8');
const compose = readFileSync(resolve('deploy/compose.production.yaml'), 'utf8');
const caddyfile = readFileSync(resolve('deploy/Caddyfile'), 'utf8');
const ciWorkflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
const dockerIgnore = readFileSync(resolve('.dockerignore'), 'utf8');
const npmIgnore = readFileSync(resolve('.npmignore'), 'utf8');
const refresh = readFileSync(
  resolve('deploy/refresh-application-security.sh'),
  'utf8',
);
const emergencyStopPath = resolve('deploy/email-emergency-stop.sh');
const emergencyStop = readFileSync(emergencyStopPath, 'utf8');
const operations = readFileSync(
  resolve('deploy/account-email-operations.md'),
  'utf8',
);
const deployment = readFileSync(resolve('deploy/README.md'), 'utf8');

function resourceBlock(logicalId, nextLogicalId) {
  const start = template.indexOf(`  ${logicalId}:`);
  const end = template.indexOf(`  ${nextLogicalId}:`, start + 1);
  assert.notEqual(start, -1, `missing ${logicalId}`);
  assert.notEqual(end, -1, `missing ${nextLogicalId}`);
  return template.slice(start, end);
}

test('CloudFormation YAML parses and contains no private account/resource literal', () => {
  const parsed = spawnSync(
    'ruby',
    [
      '-e',
      "require 'yaml'; abort('empty') if YAML.parse_file(ARGV.fetch(0)).nil?",
      templatePath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.doesNotMatch(template, /\b\d{12}\b/u);
  assert.doesNotMatch(template, /^\s+SecretString:\s/mu);
  assert.doesNotMatch(template, /^\s+TurnstileSecret:\s/mu);
});

test('both secrets are retained and the runtime policy grants only their reads', () => {
  const secret = resourceBlock(
    'ApplicationSecuritySecret',
    'EmailProviderSecret',
  );
  assert.match(secret, /Type: AWS::SecretsManager::Secret/u);
  assert.match(secret, /DeletionPolicy: Retain/u);
  assert.match(secret, /UpdateReplacePolicy: Retain/u);
  assert.match(secret, /GenerateStringKey: admissionHmacKey/u);
  assert.match(secret, /PasswordLength: 48/u);
  assert.doesNotMatch(secret, /KmsKeyId:/u);

  // The provider secret must carry no value at all. A generated placeholder
  // would look like a working key while failing at the provider.
  const providerSecret = resourceBlock(
    'EmailProviderSecret',
    'ApplicationRuntimePolicy',
  );
  assert.match(providerSecret, /Type: AWS::SecretsManager::Secret/u);
  assert.match(providerSecret, /DeletionPolicy: Retain/u);
  assert.match(providerSecret, /UpdateReplacePolicy: Retain/u);
  assert.doesNotMatch(providerSecret, /KmsKeyId:/u);
  assert.doesNotMatch(providerSecret, /GenerateSecretString:/u);
  assert.doesNotMatch(providerSecret, /SecretString:/u);

  const policyStart = template.indexOf('  ApplicationRuntimePolicy:');
  const policy = template.slice(policyStart, template.indexOf('\nOutputs:'));
  assert.match(policy, /^\s+PolicyName: account-email$/mu);
  assert.equal(
    [...policy.matchAll(/Action: secretsmanager:GetSecretValue/gu)].length,
    2,
  );
  assert.match(policy, /Resource: !Ref ApplicationSecuritySecret/u);
  assert.match(policy, /Resource: !Ref EmailProviderSecret/u);
  assert.doesNotMatch(policy, /Condition:/u);
  assert.doesNotMatch(policy, /Effect: Deny/u);
  assert.doesNotMatch(
    policy,
    /(?:ListSecrets|PutSecretValue|DeleteSecret|TagResource|UntagResource|RotateSecret|Resource:\s*['"]?\*)/u,
  );
});

test('no provider send permission or AWS email resource remains in the control', () => {
  // Delivery authenticates with a provider API key, so the instance role must
  // never regain a send permission and the stack must stay free of SES or SNS.
  assert.doesNotMatch(template, /ses:/u);
  assert.doesNotMatch(template, /sns:/u);
  assert.doesNotMatch(template, /Type: AWS::SES::/u);
  assert.doesNotMatch(template, /Type: AWS::SNS::/u);
  assert.doesNotMatch(template, /SendingIdentityDomain/u);
  assert.doesNotMatch(template, /SandboxRecipientEmailIdentity/u);
  assert.doesNotMatch(template, /ConfigurationSet/u);
  assert.doesNotMatch(template, /FeedbackTopic/u);
  for (const output of ['ApprovedEmailFrom', 'ApprovedEmailReplyTo']) {
    assert.match(template, new RegExp(`  ${output}:`, 'u'));
  }
  assert.match(template, /Value: Chalkboard <support@chalkboard\.space>/u);
  assert.match(template, /Value: support@chalkboard\.space/u);
  assert.doesNotMatch(template, /MailFrom(?:Mx|Spf)(?:Name|Value):/u);
});

test('resolver is pinned and secret values can only enter the materializer child environment', () => {
  const resolver = readFileSync(resolve('deploy/asm-exec'));
  const expected = readFileSync(resolve('deploy/asm-exec.sha256'), 'utf8')
    .trim()
    .split(/\s+/u)[0];
  assert.equal(createHash('sha256').update(resolver).digest('hex'), expected);
  assert.match(refresh, /set \+x/u);
  assert.match(refresh, /env -i/u);
  assert.match(
    refresh,
    /\{\{resolve:secretsmanager:\$\{secret_arn\}:SecretString:admissionHmacKey:AWSCURRENT\}\}/u,
  );
  assert.match(
    refresh,
    /\{\{resolve:secretsmanager:\$\{secret_arn\}:SecretString:turnstileSecret:AWSCURRENT\}\}/u,
  );
  assert.match(
    refresh,
    /\{\{resolve:secretsmanager:\$\{provider_secret_arn\}:SecretString:resendApiKey:AWSCURRENT\}\}/u,
  );
  assert.match(
    refresh,
    /\{\{resolve:secretsmanager:\$\{provider_secret_arn\}:SecretString:resendWebhookSecret:AWSCURRENT\}\}/u,
  );
  // One ARN supplied twice would silently resolve provider keys from the
  // application-security secret, so the two must be proven distinct.
  assert.match(refresh, /must be distinct/u);
  assert.doesNotMatch(refresh, /get-secret-value|batch-get-secret-value/u);
});

test('the purge records what was removed and protects the lookalike records', () => {
  const start = operations.indexOf('## SES purge');
  assert.notEqual(start, -1);
  const purge = operations.slice(start);
  // Resend runs on top of SES, so its own records also name amazonses and
  // feedback-smtp. Only the region segment separates the two MX records, and
  // deleting Resend's would break every account email.
  assert.match(purge, /ap-southeast-1/u);
  assert.match(purge, /ap-northeast-1/u);
  assert.match(purge, /Resend, kept/u);
  assert.match(purge, /region segment is the only\s+thing/u);
  // Deleting the merged apex SPF record breaks the human support mailbox, and
  // adding a second one makes the domain fail SPF outright.
  assert.match(purge, /drop only the SES\s+include/u);
  assert.match(purge, /never deleted and never\s+duplicated/u);
  assert.match(purge, /breaks the human support\s+mailbox/u);
  assert.match(purge, /fail SPF\s+outright/u);
  // AWS retains records the account cannot delete.
  assert.match(purge, /Never describe them as\s+purged/u);
});

test('controlled delivery evidence uses application-correlated intents without opening registration', () => {
  const start = operations.indexOf('## Controlled delivery evidence');
  const end = operations.indexOf('## Emergency stop', start);
  const controlled = operations.slice(start, end);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(controlled, /Public registration remains disabled/u);
  assert.match(controlled, /temporarily enable only password reset/u);
  assert.match(controlled, /Immediately disable password reset again/u);
  assert.match(controlled, /authenticated email-change initiation path/u);
  assert.match(controlled, /creates a real application intent/u);
  assert.match(controlled, /does not change the account address/u);
  assert.match(controlled, /external test message has no application intent/u);
  assert.match(controlled, /cannot prove destination suppression/u);
  assert.match(
    controlled,
    /Keep all three database email-flow switches false/u,
  );
  assert.match(controlled, /Do not enable registration/u);
  assert.doesNotMatch(controlled, /temporarily enable registration/u);
  // Both idempotency directions have to be proven, not just the webhook side.
  assert.match(controlled, /exactly one stored feedback row/u);
  assert.match(controlled, /one accepted message, never two/u);
  assert.match(controlled, /no open or click event appears at all/u);
});

test('emergency control can only disable fixed flow scopes', () => {
  assert.match(emergencyStop, /SET enabled = FALSE/u);
  assert.doesNotMatch(emergencyStop, /enabled = TRUE/u);
  const rejected = spawnSync(
    emergencyStopPath,
    [resolve('deploy/compose.production.yaml'), 'invalid-scope', 'test-stop'],
    { encoding: 'utf8' },
  );
  assert.equal(rejected.status, 2);
  assert.doesNotMatch(
    `${rejected.stdout}${rejected.stderr}`,
    /password|secret/iu,
  );
});

test('admission-key compromise keeps all flows stopped through the old counter window', () => {
  const start = operations.indexOf('## Admission-key compromise');
  const end = operations.indexOf('## Revocation and cache rollback', start);
  const compromise = operations.slice(start, end);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(compromise, /Disable all email flows/u);
  assert.match(compromise, /Increment the materialized generation number/u);
  assert.match(compromise, /at least 24 hours/u);
  assert.match(compromise, /longest old keyed admission window/u);
  assert.match(compromise, /Do not roll back to a compromised release/u);
  assert.match(compromise, /before any canary enablement/u);
});

test('account deletion runbook preserves reauthentication, ownership, and recovery boundaries', () => {
  const start = operations.indexOf('## Account and content deletion');
  const end = operations.indexOf(
    '## Quota, credit, disk, CPU, database, or backup stop',
    start,
  );
  const deletion = operations.slice(start, end);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(
    deletion,
    /Never ask for, receive, log, or place a user's password/u,
  );
  assert.match(deletion, /POST \/api\/account\/deletion\/verify-password/u);
  assert.match(deletion, /creates no reusable deletion token/u);
  assert.match(deletion, /DELETE \/api\/account/u);
  assert.match(deletion, /repeats password verification/u);
  assert.match(deletion, /locks the user row/u);
  assert.match(deletion, /without deleting that board/u);
  assert.match(deletion, /all sessions/u);
  assert.match(deletion, /invalidates the deleted user/u);
  assert.match(deletion, /Local boards are browser-owned/u);
  assert.match(deletion, /Logical dumps remain for at most 14 days/u);
  assert.match(deletion, /manual recovery snapshots may remain longer/u);
  assert.match(deletion, /before reopening public access/u);
  assert.match(deletion, /requires .* immediate approval/u);
  assert.match(deletion, /Do not invent an ad hoc manual deletion command/u);
});

test('Caddy redirects www to the canonical apex without proxying a second origin', () => {
  assert.match(caddyfile, /^www\.\{\$CHALKBOARD_SITE_ADDRESS\} \{/mu);
  assert.match(
    caddyfile,
    /redir https:\/\/\{\$CHALKBOARD_SITE_ADDRESS\}\{uri\} permanent/u,
  );
  assert.match(caddyfile, /^\{\$CHALKBOARD_SITE_ADDRESS\} \{/mu);
  assert.equal(caddyfile.match(/reverse_proxy web:8080/gu)?.length, 1);
});

test('provider preparation defers host staging and legacy IAM removal to the safe cutover boundary', () => {
  const preparationStart = operations.indexOf(
    '## Provider and infrastructure preparation',
  );
  const stagingStart = operations.indexOf('## Host release staging');
  const materialStart = operations.indexOf(
    '## Materializing private runtime files',
  );
  const cutoverStart = operations.indexOf(
    '## Coordinated deployment and DNS activation',
  );
  const ownershipStart = operations.indexOf('## Webhook endpoint ownership');
  assert.notEqual(preparationStart, -1);
  assert.ok(stagingStart > preparationStart);
  assert.ok(materialStart > stagingStart);
  assert.ok(cutoverStart > materialStart);
  assert.ok(ownershipStart > cutoverStart);

  const preparation = operations.slice(preparationStart, stagingStart);
  assert.match(preparation, /does not require early host staging/u);
  assert.match(
    preparation,
    /Zoho receives human correspondence and replies .* never the automated account-message transport/u,
  );
  assert.match(preparation, /exact `chalkboard\.space` hostname/u);
  assert.match(preparation, /exact stack name `chalkboard-account-email`/u);
  assert.match(preparation, /inline policy .* named `account-email`/u);
  // Both secrets must survive the change set that removes the SES resources.
  assert.match(
    preparation,
    /neither is scheduled for replacement or deletion/u,
  );
  assert.match(preparation, /created with no value at all/u);
  // The merged apex SPF is the one record a careless change would break.
  // Deleting it breaks the support mailbox; a second record fails SPF outright.
  // Adding the provider needs no apex SPF change; the provider scopes its own
  // SPF to its return-path subdomain. The apex is edited once, at the purge.
  assert.match(preparation, /apex SPF TXT record is \*\*not\*\* changed/u);
  assert.match(preparation, /edit it in place; never delete it/u);
  assert.match(preparation, /never add a second SPF record/u);
  // Click tracking defaults to on at the provider and must be turned off.
  assert.match(preparation, /Click tracking is \*\*enabled by default\*\*/u);
  // Apex verification is forced by the pinned sender, not chosen for taste.
  assert.match(preparation, /verified sending domain is the apex/u);
  assert.match(preparation, /From address to sit on the verified domain/u);
  assert.match(preparation, /do not yet publish/u);
  assert.match(preparation, /no send permission of any kind/u);
  assert.match(
    preparation,
    /Keep the previous broad `ses-send` inline policy/u,
  );
  assert.match(preparation, /while the old production server is running/u);
  // Engagement tracking must never be left on at the provider.
  assert.match(preparation, /open tracking defaults to off/u);

  const cutover = operations.slice(cutoverStart, ownershipStart);
  assert.match(cutover, /edge remains closed/u);
  assert.match(cutover, /replacement has passed private checks/u);
  assert.match(cutover, /remove the old broad `ses-send` inline policy/u);
  assert.match(cutover, /no runtime SES grant of any kind/u);
  assert.match(cutover, /Never remove this policy earlier/u);

  const ownership = operations.slice(
    ownershipStart,
    operations.indexOf('## Provider failure evidence', ownershipStart),
  );
  assert.match(ownership, /needs no confirmation handshake/u);
  assert.match(ownership, /returns `400`/u);
  assert.match(ownership, /older than five minutes/u);
});

test('deployment stages every host-side account-email runtime control from the exact commit', () => {
  for (const control of [
    'compose.production.yaml',
    'Caddyfile',
    'backup.sh',
    'asm-exec',
    'asm-exec.sha256',
    'refresh-application-security.sh',
    'materialize-application-security.mjs',
    'email-emergency-stop.sh',
  ]) {
    assert.match(deployment, new RegExp(control.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(deployment, /tmp\/release-\$short_commit/u);
  assert.match(deployment, /sha256sum --check SHA256SUMS/u);
  assert.match(deployment, /approved non-secret account-registration ceiling/u);
  assert.match(deployment, /Never print either file/u);
  assert.match(deployment, /Atomically install the already validated staged/u);
  assert.match(operations, /\$PWD\/runtime\/application-security/u);
  assert.doesNotMatch(operations, /\$PWD\/deploy\/runtime/u);
  assert.match(operations, /sudo \.\/email-emergency-stop\.sh/u);
});

test('Docker build context excludes every deployment cache and control', () => {
  assert.match(dockerIgnore, /^deploy$/mu);
  assert.doesNotMatch(dockerIgnore, /!deploy\/runtime/mu);
});

test('package artifacts exclude the private handoff and generated state', () => {
  for (const pattern of [
    /^AGENTS\.md$/mu,
    /^tmp\/$/mu,
    /^test-results\/$/mu,
    /^data\/$/mu,
    /^\.env$/mu,
    /^\.env\.\*$/mu,
  ]) {
    assert.match(npmIgnore, pattern);
  }
  assert.match(npmIgnore, /^!\.env\.example$/mu);
});

test('tracked paths and content use functional rather than internal rollout terminology', () => {
  const listed = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );
  assert.equal(listed.status, 0, listed.stderr);

  const internalRolloutLabel = new RegExp(
    ['ph', 'ase', '[\\s_-]*', '[12]'].join(''),
    'iu',
  );
  for (const path of listed.stdout.split('\0').filter(existsSync)) {
    assert.doesNotMatch(path, internalRolloutLabel, path);
    const content = readFileSync(path);
    if (!content.includes(0)) {
      assert.doesNotMatch(content.toString('utf8'), internalRolloutLabel, path);
    }
  }
});

test('production image smoke uses complete inert email and canary configuration', () => {
  assert.match(
    ciWorkflow,
    /node deploy\/materialize-application-security\.mjs/u,
  );
  assert.match(
    ciWorkflow,
    /sudo stat -c '%u:%g' "\$GITHUB_WORKSPACE\/tmp\/ci-application-security"/u,
  );
  assert.match(
    ciWorkflow,
    /sudo stat -c '%a' "\$GITHUB_WORKSPACE\/tmp\/ci-application-security"/u,
  );
  assert.match(
    ciWorkflow,
    /sudo stat -c '%u:%g' "\$GITHUB_WORKSPACE\/tmp\/ci-application-security\/current\/\$file"/u,
  );
  assert.match(
    ciWorkflow,
    /sudo stat -c '%a' "\$GITHUB_WORKSPACE\/tmp\/ci-application-security\/current\/\$file"/u,
  );
  assert.doesNotMatch(ciWorkflow, /"\$\(stat -c/u);
  assert.match(ciWorkflow, /docker restart chalkboard-ci/u);
  assert.match(ciWorkflow, /"material":"materialized"/u);
  for (const name of [
    'admission-hmac-key',
    'admission-hmac-key-generation',
    'turnstile-secret',
    'resend-api-key',
    'resend-webhook-secret',
  ]) {
    assert.match(
      ciWorkflow,
      new RegExp(`${name}:/run/secrets/${name}:ro`, 'u'),
    );
  }
  // The parser refuses to start when any SES setting is present.
  assert.doesNotMatch(
    ciWorkflow,
    /-e (?:AWS_REGION|EMAIL_CONFIGURATION_SET|SES_FEEDBACK_TOPIC_ARN|SNS_CONFIRM_SUBSCRIPTION)=/u,
  );
  for (const setting of [
    'ACCOUNT_REGISTRATION_LIMIT',
    'EMAIL_DAILY_SEND_LIMIT',
    'EMAIL_FROM',
    'EMAIL_MONTHLY_SEND_LIMIT',
    'EMAIL_REPLY_TO',
    'TURNSTILE_SITE_KEY',
  ]) {
    assert.equal(
      [...ciWorkflow.matchAll(new RegExp(`-e ${setting}=`, 'gu'))].length,
      2,
      `${setting} must be present on both production server invocations`,
    );
  }
});

test('production Compose starts below immutable account and send hard caps', () => {
  assert.match(
    compose,
    /ACCOUNT_REGISTRATION_LIMIT: \$\{ACCOUNT_REGISTRATION_LIMIT:-10\}/u,
  );
  assert.match(
    compose,
    /EMAIL_DAILY_SEND_LIMIT: \$\{EMAIL_DAILY_SEND_LIMIT:-10\}/u,
  );
  assert.match(
    compose,
    /EMAIL_MONTHLY_SEND_LIMIT: \$\{EMAIL_MONTHLY_SEND_LIMIT:-100\}/u,
  );
});

test('only the server receives five read-only materialized files', () => {
  const serverStart = compose.indexOf('  server:');
  const webStart = compose.indexOf('  web:', serverStart);
  const server = compose.slice(serverStart, webStart);
  for (const name of [
    'admission-hmac-key',
    'admission-hmac-key-generation',
    'turnstile-secret',
    'resend-api-key',
    'resend-webhook-secret',
  ]) {
    assert.match(
      server,
      new RegExp(`current/${name}:/run/secrets/${name}:ro`, 'u'),
    );
    assert.equal(
      compose.match(new RegExp(`:/run/secrets/${name}:ro`, 'gu'))?.length,
      1,
    );
  }
  assert.doesNotMatch(
    server,
    /(?:TURNSTILE_SECRET|ADMISSION_HMAC_KEY|RESEND_API_KEY|RESEND_WEBHOOK_SECRET)\s*:/u,
  );
  // Every SES setting must be gone from the production environment.
  assert.doesNotMatch(
    server,
    /(?:AWS_REGION|EMAIL_CONFIGURATION_SET|SES_FEEDBACK_TOPIC_ARN|SNS_CONFIRM_SUBSCRIPTION):/u,
  );
});
