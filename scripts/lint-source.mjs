#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const base = process.env.HAPPYHERD_LINT_BASE?.trim();

function git(args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function lines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

const changed = new Set();
if (base && !/^0+$/.test(base)) {
  for (const file of lines(git(['diff', '--name-only', '--diff-filter=ACMRT', `${base}...HEAD`]))) {
    changed.add(file);
  }
}
for (const file of lines(git(['diff', '--name-only', '--diff-filter=ACMRT', 'HEAD']))) {
  changed.add(file);
}
for (const file of lines(git(['ls-files', '--others', '--exclude-standard']))) {
  changed.add(file);
}

const lintableExtensions = new Set([
  '.cjs', '.js', '.jsx', '.json', '.md', '.mjs', '.sh', '.ts', '.tsx', '.yaml', '.yml',
]);
const conflictMarker = /^(<{7}|={7}|>{7})(?:\s|$)/m;
const failures = [];

for (const relativePath of [...changed].sort()) {
  if (!lintableExtensions.has(extname(relativePath))) continue;
  const contents = readFileSync(resolve(repoRoot, relativePath), 'utf8');
  if (conflictMarker.test(contents)) {
    failures.push(`${relativePath}: unresolved merge-conflict marker`);
  }
  if (extname(relativePath) === '.json') {
    try {
      JSON.parse(contents);
    } catch (error) {
      failures.push(`${relativePath}: invalid JSON (${error.message})`);
    }
  }
}

try {
  if (base && !/^0+$/.test(base)) {
    execFileSync('git', ['-C', repoRoot, 'diff', '--check', `${base}...HEAD`], { stdio: 'inherit' });
  }
  execFileSync('git', ['-C', repoRoot, 'diff', '--check'], { stdio: 'inherit' });
} catch {
  failures.push('git diff --check failed');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`lint: ${failure}`);
  process.exit(1);
}

console.log(`lint: ok (${changed.size} changed paths inspected)`);
