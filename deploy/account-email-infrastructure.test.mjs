/** Guards account-email infrastructure, resolver pinning, exact permissions, and server-only secret mounts. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const templatePath = resolve('deploy/ses-feedback.yaml');
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

test('retained secret generates only admission material and grants exact read access', () => {
  const secret = resourceBlock(
    'ApplicationSecuritySecret',
    'TransactionalConfigurationSet',
  );
  assert.match(secret, /Type: AWS::SecretsManager::Secret/u);
  assert.match(secret, /DeletionPolicy: Retain/u);
  assert.match(secret, /UpdateReplacePolicy: Retain/u);
  assert.match(secret, /GenerateStringKey: admissionHmacKey/u);
  assert.match(secret, /PasswordLength: 48/u);
  assert.doesNotMatch(secret, /KmsKeyId:/u);

  const policy = resourceBlock('ApplicationRuntimePolicy', 'FeedbackTopic');
  assert.match(policy, /^\s+PolicyName: account-email$/mu);
  assert.match(policy, /Action: secretsmanager:GetSecretValue/u);
  assert.match(policy, /Action: ses:SendEmail/u);
  assert.doesNotMatch(
    policy,
    /(?:ListSecrets|PutSecretValue|DeleteSecret|TagResource|UntagResource|RotateSecret|GetAccount|Resource:\s*['"]?\*)/u,
  );
  const identityStatement = policy.match(
    /- Sid: SendOnlyFromApprovedIdentityAndAddress(?<statement>[\s\S]*?)(?=\n\s+- Sid: UseOnlyApprovedConfigurationSet)/u,
  )?.groups?.statement;
  assert.ok(identityStatement, 'missing identity-scoped SES send statement');
  assert.match(identityStatement, /Action: ses:SendEmail/u);
  assert.match(identityStatement, /identity\/\$\{SendingIdentityDomain\}/u);
  assert.doesNotMatch(identityStatement, /configuration-set\//u);
  assert.match(identityStatement, /^\s+StringEquals:$/mu);
  assert.match(
    identityStatement,
    /ses:FromAddress: support@chalkboard\.space/u,
  );
  assert.doesNotMatch(identityStatement, /IfExists/u);

  const configurationSetStatement = policy.match(
    /- Sid: UseOnlyApprovedConfigurationSet(?<statement>[\s\S]*?)(?=\n\s+- !If)/u,
  )?.groups?.statement;
  assert.ok(
    configurationSetStatement,
    'missing configuration-set-scoped SES send statement',
  );
  assert.match(configurationSetStatement, /Action: ses:SendEmail/u);
  assert.match(
    configurationSetStatement,
    /configuration-set\/\$\{TransactionalConfigurationSet\}/u,
  );
  assert.doesNotMatch(configurationSetStatement, /identity\//u);
  assert.doesNotMatch(configurationSetStatement, /Condition:/u);

  const sandboxRecipientStatement = policy.match(
    /- !If\n\s+- IncludeSandboxRecipient\n\s+- Sid: UseOnlyVerifiedSandboxRecipient(?<statement>[\s\S]*)/u,
  )?.groups?.statement;
  assert.ok(
    sandboxRecipientStatement,
    'missing conditional exact sandbox-recipient SES send statement',
  );
  assert.match(sandboxRecipientStatement, /Action: ses:SendEmail/u);
  assert.match(
    sandboxRecipientStatement,
    /identity\/\$\{SandboxRecipientEmailIdentity\}/u,
  );
  assert.match(sandboxRecipientStatement, /^\s+StringEquals:$/mu);
  assert.match(
    sandboxRecipientStatement,
    /ses:FromAddress: support@chalkboard\.space/u,
  );
  assert.match(sandboxRecipientStatement, /- !Ref AWS::NoValue/u);
  assert.doesNotMatch(sandboxRecipientStatement, /identity\/\*/u);
  assert.doesNotMatch(sandboxRecipientStatement, /IfExists/u);

  assert.match(
    template,
    /SandboxRecipientEmailIdentity:\s*\n\s*Type: String[\s\S]*?Default: ''\s*\n\s*MaxLength: 320\s*\n\s*NoEcho: true/u,
  );
  const sandboxParameter = template.match(
    /SandboxRecipientEmailIdentity:(?<parameter>[\s\S]*?)(?=\n\s{2}\w)/u,
  )?.groups?.parameter;
  assert.ok(sandboxParameter, 'missing sandbox recipient parameter');
  assert.doesNotMatch(sandboxParameter, /\[\^\/@\\s\]/u);
  assert.doesNotMatch(sandboxParameter, /[*?]/u);
  assert.match(template, /IncludeSandboxRecipient: !Not/u);
  assert.doesNotMatch(policy, /Effect: Deny/u);
  assert.doesNotMatch(policy, /StringNotEqualsIfExists/u);
  assert.doesNotMatch(policy, /identity\/\*/u);
});

test('existing root identity, approved sender, MAIL FROM outputs, and tracking controls are explicit', () => {
  const configurationSet = resourceBlock(
    'TransactionalConfigurationSet',
    'ApplicationRuntimePolicy',
  );
  assert.match(configurationSet, /^\s+Name: !Ref AWS::StackName$/mu);
  assert.match(configurationSet, /EngagementMetrics: DISABLED/u);
  assert.match(configurationSet, /OptimizedSharedDelivery: DISABLED/u);
  assert.doesNotMatch(configurationSet, /TrackingOptions:/u);

  assert.doesNotMatch(template, /Type: AWS::SES::EmailIdentity/u);
  assert.match(
    template,
    /SendingIdentityDomain:\s*\n\s*Type: String\s*\n\s*AllowedValues:\s*\n\s*- chalkboard\.space\s*\n\s*Default: chalkboard\.space/u,
  );
  assert.doesNotMatch(template, /TransactionalIdentityDomain/u);
  assert.match(template, /Value: Chalkboard <support@chalkboard\.space>/u);
  assert.match(template, /Value: support@chalkboard\.space/u);
  assert.match(template, /Value: !Sub 'mail\.\$\{SendingIdentityDomain\}'/u);
  assert.match(operations, /--behavior-on-mx-failure REJECT_MESSAGE/u);
  assert.match(operations, /--no-email-forwarding-enabled/u);
  assert.match(
    operations,
    /existing verified `chalkboard\.space` SES identity/u,
  );
  assert.match(operations, /`mail\.chalkboard\.space`/u);
  for (const output of [
    'ApprovedEmailFrom',
    'ApprovedEmailReplyTo',
    'MailFromMxName',
    'MailFromMxValue',
    'MailFromSpfName',
    'MailFromSpfValue',
    'SendingIdentityArn',
  ]) {
    assert.match(template, new RegExp(`  ${output}:`, 'u'));
  }
  assert.doesNotMatch(template, /DkimRecord(?:Name|Value)[123]:/u);
});

test('feedback policy has exact confused-deputy conditions and excludes engagement events', () => {
  const topicPolicy = resourceBlock(
    'FeedbackTopicPolicy',
    'FeedbackEventDestination',
  );
  assert.match(topicPolicy, /Principal:\s*\n\s*Service: ses\.amazonaws\.com/u);
  assert.match(topicPolicy, /aws:SourceAccount: !Ref AWS::AccountId/u);
  assert.match(
    topicPolicy,
    /configuration-set\/\$\{TransactionalConfigurationSet\}/u,
  );

  const destination = resourceBlock(
    'FeedbackEventDestination',
    'FeedbackSubscription',
  );
  for (const event of [
    'SEND',
    'REJECT',
    'BOUNCE',
    'COMPLAINT',
    'DELIVERY',
    'RENDERING_FAILURE',
    'DELIVERY_DELAY',
  ]) {
    assert.match(destination, new RegExp(`- ${event}`, 'u'));
  }
  assert.doesNotMatch(destination, /- (?:OPEN|CLICK)/u);
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
  assert.doesNotMatch(refresh, /get-secret-value|batch-get-secret-value/u);
});

test('legacy feedback policy is retired only after replacement evidence', () => {
  const start = operations.indexOf('## Controlled SES evidence');
  const end = operations.indexOf('## Emergency stop', start);
  const controlled = operations.slice(start, end);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(controlled, /replacement operator notification are proven/u);
  assert.match(controlled, /inventory the old feedback topic/u);
  assert.match(
    controlled,
    /If any part is shared, preserve the shared resource/u,
  );
  assert.match(controlled, /replace the broad legacy policy/u);
  assert.match(controlled, /Do not proceed to the appeal/u);
});

test('controlled SES evidence uses application-correlated simulator intents without opening registration', () => {
  const start = operations.indexOf('## Controlled SES evidence');
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
  assert.match(
    controlled,
    /external simulator message has no application intent/u,
  );
  assert.match(controlled, /cannot prove destination suppression/u);
  assert.match(
    controlled,
    /Keep all three database email-flow switches false/u,
  );
  assert.match(controlled, /Do not enable registration/u);
  assert.doesNotMatch(controlled, /temporarily enable registration/u);
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
  const ownershipStart = operations.indexOf('## HTTPS feedback ownership');
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
  assert.match(
    preparation,
    /configuration set must also be named `chalkboard-account-email`/u,
  );
  assert.match(preparation, /inline policy .* named `account-email`/u);
  assert.match(preparation, /Replace the existing SPF record/u);
  assert.match(preparation, /rather than adding a second SPF record/u);
  assert.match(preparation, /five existing registrar-forwarding MX records/u);
  assert.match(preparation, /do not yet publish/u);
  assert.match(
    preparation,
    /Keep the previous broad `ses-send` inline policy/u,
  );
  assert.match(preparation, /while the old production server is running/u);

  const cutover = operations.slice(cutoverStart, ownershipStart);
  assert.match(cutover, /edge remains closed/u);
  assert.match(cutover, /replacement has passed private checks/u);
  assert.match(cutover, /remove the old broad `ses-send` inline policy/u);
  assert.match(cutover, /no runtime `ses:GetAccount` or wildcard SES grant/u);
  assert.match(cutover, /before relying on the new MX path/u);
  assert.match(cutover, /Never remove this policy earlier/u);
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
  ]) {
    assert.match(
      ciWorkflow,
      new RegExp(`${name}:/run/secrets/${name}:ro`, 'u'),
    );
  }
  for (const setting of [
    'ACCOUNT_REGISTRATION_LIMIT',
    'AWS_REGION',
    'EMAIL_CONFIGURATION_SET',
    'EMAIL_DAILY_SEND_LIMIT',
    'EMAIL_FROM',
    'EMAIL_MONTHLY_SEND_LIMIT',
    'EMAIL_REPLY_TO',
    'SES_FEEDBACK_TOPIC_ARN',
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

test('only the server receives three read-only materialized files', () => {
  const serverStart = compose.indexOf('  server:');
  const webStart = compose.indexOf('  web:', serverStart);
  const server = compose.slice(serverStart, webStart);
  for (const name of [
    'admission-hmac-key',
    'admission-hmac-key-generation',
    'turnstile-secret',
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
  assert.doesNotMatch(server, /(?:TURNSTILE_SECRET|ADMISSION_HMAC_KEY)\s*:/u);
});
