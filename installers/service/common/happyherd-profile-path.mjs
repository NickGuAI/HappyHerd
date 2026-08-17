#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const profileNames = Object.freeze(['.profile', '.bash_profile', '.zprofile']);
const managedStart = '# >>> HappyHerd managed PATH >>>';
const managedBlock = `\n${managedStart}\ncase ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH="$HOME/.local/bin:$PATH" ;; esac\nexport PATH\n# <<< HappyHerd managed PATH <<<\n`;
const receiptName = 'receipt.json';
const maximumProfileBytes = 1024 * 1024;

function fail(message) {
  throw new Error(`happyherd-profile-path: ${message}`);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is not an object`);
  const actual = Object.keys(value).sort();
  if (actual.join('\0') !== [...expected].sort().join('\0')) fail(`${label} fields differ`);
}

function checkedRoots(homeInput, backupInput) {
  if (!isAbsolute(homeInput) || !isAbsolute(backupInput)) fail('home and backup paths must be absolute');
  const home = resolve(homeInput);
  const backup = resolve(backupInput);
  const homeStat = lstatSync(home);
  if (!homeStat.isDirectory() || homeStat.isSymbolicLink()) fail('home must be one real directory');
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  const backupStat = lstatSync(backup);
  if (!backupStat.isDirectory() || backupStat.isSymbolicLink()) fail('backup must be one real directory');
  chmodSync(backup, 0o700);
  return { home, backup };
}

function writeReceipt(backup, entries) {
  const temporary = join(backup, `${receiptName}.new`);
  writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, join(backup, receiptName));
}

function atomicWrite(path, bytes, mode) {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.happyherd-${process.pid}-${randomBytes(8).toString('hex')}`,
  );
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function sameState(path, expected) {
  const current = profileState(path);
  return current.existed === expected.existed && digest(current.bytes) === digest(expected.bytes);
}

function profileState(path) {
  if (!existsSync(path)) return { existed: false, bytes: Buffer.alloc(0), mode: 0o600 };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${path} is not a regular profile file`);
  if (stat.size > maximumProfileBytes) fail(`${path} exceeds the profile safety limit`);
  const bytes = readFileSync(path);
  if (bytes.includes(0)) fail(`${path} is not a text profile file`);
  return { existed: true, bytes, mode: stat.mode & 0o777 };
}

export function publishManagedPath(homeInput, backupInput) {
  const { home, backup } = checkedRoots(homeInput, backupInput);
  if (existsSync(join(backup, receiptName))) fail('backup receipt already exists');
  const entries = [];
  for (const name of profileNames) {
    const path = join(home, name);
    const state = profileState(path);
    const changed = !state.bytes.toString('utf8').includes(managedStart);
    const publishedBytes = changed
      ? Buffer.concat([state.bytes, Buffer.from(managedBlock, 'utf8')])
      : state.bytes;
    const entry = {
      name,
      existed: state.existed,
      changed,
      mode: state.mode,
      publishedSha256: digest(publishedBytes),
    };
    if (changed && state.existed) {
      copyFileSync(path, join(backup, `${name}.previous`));
      chmodSync(join(backup, `${name}.previous`), 0o600);
    }
    entries.push(entry);
    // Persist the rollback instruction before publishing each mutation so an
    // interrupted installer can still restore every profile it touched.
    writeReceipt(backup, entries);
    if (changed) {
      if (!sameState(path, state)) fail(`${name} changed during publication`);
      atomicWrite(path, publishedBytes, state.mode);
    }
  }
}

function loadReceipt(backup) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(join(backup, receiptName), 'utf8'));
  } catch {
    fail('rollback receipt is missing or invalid');
  }
  exactKeys(receipt, ['schemaVersion', 'entries'], 'receipt');
  if (receipt.schemaVersion !== 1 || !Array.isArray(receipt.entries)) fail('receipt schema differs');
  const seen = new Set();
  for (const entry of receipt.entries) {
    exactKeys(entry, ['name', 'existed', 'changed', 'mode', 'publishedSha256'], 'receipt entry');
    if (!profileNames.includes(entry.name) || seen.has(entry.name)) fail('receipt profile name differs');
    if (typeof entry.existed !== 'boolean' || typeof entry.changed !== 'boolean') fail('receipt flags differ');
    if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) fail('receipt mode differs');
    if (!/^[0-9a-f]{64}$/.test(entry.publishedSha256)) fail('receipt digest differs');
    seen.add(entry.name);
  }
  return receipt;
}

export function restoreManagedPath(homeInput, backupInput) {
  const { home, backup } = checkedRoots(homeInput, backupInput);
  const { entries } = loadReceipt(backup);
  const conflicts = [];
  for (const entry of [...entries].reverse()) {
    if (!entry.changed) continue;
    try {
      const path = join(home, entry.name);
      const current = profileState(path);
      let previousBytes = Buffer.alloc(0);
      if (entry.existed) {
        const previous = join(backup, `${entry.name}.previous`);
        const previousStat = lstatSync(previous);
        if (!previousStat.isFile() || previousStat.isSymbolicLink()) fail(`${entry.name} backup is unsafe`);
        previousBytes = readFileSync(previous);
        if (current.existed && digest(current.bytes) === digest(previousBytes)) continue;
      } else if (!current.existed) {
        continue;
      }
      if (!current.existed || digest(current.bytes) !== entry.publishedSha256) {
        fail(`${entry.name} changed after publication`);
      }
      if (entry.existed) atomicWrite(path, previousBytes, entry.mode);
      else rmSync(path);
    } catch (error) {
      conflicts.push(error instanceof Error ? error.message : `${entry.name} could not be restored`);
    }
  }
  if (conflicts.length > 0) {
    fail(`rollback incomplete; ${conflicts.join('; ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, home, backup] = process.argv.slice(2);
  if (!command || !home || !backup || process.argv.length !== 5) fail('usage: publish|restore <home> <backup>');
  if (command === 'publish') publishManagedPath(home, backup);
  else if (command === 'restore') restoreManagedPath(home, backup);
  else fail('command must be publish or restore');
}
