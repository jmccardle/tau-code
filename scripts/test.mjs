#!/usr/bin/env node
/**
 * `npm test`: every `packages/<name>/test/*.test.mjs`, named one by one, run by `node --test`.
 *
 * The files are listed here rather than handed to `node --test` as directories or globs, because
 * the two differ across Node versions: Node 20 searches a directory argument, Node 22 reads it as
 * a glob that matches nothing (and fails each with "Cannot find module"). A list of files means
 * the same thing to both. No test file found is a failure, not a pass.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['protocol', 'ui', 'web', 'vscode'];

const files = [];
for (const name of PACKAGES) {
  const dir = join(ROOT, 'packages', name, 'test');
  if (!existsSync(dir)) throw new Error(`packages/${name} has no test directory`);
  const found = readdirSync(dir)
    .filter((file) => file.endsWith('.test.mjs'))
    .sort()
    .map((file) => relative(ROOT, join(dir, file)));
  if (found.length === 0) throw new Error(`packages/${name}/test has no *.test.mjs`);
  files.push(...found);
}

console.log(`node ${process.version}: ${files.length} test files`);
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
