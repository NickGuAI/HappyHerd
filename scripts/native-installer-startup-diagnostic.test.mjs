import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  classifyDaemonStartup,
  isOwnedDaemonLogPath,
} from './native-installer-startup-diagnostic.mjs';

const classify = (foregroundOutput, daemonLog, statePresent = false) => classifyDaemonStartup({
  foregroundOutput,
  daemonLog,
  statePresent,
  bytesRead: Buffer.byteLength(daemonLog),
});

test('classifies a lock failure without retaining raw startup data', () => {
  const secrets = [
    'Bearer sentinel-secret-token',
    'https://auth.example.test/pair?code=secret',
    '/Users/private/account/home',
    'pid=48123',
  ];
  const result = classify(
    `Failed to start daemon\n${secrets[0]}`,
    `[DAEMON RUN] Starting daemon process...\n${secrets.join('\n')}\n`
      + '[DAEMON RUN] Failed to acquire daemon lock; daemon startup did not complete',
  );

  assert.equal(result.category, 'lock-failure-marker');
  assert.equal(result.foregroundFailed, true);
  assert.equal(result.lockFailureCount, 1);
  assert.equal(result.startedCount, 1);
  const serialized = JSON.stringify(result);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
});

test('classifies owned early-exit markers without copying their surrounding text', () => {
  const secret = 'access-token=sentinel-never-report';
  const result = classify('Failed to start daemon', [
    '[DAEMON RUN] Starting daemon process...',
    `[DAEMON RUN] FATAL: Unhandled promise rejection ${secret}`,
    '[DAEMON RUN] Process exiting with code: 1',
  ].join('\n'));

  assert.equal(result.category, 'early-exit-marker');
  assert.equal(result.unhandledCount, 1);
  assert.equal(result.nonzeroExitCount, 1);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('reports only observational state and lifecycle categories', () => {
  const statePresent = classify(
    'Failed to start daemon',
    '[DAEMON RUN] Daemon started successfully, waiting for shutdown request',
    true,
  );
  assert.equal(statePresent.category, 'state-present-after-foreground-failure');
  assert.equal(statePresent.readyCount, 1);

  const stateWritten = classify(
    'Failed to start daemon',
    '[DAEMON RUN] Daemon state written',
  );
  assert.equal(stateWritten.category, 'state-written-after-foreground-failure');

  const incomplete = classify(
    'Failed to start daemon',
    '[DAEMON RUN] Starting daemon process...',
  );
  assert.equal(incomplete.category, 'pre-state-incomplete');
});

test('keeps unknown raw content out of an unclassified result', () => {
  const secret = 'happy://terminal?sentinel-private-pairing-code';
  const result = classify('unexpected foreground output', secret);
  assert.equal(result.category, 'unclassified');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('accepts only a direct daemon log below the verified real logs root', () => {
  const home = path.resolve('/private/tmp/owned-home');
  const logs = path.join(home, '.happyherd', 'logs');
  const owned = candidate => isOwnedDaemonLogPath(home, logs, candidate);
  assert.equal(owned(path.join(logs, '2026-10-12-daemon.log')), true);
  assert.equal(owned(path.resolve(`${logs}-outside/2026-10-12-daemon.log`)), false);
  assert.equal(owned(path.resolve(logs, '../2026-10-12-daemon.log')), false);
  assert.equal(owned(path.join(logs, 'nested/2026-10-12-daemon.log')), false);
  assert.equal(owned(path.join(logs, '2026-10-12.log')), false);
  const symlinkTarget = path.resolve('/private/tmp/outside-owned-home/logs');
  assert.equal(isOwnedDaemonLogPath(home, symlinkTarget,
    path.join(symlinkTarget, '2026-10-12-daemon.log')), false);
});
