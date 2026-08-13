/** Locks repository-wide diagnostic usefulness, redaction, and documentation ownership. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { test } from 'node:test';

function filesBelow(root, extensions) {
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...filesBelow(path, extensions));
    else if (extensions.has(extname(entry.name))) output.push(path);
  }
  return output;
}

const serverSources = filesBelow(resolve('apps/server/src'), new Set(['.ts']))
  .filter((path) => !path.endsWith('.test.ts'))
  .filter((path) => !path.endsWith('.fixture.ts'));
const webSources = filesBelow(resolve('apps/web/src'), new Set(['.ts', '.tsx']))
  .filter((path) => !path.endsWith('.test.ts'))
  .filter((path) => !path.endsWith('.test.tsx'));
const trackedDocumentation = [
  resolve('README.md'),
  ...filesBelow(resolve('docs'), new Set(['.md'])),
  ...filesBelow(resolve('deploy'), new Set(['.md'])),
];

function combined(paths) {
  return paths
    .map((path) => `\n/* ${path} */\n${readFileSync(path, 'utf8')}`)
    .join('');
}

test('the removed account-email implementation ledger stays absent and unreferenced', () => {
  assert.equal(
    existsSync(resolve('docs/account-email-implementation.md')),
    false,
  );
  assert.doesNotMatch(
    combined(trackedDocumentation),
    /account-email-implementation\.md|requirement-to-source ledger|implementation ledger/u,
  );
});

test('server failures use bounded diagnostics instead of raw error logging', () => {
  const source = combined(serverSources);
  assert.doesNotMatch(source, /\bconsole\.error\s*\(/u);
  assert.doesNotMatch(
    source,
    /\.log\.(?:error|fatal|warn)\s*\(\s*\{\s*(?:err|error)\s*[,}:]/u,
  );
  assert.doesNotMatch(
    source,
    /catch\s*\(\s*error\s*\)\s*\{\s*await\s+(?:client|transaction)\.query\(\s*['"]ROLLBACK['"]\s*\)/u,
  );
  assert.doesNotMatch(source, /rollback\([^)]*\)\.catch\(\(\) => undefined\)/u);

  const logger = readFileSync(
    resolve('apps/server/src/operations/serverLogger.ts'),
    'utf8',
  );
  assert.match(logger, /errorKey: '__chalkboardRawErrorForbidden'/u);
  for (const field of [
    'body',
    'destination',
    'email',
    'err',
    'error',
    'message',
    'providerMessage',
    'raw',
    'token',
    'url',
  ]) {
    assert.match(logger, new RegExp(`['"]${field}['"]`, 'u'));
  }

  const application = readFileSync(resolve('apps/server/src/app.ts'), 'utf8');
  assert.match(
    application,
    /LogController\(\{ disableRequestLogging: true \}\)/u,
  );
  assert.match(
    application,
    /route: request\.routeOptions\.url \?\? 'unmatched'/u,
  );
  assert.match(application, /requestId: request\.id/u);
  assert.match(
    application,
    /logOperationalError\(request\.log, 'http\.unhandled'/u,
  );
});

test('browser failures retain only bounded redacted recovery and server correlation', () => {
  const boundary = readFileSync(
    resolve('apps/web/src/components/AppErrorBoundary.tsx'),
    'utf8',
  );
  assert.doesNotMatch(boundary, /error\.(?:message|stack)/u);
  assert.doesNotMatch(boundary, /String\(error\)/u);
  assert.match(boundary, /browserErrorDiagnostic\(error\)/u);
  assert.match(boundary, /captureBrowserErrorEvidence\(error\)/u);
  assert.match(boundary, /evidence\.fingerprint/u);

  const diagnostic = readFileSync(
    resolve('apps/web/src/components/browserErrorDiagnostics.ts'),
    'utf8',
  );
  assert.match(diagnostic, /MAX_MESSAGE_LENGTH = 2_048/u);
  assert.match(diagnostic, /MAX_STACK_FRAMES = 12/u);
  assert.match(diagnostic, /'\/boards\/:boardId'/u);
  assert.match(diagnostic, /'unmatched'/u);
  assert.match(diagnostic, /subtle\.digest/u);
  assert.match(diagnostic, /fingerprintCoversCompleteValue/u);
  assert.match(diagnostic, /messageByteLength/u);
  assert.match(diagnostic, /stackByteLength/u);

  const api = readFileSync(resolve('apps/web/src/account/api.ts'), 'utf8');
  assert.match(api, /headers\.get\('x-request-id'\)/u);
  assert.match(api, /REQUEST_ID_PATTERN/u);
  assert.match(api, /readonly requestId: string \| null/u);
});

test('external provider boundaries use complete shared diagnostics and bounded logging', () => {
  const provider = readFileSync(
    resolve('apps/server/src/operations/providerDiagnostics.ts'),
    'utf8',
  );
  for (const invariant of [
    'fingerprintCoversCompleteValue',
    'declaredByteLengthMatchesObserved',
    'utf8Valid',
    'requested-unobserved',
    'summaryOmittedAsPrivate',
    'diagnoseProviderExtraFields',
    'diagnoseProviderResponseStructure',
    'Private provider field value omitted',
    'fieldsObserved',
    'entriesObserved',
    'entriesOmitted',
    'errorCodesObserved',
    'requestIdsObserved',
  ]) {
    assert.match(provider, new RegExp(invariant, 'u'));
  }
  assert.doesNotMatch(provider, /PROVIDER_STREAM_CANCEL_TIMEOUT/u);
  assert.doesNotMatch(provider, /await\s+.*(?:cancel|Cancellation)/u);
  assert.doesNotMatch(provider, /Promise\.race\([^)]*cancel/su);
  assert.match(
    provider,
    /void reader\.cancel\(\)\.catch\(\(\) => undefined\)/u,
  );

  const operational = readFileSync(
    resolve('apps/server/src/operations/errorDiagnostics.ts'),
    'utf8',
  );
  assert.match(operational, /captureErrorSnapshot/u);
  assert.match(operational, /causeUnavailable/u);
  assert.match(operational, /aggregateErrorsComplete/u);

  const loggerTest = readFileSync(
    resolve('apps/server/src/operations/serverLogger.test.ts'),
    'utf8',
  );
  assert.match(loggerTest, /issueCode: 'invalid_type'/u);
  assert.match(loggerTest, /"issueCode":"invalid_type"/u);

  const ses = readFileSync(
    resolve('apps/server/src/accounts/verificationEmail.ts'),
    'utf8',
  );
  for (const invariant of [
    'deniedResourcesObserved',
    'deniedResourcesOmitted',
    'providerActionsObserved',
    'providerMetadata',
    'providerResponseStructure',
    'VerificationEmailAcceptanceDiagnostic',
    'providerMessageIdDiagnostic',
    'maxAttempts: 1',
  ]) {
    assert.match(ses, new RegExp(invariant, 'u'));
  }
  const workflow = readFileSync(
    resolve('apps/server/src/email/workflows.ts'),
    'utf8',
  );
  assert.match(workflow, /providerAcceptance/u);
  assert.match(workflow, /accepted-send-bookkeeping/u);

  const turnstile = readFileSync(
    resolve('apps/server/src/humanVerification/humanVerifier.ts'),
    'utf8',
  );
  for (const invariant of [
    'idempotencyKey',
    'tokenDiagnostic',
    'providerActionMatchesExpected',
    'providerHostnameMatchesExpected',
    'providerExtraFields',
    'readProviderResponseBody',
    'utf8Valid',
  ]) {
    assert.match(turnstile, new RegExp(invariant, 'u'));
  }

  const dns = readFileSync(
    resolve('apps/server/src/email/addressValidation.ts'),
    'utf8',
  );
  for (const invariant of [
    'domainDiagnostic',
    'errorExtraFields',
    'fallbackFromMx',
    'siblingOutcome',
    'resolverImplementation',
  ]) {
    assert.match(dns, new RegExp(invariant, 'u'));
  }

  const sns = readFileSync(
    resolve('apps/server/src/email/snsFeedback.ts'),
    'utf8',
  );
  for (const invariant of [
    'canonicalFieldNames',
    'envelopeValues',
    'certificateCacheHit',
    'signatureAlgorithm',
    'providerResponseStructure',
    'rootFieldsObserved',
    'mailFieldsObserved',
    'bounceFieldsObserved',
    'SesFeedbackPayloadDiagnostic',
    'parseSesFeedbackDetailed',
  ]) {
    assert.match(sns, new RegExp(invariant, 'u'));
  }

  const browserTurnstile = readFileSync(
    resolve('apps/web/src/account/turnstileBrowserDiagnostics.ts'),
    'utf8',
  );
  assert.match(browserTurnstile, /MAX_RECORDS = 20/u);
  assert.match(browserTurnstile, /cloudflare-turnstile/u);
  assert.match(browserTurnstile, /captureBrowserErrorEvidence/u);
  assert.match(browserTurnstile, /fingerprintCoversCompleteValue/u);
  assert.match(browserTurnstile, /isBrowserDiagnosticRoute/u);
  assert.match(browserTurnstile, /decodeRecord/u);
  assert.match(browserTurnstile, /at \[provider-frame\]/u);
  assert.match(browserTurnstile, /External provider operational failure/u);
  const component = readFileSync(
    resolve('apps/web/src/account/HumanVerification.tsx'),
    'utf8',
  );
  for (const stage of [
    'script-timeout',
    'missing-api',
    'provider-error',
    'provider-timeout',
    'invalid-token',
    'removal',
  ]) {
    assert.match(component, new RegExp(`['"]${stage}['"]`, 'u'));
  }

  const providerSource = combined([
    resolve('apps/server/src/accounts/verificationEmail.ts'),
    resolve('apps/server/src/humanVerification/humanVerifier.ts'),
    resolve('apps/server/src/email/addressValidation.ts'),
    resolve('apps/server/src/email/snsFeedback.ts'),
  ]);
  assert.match(providerSource, /@aws-sdk\/client-sesv2/u);
  assert.match(providerSource, /challenges\.cloudflare\.com/u);
  assert.match(providerSource, /new Resolver/u);
  assert.match(providerSource, /SigningCertURL/u);

  const allServerSource = combined(serverSources);
  const externalFetchFiles = serverSources.filter((path) =>
    /\bfetch\s*\(|fetchImplementation|fetchCertificate|fetch\?: typeof fetch/u.test(
      readFileSync(path, 'utf8'),
    ),
  );
  assert.deepEqual(
    externalFetchFiles
      .map((path) => path.replace(`${resolve('.')}\/`, ''))
      .sort(),
    [
      'apps/server/src/email/snsFeedback.ts',
      'apps/server/src/humanVerification/humanVerifier.ts',
    ],
  );
  assert.doesNotMatch(allServerSource, /providerResponse\s*:\s*read\.text/u);
});

test('operations documentation defines evidence preservation before remediation', () => {
  const operations = readFileSync(
    resolve('deploy/account-email-operations.md'),
    'utf8',
  );
  const deployment = readFileSync(resolve('deploy/README.md'), 'utf8');
  const architecture = readFileSync(resolve('docs/architecture.md'), 'utf8');
  assert.match(operations, /Provider failure evidence and diagnosis/u);
  assert.match(operations, /providerMessageFingerprint/u);
  assert.match(operations, /providerRequestId/u);
  assert.match(operations, /providerResponseTruncated/u);
  assert.match(operations, /information-preserving transformation/u);
  assert.match(operations, /requested-unobserved/u);
  assert.match(operations, /never awaited/u);
  assert.match(operations, /UTF-8/u);
  assert.match(operations, /every bounded `ses:\*` action occurrence/u);
  assert.match(operations, /accountEmailBookkeepingFailure/u);
  assert.match(operations, /chalkboard:turnstile-provider-diagnostics/u);
  assert.match(operations, /Do not recreate a container before preserving/u);
  assert.match(deployment, /Operational failure evidence/u);
  assert.match(deployment, /x-request-id/u);
  assert.match(deployment, /complete typed provider record/u);
  assert.match(deployment, /must never delay a request/u);
  assert.match(architecture, /Bounded failure evidence/u);
  assert.match(architecture, /information-preserving transformation/u);
  assert.match(architecture, /is never awaited on a user path/u);
  assert.match(architecture, /five external boundaries/u);
});
