import assert, { AssertionError } from 'node:assert/strict';
import test from 'node:test';
import { childContext, ownedFailure, publicFailure, rememberFailure } from './native-installer-auth-diagnostics.mjs';

const context = childContext('initial online daemon', 'initial-daemon-start');
const privateText = 'private-account https://private.invalid/token /private/runtime secret-key';

test('owned child attribution survives the later cleanup stage without changing the error', () => {
  const error = new Error(privateText);
  assert.equal(rememberFailure(error, context, {
    category: 'child-exit', exitCode: 1, signal: null, output: privateText,
  }), error);
  assert(Object.isFrozen(context));
  assert.deepEqual(publicFailure(error, 'test daemon cleanup'), {
    stage: 'initial online daemon', command: 'initial-daemon-start', category: 'child-exit',
    outputCategory: 'unknown', exitCode: 1, signal: null,
  });
  const copy = publicFailure(error, 'pairing');
  copy.command = privateText;
  assert.equal(publicFailure(error, 'pairing').command, 'initial-daemon-start');
});

test('classifies only the complete owned daemon readiness line, scoped to its command', () => {
  for (const output of ['Failed to start daemon', `${privateText}\nFailed to start daemon\n${privateText}`,
    `${privateText}\r\nFailed to start daemon\r\n`]) {
    const error = ownedFailure(context, { category: 'child-exit', exitCode: 1, signal: null, output });
    const result = publicFailure(error, 'pairing');
    assert.equal(result.outputCategory, 'daemon-start-readiness-not-established');
    assert(!JSON.stringify(result).includes('private'));
  }
  for (const output of [privateText, 'Not Failed to start daemon', 'Failed to start daemon later',
    'Daemon started successfully', 'failed to start daemon']) {
    assert.equal(publicFailure(ownedFailure(context, { category: 'child-exit', output })).outputCategory, 'unknown');
  }
  assert.equal(publicFailure(ownedFailure(childContext('installer rerun', 'installer-rerun'), {
    category: 'child-exit', output: 'Failed to start daemon',
  })).outputCategory, 'unknown');
});

test('raw assertions, spawn messages, forged metadata and arbitrary thrown values remain private', () => {
  const errors = [new AssertionError({ message: privateText, actual: privateText, expected: { secret: privateText } }),
    Object.assign(new Error(privateText), { code: privateText, errno: privateText, path: privateText,
      spawnargs: [privateText], diagnostic: { category: privateText }, name: privateText }),
    { name: 'AssertionError', message: privateText, stage: privateText }, privateText, null, undefined];
  for (const error of errors) {
    const result = publicFailure(error, privateText);
    assert.deepEqual(result, { stage: 'unknown', command: 'none',
      category: error instanceof AssertionError ? 'assertion-failed' : 'unknown', outputCategory: 'unknown' });
    assert(!JSON.stringify(result).includes('private'));
  }
});

test('numeric and signal fields are strictly bounded and cannot carry arbitrary values', () => {
  for (const value of [privateText, '1', true, false, NaN, Infinity, -Infinity, 1.5, 65536, -65536]) {
    const result = publicFailure(ownedFailure(context, {
      category: 'spawn-error', exitCode: value, errno: value, signal: privateText, output: privateText,
    }));
    assert.deepEqual(result, { ...context, category: 'spawn-error', outputCategory: 'unknown', signal: 'unknown' });
  }
  assert.deepEqual(publicFailure(ownedFailure(context, {
    category: 'spawn-error', errno: -2, exitCode: 65535, signal: 'SIGTERM',
  })), { ...context, category: 'spawn-error', outputCategory: 'unknown', errno: -2, exitCode: 65535, signal: 'SIGTERM' });
  for (const value of [0, -1, 300001, 1.5, '90000', true, privateText]) {
    assert(!Object.hasOwn(publicFailure(ownedFailure(context, { category: 'child-timeout', timeoutMs: value })), 'timeoutMs'));
  }
  for (const timeoutMs of [90000, 120000, 300000]) {
    assert.equal(publicFailure(ownedFailure(context, { category: 'child-timeout', timeoutMs })).timeoutMs, timeoutMs);
  }
});

test('unknown labels and categories become fixed unknown enums', () => {
  assert.deepEqual(publicFailure(ownedFailure({ stage: privateText, command: privateText }, {
    category: privateText, output: privateText,
  })), { stage: 'unknown', command: 'unknown', category: 'unknown', outputCategory: 'unknown' });
  for (const command of ['pairing-auth-login', 'initial-daemon-start', 'installer-rerun',
    'post-rerun-auth-login', 'test-daemon-stop', 'none']) {
    assert.equal(childContext('pairing', command).command, command);
  }
});
