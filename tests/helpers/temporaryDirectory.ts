/** Creates test-only temporary directories inside the repository's ignored output root. */
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve('test-results/tmp');

export async function temporaryDirectory(prefix: string): Promise<string> {
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, prefix));
}
