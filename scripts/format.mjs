#!/usr/bin/env node

/**
 * Formats or checks every tracked and untracked source file.
 *
 * Prettier expands a directory argument by walking the filesystem before it
 * applies `.prettierignore`, so one unreadable directory fails the whole run.
 * The development PostgreSQL container creates exactly that: `compose.yaml`
 * bind-mounts `data/development-postgres`, which the container owns as root.
 * Enumerating through Git instead never descends into ignored directories.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const FORMATTED_PATHSPECS = [
  '*.css',
  '*.html',
  '*.js',
  '*.json',
  '*.md',
  '*.mjs',
  '*.ts',
  '*.tsx',
  '*.yaml',
  '*.yml',
];

const write = process.argv.includes('--write');
// `--cached` still lists files deleted from the working tree, and Prettier
// fails on a path it cannot read.
const files = execFileSync(
  'git',
  [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    ...FORMATTED_PATHSPECS,
  ],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((file) => file !== '' && existsSync(file));

if (files.length === 0) {
  console.log('No formattable files are present.');
  process.exit(0);
}

const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'prettier', write ? '--write' : '--check', ...files],
  { stdio: 'inherit' },
);
if (result.error !== undefined) throw result.error;
process.exit(result.status ?? 1);
