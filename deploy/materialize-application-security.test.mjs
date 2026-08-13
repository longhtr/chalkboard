/** Tests atomic secret-cache creation, no-op refresh, rotation, failure preservation, permissions, and resolver pinning. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { afterEach, test } from 'node:test';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const deployDirectory = resolve('deploy');
const materializer = join(
  deployDirectory,
  'materialize-application-security.mjs',
);
const roots = [];
const admissionKey = Buffer.alloc(36, 7).toString('base64url');
const rotatedAdmissionKey = Buffer.alloc(36, 9).toString('base64url');
const turnstileSecret = 'test-only-turnstile-secret';

function root() {
  const parent = resolve('tmp/materializer-tests');
  mkdirSync(parent, { mode: 0o700, recursive: true });
  const path = mkdtempSync(join(parent, 'case-'));
  roots.push(path);
  return path;
}

function runMaterializer(cacheDir, options = {}) {
  const generation = options.generation ?? 1;
  const result = spawnSync(
    process.execPath,
    [
      materializer,
      '--cache-dir',
      cacheDir,
      '--generation',
      String(generation),
      '--runtime-uid',
      String(options.runtimeUid ?? process.getuid()),
      '--runtime-gid',
      String(options.runtimeGid ?? process.getgid()),
    ],
    {
      encoding: 'utf8',
      env: {
        CHALKBOARD_MATERIALIZED_ADMISSION_HMAC_KEY:
          options.admissionKey ?? admissionKey,
        CHALKBOARD_MATERIALIZED_TURNSTILE_SECRET:
          options.turnstileSecret ?? turnstileSecret,
        PATH: process.env.PATH,
      },
    },
  );
  assert.doesNotMatch(result.stdout, /test-only|BwcHBwcH/u);
  assert.doesNotMatch(result.stderr, /test-only|BwcHBwcH/u);
  return result;
}

function currentTarget(cacheDir) {
  return readlinkSync(join(cacheDir, 'current'));
}

function currentFile(cacheDir, name) {
  return join(cacheDir, 'current', name);
}

function copyResolverControls(destination) {
  mkdirSync(destination, { mode: 0o700 });
  for (const name of [
    'asm-exec',
    'asm-exec.sha256',
    'materialize-application-security.mjs',
    'refresh-application-security.sh',
  ]) {
    cpSync(join(deployDirectory, name), join(destination, name));
  }
}

function installFakeResolver(directory, source) {
  const resolver = join(directory, 'asm-exec');
  writeFileSync(resolver, source, { mode: 0o700 });
  chmodSync(resolver, 0o700);
  const digest = createHash('sha256').update(source).digest('hex');
  writeFileSync(join(directory, 'asm-exec.sha256'), `${digest}  asm-exec\n`, {
    mode: 0o600,
  });
}

function runRefresh(directory, cacheDir, generation = 1) {
  return spawnSync(
    join(directory, 'refresh-application-security.sh'),
    [
      'arn:aws:secretsmanager:ap-southeast-1:000000000000:secret:test-abcdef',
      'ap-southeast-1',
      cacheDir,
      String(generation),
      String(process.getuid()),
      String(process.getgid()),
    ],
    { encoding: 'utf8', env: { HOME: directory, PATH: process.env.PATH } },
  );
}

afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

test('atomically creates one complete private cache and makes identical refresh a no-op', () => {
  const cacheDir = join(root(), 'cache');
  const first = runMaterializer(cacheDir, { generation: 3 });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /atomically updated/u);
  assert.equal(lstatSync(join(cacheDir, 'current')).isSymbolicLink(), true);
  const target = currentTarget(cacheDir);
  assert.equal(
    readFileSync(currentFile(cacheDir, 'admission-hmac-key'), 'utf8'),
    admissionKey,
  );
  assert.equal(
    readFileSync(
      currentFile(cacheDir, 'admission-hmac-key-generation'),
      'utf8',
    ),
    '3',
  );
  assert.equal(
    readFileSync(currentFile(cacheDir, 'turnstile-secret'), 'utf8'),
    turnstileSecret,
  );
  for (const name of [
    'admission-hmac-key',
    'admission-hmac-key-generation',
    'turnstile-secret',
  ]) {
    assert.equal(statSync(currentFile(cacheDir, name)).mode & 0o077, 0);
  }
  assert.equal(statSync(cacheDir).mode & 0o077, 0);

  const second = runMaterializer(cacheDir, { generation: 3 });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already current/u);
  assert.equal(currentTarget(cacheDir), target);
});

test('rotates all files together while retaining the previous release for rollback', () => {
  const cacheDir = join(root(), 'cache');
  assert.equal(runMaterializer(cacheDir).status, 0);
  const previousTarget = currentTarget(cacheDir);
  const previousPath = join(cacheDir, previousTarget);

  const result = runMaterializer(cacheDir, {
    admissionKey: rotatedAdmissionKey,
    generation: 2,
    turnstileSecret: 'rotated-test-turnstile-secret',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(currentTarget(cacheDir), previousTarget);
  assert.equal(
    readFileSync(currentFile(cacheDir, 'admission-hmac-key'), 'utf8'),
    rotatedAdmissionKey,
  );
  assert.equal(
    readFileSync(
      currentFile(cacheDir, 'admission-hmac-key-generation'),
      'utf8',
    ),
    '2',
  );
  assert.equal(
    readFileSync(join(previousPath, 'admission-hmac-key'), 'utf8'),
    admissionKey,
  );
});

test('retains only current and previous releases across repeated rotations', () => {
  const cacheDir = join(root(), 'cache');
  assert.equal(runMaterializer(cacheDir).status, 0);
  const firstTarget = currentTarget(cacheDir);
  assert.equal(
    runMaterializer(cacheDir, {
      turnstileSecret: 'second-test-turnstile-secret',
    }).status,
    0,
  );
  const secondTarget = currentTarget(cacheDir);
  assert.notEqual(secondTarget, firstTarget);
  assert.equal(
    runMaterializer(cacheDir, {
      turnstileSecret: 'third-test-turnstile-secret',
    }).status,
    0,
  );
  const thirdTarget = currentTarget(cacheDir);
  assert.notEqual(thirdTarget, secondTarget);
  assert.deepEqual(
    readdirSync(join(cacheDir, 'releases')).sort(),
    [secondTarget.split('/').at(-1), thirdTarget.split('/').at(-1)].sort(),
  );
  assert.equal(existsSync(join(cacheDir, firstTarget)), false);
  assert.equal(existsSync(join(cacheDir, secondTarget)), true);
});

test('rejects admission-key and generation mismatches without changing current', () => {
  const cacheDir = join(root(), 'cache');
  assert.equal(runMaterializer(cacheDir).status, 0);
  const target = currentTarget(cacheDir);

  const sameGenerationNewKey = runMaterializer(cacheDir, {
    admissionKey: rotatedAdmissionKey,
    generation: 1,
  });
  assert.notEqual(sameGenerationNewKey.status, 0);
  assert.match(sameGenerationNewKey.stderr, /requires a new generation/u);

  const newGenerationSameKey = runMaterializer(cacheDir, { generation: 2 });
  assert.notEqual(newGenerationSameKey.status, 0);
  assert.match(newGenerationSameKey.stderr, /requires new key material/u);

  const lowerGeneration = runMaterializer(cacheDir, {
    admissionKey: rotatedAdmissionKey,
    generation: 2,
  });
  assert.equal(lowerGeneration.status, 0, lowerGeneration.stderr);
  const rotatedTarget = currentTarget(cacheDir);
  const rollback = runMaterializer(cacheDir, {
    admissionKey,
    generation: 1,
  });
  assert.notEqual(rollback.status, 0);
  assert.match(rollback.stderr, /cannot decrease/u);
  assert.equal(currentTarget(cacheDir), rotatedTarget);
  assert.notEqual(rotatedTarget, target);
});

test('invalid or unauthorized refresh leaves the complete current cache untouched', () => {
  const cacheDir = join(root(), 'cache');
  assert.equal(runMaterializer(cacheDir).status, 0);
  const target = currentTarget(cacheDir);

  const invalid = runMaterializer(cacheDir, { turnstileSecret: 'short' });
  assert.notEqual(invalid.status, 0);
  assert.equal(currentTarget(cacheDir), target);

  if (process.geteuid() !== 0) {
    const wrongOwner = runMaterializer(cacheDir, {
      runtimeGid: process.getgid() + 1,
      runtimeUid: process.getuid() + 1,
    });
    assert.notEqual(wrongOwner.status, 0);
    assert.equal(currentTarget(cacheDir), target);
  }
});

test('replaces a Docker-created unmaterialized directory without deleting it', () => {
  const cacheDir = join(root(), 'cache');
  const placeholder = join(cacheDir, 'current');
  mkdirSync(placeholder, { mode: 0o700, recursive: true });
  mkdirSync(join(placeholder, 'admission-hmac-key'));
  const result = runMaterializer(cacheDir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lstatSync(join(cacheDir, 'current')).isSymbolicLink(), true);
  assert.equal(
    statSync(cacheDir).mode & 0o077,
    0,
    'cache root must remain owner-only',
  );
});

test('wrapper survives a fresh process and preserves current after partial resolution failure', () => {
  const testRoot = root();
  const copiedDeploy = join(testRoot, 'deploy');
  const cacheDir = join(testRoot, 'cache');
  copyResolverControls(copiedDeploy);
  installFakeResolver(
    copiedDeploy,
    `#!/bin/sh
set -eu
[ "$1" = "--" ]
shift
case "$CHALKBOARD_MATERIALIZED_ADMISSION_HMAC_KEY" in
  '{{resolve:secretsmanager:'*) ;;
  *) exit 20 ;;
esac
case "$CHALKBOARD_MATERIALIZED_TURNSTILE_SECRET" in
  '{{resolve:secretsmanager:'*) ;;
  *) exit 21 ;;
esac
export CHALKBOARD_MATERIALIZED_ADMISSION_HMAC_KEY='${admissionKey}'
export CHALKBOARD_MATERIALIZED_TURNSTILE_SECRET='${turnstileSecret}'
exec "$@"
`,
  );

  const first = runRefresh(copiedDeploy, cacheDir);
  assert.equal(first.status, 0, first.stderr);
  const target = currentTarget(cacheDir);
  const restarted = runRefresh(copiedDeploy, cacheDir);
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.match(restarted.stdout, /already current/u);
  assert.equal(currentTarget(cacheDir), target);

  installFakeResolver(copiedDeploy, '#!/bin/sh\nexit 19\n');
  const failed = runRefresh(copiedDeploy, cacheDir);
  assert.equal(failed.status, 19);
  assert.equal(currentTarget(cacheDir), target);
  assert.equal(
    readFileSync(currentFile(cacheDir, 'turnstile-secret'), 'utf8'),
    turnstileSecret,
  );
});

test('restored old cache rotates stale provider material without changing the admission generation', () => {
  const testRoot = root();
  const cacheDir = join(testRoot, 'cache');
  const restoredCacheDir = join(testRoot, 'restored-cache');
  assert.equal(runMaterializer(cacheDir).status, 0);
  cpSync(cacheDir, restoredCacheDir, {
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  });

  const restoredTarget = currentTarget(restoredCacheDir);
  const unchanged = runMaterializer(restoredCacheDir);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /already current/u);
  assert.equal(currentTarget(restoredCacheDir), restoredTarget);

  const refreshed = runMaterializer(restoredCacheDir, {
    turnstileSecret: 'snapshot-recovery-turnstile-secret',
  });
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.notEqual(currentTarget(restoredCacheDir), restoredTarget);
  assert.equal(
    readFileSync(
      currentFile(restoredCacheDir, 'admission-hmac-key-generation'),
      'utf8',
    ),
    '1',
  );
});

test('revokes and restores one retained release through an atomic relative link', () => {
  const cacheDir = join(root(), 'cache');
  assert.equal(runMaterializer(cacheDir).status, 0);
  const target = currentTarget(cacheDir);
  const current = join(cacheDir, 'current');
  const revoked = join(cacheDir, 'revoked-test');
  renameSync(current, revoked);
  assert.equal(existsSync(current), false);

  const next = join(cacheDir, '.current-rollback-test');
  symlinkSync(target, next, 'dir');
  renameSync(next, current);
  assert.equal(currentTarget(cacheDir), target);
  assert.equal(
    readFileSync(currentFile(cacheDir, 'admission-hmac-key'), 'utf8'),
    admissionKey,
  );
});

test('resolver wrapper refuses a modified pinned asm-exec before resolution', () => {
  const testRoot = root();
  const copiedDeploy = join(testRoot, 'deploy');
  copyResolverControls(copiedDeploy);
  const copiedResolver = join(copiedDeploy, 'asm-exec');
  writeFileSync(copiedResolver, '\n# modified\n', { flag: 'a' });
  chmodSync(copiedResolver, 0o755);
  const result = spawnSync(
    join(copiedDeploy, 'refresh-application-security.sh'),
    [
      'arn:aws:secretsmanager:ap-southeast-1:000000000000:secret:test-abcdef',
      'ap-southeast-1',
      join(testRoot, 'cache'),
      '1',
      String(process.getuid()),
      String(process.getgid()),
    ],
    { encoding: 'utf8', env: { HOME: testRoot, PATH: process.env.PATH } },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum verification failed/u);
  assert.equal(lstatSync(copiedResolver).isFile(), true);
});
