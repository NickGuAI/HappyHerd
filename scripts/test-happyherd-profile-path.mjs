#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  publishManagedPath,
  restoreManagedPath,
} from '../installers/service/common/happyherd-profile-path.mjs';

const root = mkdtempSync(join(tmpdir(), 'happyherd-profile-path.'));
try {
  const home = join(root, 'home');
  const backup = join(root, 'backup');
  const fixture = join(root, 'fixture');
  mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, '.profile'), 'export EXISTING=1\n', { mode: 0o640 });
  writeFileSync(
    join(home, '.zprofile'),
    '# >>> HappyHerd managed PATH >>>\nexisting managed block\n',
    { mode: 0o600 },
  );

  publishManagedPath(home, backup);
  assert.match(readFileSync(join(home, '.profile'), 'utf8'), /HappyHerd managed PATH/);
  assert.match(readFileSync(join(home, '.bash_profile'), 'utf8'), /HappyHerd managed PATH/);
  assert.equal(
    readFileSync(join(home, '.zprofile'), 'utf8'),
    '# >>> HappyHerd managed PATH >>>\nexisting managed block\n',
  );

  restoreManagedPath(home, backup);
  assert.equal(readFileSync(join(home, '.profile'), 'utf8'), 'export EXISTING=1\n');
  assert.equal(statSync(join(home, '.profile')).mode & 0o777, 0o640);
  assert.equal(existsSync(join(home, '.bash_profile')), false);

  mkdirSync(fixture, { mode: 0o700 });
  writeFileSync(join(fixture, 'target'), 'do not follow\n', { mode: 0o600 });
  symlinkSync(join(fixture, 'target'), join(home, '.bash_profile'));
  const secondBackup = join(root, 'second-backup');
  assert.throws(
    () => publishManagedPath(home, secondBackup),
    /not a regular profile file/,
  );
  restoreManagedPath(home, secondBackup);
  assert.equal(readFileSync(join(home, '.profile'), 'utf8'), 'export EXISTING=1\n');
  assert.equal(readFileSync(join(fixture, 'target'), 'utf8'), 'do not follow\n');

  const conflictHome = join(root, 'conflict-home');
  const conflictBackup = join(root, 'conflict-backup');
  mkdirSync(conflictHome, { mode: 0o700 });
  publishManagedPath(conflictHome, conflictBackup);
  const publishedZprofile = readFileSync(join(conflictHome, '.zprofile'));
  writeFileSync(join(conflictHome, '.zprofile'), 'member edit after publication\n', { mode: 0o600 });
  assert.throws(
    () => restoreManagedPath(conflictHome, conflictBackup),
    /rollback incomplete.*\.zprofile changed after publication/,
  );
  assert.equal(existsSync(join(conflictHome, '.profile')), false);
  assert.equal(existsSync(join(conflictHome, '.bash_profile')), false);
  assert.equal(readFileSync(join(conflictHome, '.zprofile'), 'utf8'), 'member edit after publication\n');
  assert.equal(existsSync(join(conflictBackup, 'receipt.json')), true);
  writeFileSync(join(conflictHome, '.zprofile'), publishedZprofile, { mode: 0o600 });
  restoreManagedPath(conflictHome, conflictBackup);
  assert.equal(existsSync(join(conflictHome, '.zprofile')), false);

  process.stdout.write('HappyHerd profile publication recovery: ok\n');
} finally {
  rmSync(root, { recursive: true, force: true });
}
