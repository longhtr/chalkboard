/** Proves runtime security files must be bounded, regular, owner-only, complete, and decodable. */
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadApplicationSecurityMaterial } from './applicationSecurity.js';

const roots: string[] = [];

async function material(mode = 0o600) {
  const parent = resolve('tmp/application-security-tests');
  await mkdir(parent, { mode: 0o700, recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  roots.push(root);
  const admissionKeyFile = join(root, 'admission-key');
  const admissionKeyGenerationFile = join(root, 'admission-key-generation');
  const turnstileSecretFile = join(root, 'turnstile-secret');
  await writeFile(admissionKeyFile, Buffer.alloc(32, 7).toString('base64url'), {
    mode,
  });
  await writeFile(admissionKeyGenerationFile, '2', { mode });
  await writeFile(turnstileSecretFile, 'test-only-turnstile-value', { mode });
  return {
    admissionKeyFile,
    admissionKeyGenerationFile,
    turnstileSecretFile,
    turnstileSiteKey: 'public-test-site-key',
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('application security materialization', () => {
  it('loads complete owner-only files without returning source paths', async () => {
    const configuration = await material();
    expect(loadApplicationSecurityMaterial(configuration)).toEqual({
      admissionKey: Buffer.alloc(32, 7),
      admissionKeyGeneration: 2,
      turnstileSecret: 'test-only-turnstile-value',
    });
  });

  it('fails closed when the active cache is revoked and recovers from a retained release', async () => {
    const configuration = await material();
    const activeDirectory = resolve(configuration.admissionKeyFile, '..');
    const retainedDirectory = `${activeDirectory}-retained`;
    await rename(activeDirectory, retainedDirectory);
    roots.push(retainedDirectory);
    expect(loadApplicationSecurityMaterial(configuration)).toBeNull();
    await symlink(retainedDirectory, activeDirectory, 'dir');
    expect(loadApplicationSecurityMaterial(configuration)).toMatchObject({
      admissionKeyGeneration: 2,
      turnstileSecret: 'test-only-turnstile-value',
    });
  });

  it('fails closed for absent, group-readable, short, or oversized files', async () => {
    expect(loadApplicationSecurityMaterial(null)).toBeNull();

    const groupReadable = await material(0o640);
    expect(loadApplicationSecurityMaterial(groupReadable)).toBeNull();

    const short = await material();
    await writeFile(short.admissionKeyFile, 'short', { mode: 0o600 });
    expect(loadApplicationSecurityMaterial(short)).toBeNull();

    const malformedGeneration = await material();
    await writeFile(
      malformedGeneration.admissionKeyGenerationFile,
      'not-a-generation',
      { mode: 0o600 },
    );
    expect(loadApplicationSecurityMaterial(malformedGeneration)).toBeNull();

    const oversized = await material();
    await writeFile(oversized.turnstileSecretFile, 'x'.repeat(4_097), {
      mode: 0o600,
    });
    expect(loadApplicationSecurityMaterial(oversized)).toBeNull();
  });
});
