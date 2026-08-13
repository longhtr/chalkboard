#!/usr/bin/env node
/**
 * Atomically materializes one complete application-security cache from values
 * resolved only inside an asm-exec child process. It never prints secret data.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fchownSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const FILE_NAMES = {
  admissionKey: 'admission-hmac-key',
  generation: 'admission-hmac-key-generation',
  turnstileSecret: 'turnstile-secret',
};

function fail(message) {
  throw new Error(`Application security materialization failed: ${message}`);
}

function parseInteger(value, label, minimum, maximum) {
  if (!/^\d+$/u.test(value ?? '')) fail(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${label} is outside the permitted range`);
  }
  return parsed;
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      value === undefined ||
      ![
        '--cache-dir',
        '--generation',
        '--runtime-gid',
        '--runtime-uid',
      ].includes(key)
    ) {
      fail(
        'expected --cache-dir, --generation, --runtime-uid, and --runtime-gid',
      );
    }
    if (values.has(key)) fail(`duplicate ${key} argument`);
    values.set(key, value);
  }
  if (values.size !== 4) fail('all materialization arguments are required');
  const cacheDir = values.get('--cache-dir');
  if (cacheDir === undefined || !isAbsolute(cacheDir)) {
    fail('cache directory must be absolute');
  }
  return {
    cacheDir: resolve(cacheDir),
    generation: parseInteger(
      values.get('--generation'),
      'admission key generation',
      1,
      2_147_483_647,
    ),
    runtimeGid: parseInteger(
      values.get('--runtime-gid'),
      'runtime GID',
      0,
      2_147_483_647,
    ),
    runtimeUid: parseInteger(
      values.get('--runtime-uid'),
      'runtime UID',
      0,
      2_147_483_647,
    ),
  };
}

function validateMaterial(environment) {
  const admissionKey = environment.CHALKBOARD_MATERIALIZED_ADMISSION_HMAC_KEY;
  const turnstileSecret = environment.CHALKBOARD_MATERIALIZED_TURNSTILE_SECRET;
  if (
    admissionKey === undefined ||
    admissionKey.length < 43 ||
    admissionKey.length > 512 ||
    !/^[A-Za-z0-9_-]+$/u.test(admissionKey) ||
    Buffer.from(admissionKey, 'base64url').byteLength < 32
  ) {
    fail('admission HMAC material is invalid');
  }
  if (
    turnstileSecret === undefined ||
    turnstileSecret.length < 8 ||
    turnstileSecret.length > 2_048 ||
    /[\0\r\n]/u.test(turnstileSecret)
  ) {
    fail('Turnstile material is invalid');
  }
  return {
    admissionKey: Buffer.from(admissionKey, 'utf8'),
    turnstileSecret: Buffer.from(turnstileSecret, 'utf8'),
  };
}

function ensureOwnedPrivateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700, recursive: true });
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail('cache path must be a real directory');
  }
  if (metadata.uid !== process.geteuid?.()) {
    fail('cache directory has the wrong owner');
  }
  chmodSync(path, 0o700);
}

function syncDirectory(path) {
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writePrivateFile(path, value, runtimeUid, runtimeGid) {
  const descriptor = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, value);
    fchownSync(descriptor, runtimeUid, runtimeGid);
    fchmodSync(descriptor, 0o600);
    // Flush data and the final ownership/mode metadata before this staged file
    // can participate in a durable release-directory rename.
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function safeEqual(left, right) {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function currentRelease(cacheDir) {
  const currentPath = join(cacheDir, 'current');
  if (!existsSync(currentPath)) return null;
  const metadata = lstatSync(currentPath);
  if (!metadata.isSymbolicLink()) return null;
  const target = readlinkSync(currentPath);
  if (isAbsolute(target)) fail('current cache link must be relative');
  const resolvedTarget = realpathSync(currentPath);
  const releaseRoot = realpathSync(join(cacheDir, 'releases'));
  if (
    resolvedTarget !== releaseRoot &&
    !resolvedTarget.startsWith(`${releaseRoot}${sep}`)
  ) {
    fail('current cache link escapes the release directory');
  }
  return resolvedTarget;
}

function privateFileMatches(path, expected, runtimeUid, runtimeGid) {
  try {
    const metadata = statSync(path);
    return (
      metadata.isFile() &&
      metadata.uid === runtimeUid &&
      metadata.gid === runtimeGid &&
      (metadata.mode & 0o077) === 0 &&
      safeEqual(readFileSync(path), expected)
    );
  } catch {
    return false;
  }
}

function validateAdmissionGenerationTransition(options, material) {
  const release = currentRelease(options.cacheDir);
  if (release === null) return;
  const generationPath = join(release, FILE_NAMES.generation);
  const keyPath = join(release, FILE_NAMES.admissionKey);
  for (const path of [generationPath, keyPath]) {
    const metadata = statSync(path);
    if (
      !metadata.isFile() ||
      metadata.size > 4_096 ||
      metadata.uid !== options.runtimeUid ||
      metadata.gid !== options.runtimeGid ||
      (metadata.mode & 0o077) !== 0
    ) {
      fail('current admission material is not safely readable');
    }
  }
  const currentGeneration = parseInteger(
    readFileSync(generationPath, 'utf8'),
    'current admission key generation',
    1,
    2_147_483_647,
  );
  const currentKey = readFileSync(keyPath);
  const sameKey = safeEqual(currentKey, material.admissionKey);
  if (options.generation < currentGeneration) {
    fail('admission key generation cannot decrease');
  }
  if (options.generation === currentGeneration && !sameKey) {
    fail('admission key change requires a new generation');
  }
  if (options.generation > currentGeneration && sameKey) {
    fail('new admission key generation requires new key material');
  }
}

function alreadyCurrent(options, material) {
  const release = currentRelease(options.cacheDir);
  if (release === null) return false;
  return (
    privateFileMatches(
      join(release, FILE_NAMES.admissionKey),
      material.admissionKey,
      options.runtimeUid,
      options.runtimeGid,
    ) &&
    privateFileMatches(
      join(release, FILE_NAMES.generation),
      Buffer.from(String(options.generation), 'utf8'),
      options.runtimeUid,
      options.runtimeGid,
    ) &&
    privateFileMatches(
      join(release, FILE_NAMES.turnstileSecret),
      material.turnstileSecret,
      options.runtimeUid,
      options.runtimeGid,
    )
  );
}

function activateRelease(cacheDir, releasePath) {
  const currentPath = join(cacheDir, 'current');
  const nextPath = join(cacheDir, `.current-${randomUUID()}`);
  const relativeTarget = relative(cacheDir, releasePath);
  symlinkSync(relativeTarget, nextPath, 'dir');
  try {
    if (existsSync(currentPath) && !lstatSync(currentPath).isSymbolicLink()) {
      // Docker can create this directory when the first deployment intentionally
      // starts without material. Preserve it rather than deleting anything.
      renameSync(
        currentPath,
        join(cacheDir, `unmaterialized-${Date.now()}-${randomUUID()}`),
      );
    }
    renameSync(nextPath, currentPath);
    syncDirectory(cacheDir);
  } finally {
    rmSync(nextPath, { force: true });
  }
}

function pruneInactiveReleases(releasesDir, activeRelease) {
  let changed = false;
  for (const name of readdirSync(releasesDir)) {
    const path = join(releasesDir, name);
    const metadata = lstatSync(path);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      !/^(?:release-|\.staging-)[A-Za-z0-9-]+$/u.test(name)
    ) {
      fail('release directory contains an unexpected entry');
    }
    if (activeRelease !== null && realpathSync(path) === activeRelease) {
      continue;
    }
    rmSync(path, { force: true, recursive: true });
    changed = true;
  }
  if (changed) syncDirectory(releasesDir);
}

function materialize(options, material) {
  ensureOwnedPrivateDirectory(options.cacheDir);
  const releasesDir = join(options.cacheDir, 'releases');
  ensureOwnedPrivateDirectory(releasesDir);
  validateAdmissionGenerationTransition(options, material);
  if (alreadyCurrent(options, material)) {
    process.stdout.write('Application security cache is already current.\n');
    return;
  }

  if (
    process.geteuid?.() !== 0 &&
    (options.runtimeUid !== process.geteuid?.() ||
      options.runtimeGid !== process.getegid?.())
  ) {
    fail('only root may materialize files for another runtime identity');
  }

  // Retain only the active release before staging. After activation that active
  // release becomes the single rollback target, so repeated approved rotations
  // cannot grow this root-owned cache without bound. Validation above runs
  // first, and a later failure never changes the active symlink or its files.
  pruneInactiveReleases(releasesDir, currentRelease(options.cacheDir));

  const identifier = `${Date.now()}-${randomUUID()}`;
  const stagingPath = join(releasesDir, `.staging-${identifier}`);
  const releasePath = join(releasesDir, `release-${identifier}`);
  mkdirSync(stagingPath, { mode: 0o700 });
  try {
    writePrivateFile(
      join(stagingPath, FILE_NAMES.admissionKey),
      material.admissionKey,
      options.runtimeUid,
      options.runtimeGid,
    );
    writePrivateFile(
      join(stagingPath, FILE_NAMES.generation),
      Buffer.from(String(options.generation), 'utf8'),
      options.runtimeUid,
      options.runtimeGid,
    );
    writePrivateFile(
      join(stagingPath, FILE_NAMES.turnstileSecret),
      material.turnstileSecret,
      options.runtimeUid,
      options.runtimeGid,
    );
    syncDirectory(stagingPath);
    renameSync(stagingPath, releasePath);
    syncDirectory(releasesDir);
    activateRelease(options.cacheDir, releasePath);
  } catch (error) {
    rmSync(stagingPath, { force: true, recursive: true });
    throw error;
  }
  process.stdout.write('Application security cache was atomically updated.\n');
}

try {
  const options = parseArguments(process.argv.slice(2));
  const material = validateMaterial(process.env);
  materialize(options, material);
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
