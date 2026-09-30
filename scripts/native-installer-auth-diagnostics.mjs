// Test-harness diagnostics only. Raw child output and exception messages never
// become public fields; only metadata attached by this module is trusted.
import { AssertionError } from 'node:assert';

const stages = new Set([
  'pairing', 'initial online daemon', 'persisting session history',
  'installer rerun', 'post-upgrade online daemon and retained history',
  'test daemon cleanup',
]);
const commands = new Set([
  'pairing-auth-login', 'initial-daemon-start', 'installer-rerun',
  'post-rerun-auth-login', 'test-daemon-stop', 'none',
]);
const categories = new Set(['child-exit', 'child-signal', 'spawn-error', 'child-timeout', 'check-timeout']);
const signals = new Set([
  'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGBUS',
  'SIGFPE', 'SIGKILL', 'SIGSEGV', 'SIGPIPE', 'SIGALRM', 'SIGTERM',
]);
const failures = new WeakMap();
const boundedInteger = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function childContext(stage, command) {
  return Object.freeze({
    stage: stages.has(stage) ? stage : 'unknown',
    command: commands.has(command) ? command : 'unknown',
  });
}

export function rememberFailure(error, context, details) {
  const receipt = {
    ...childContext(context.stage, context.command),
    category: categories.has(details.category) ? details.category : 'unknown',
    outputCategory: 'unknown',
  };
  // The owned CLI prints this exact line only when daemon start's existing
  // readiness polling did not succeed (happyherd-cli/src/index.ts). It does not
  // establish why the detached daemon failed or became ready too late.
  if (receipt.command === 'initial-daemon-start' && typeof details.output === 'string'
      && details.output.split(/\r?\n/).some(line => line === 'Failed to start daemon')) {
    receipt.outputCategory = 'daemon-start-readiness-not-established';
  }
  if (boundedInteger(details.exitCode, -65535, 65535)) receipt.exitCode = details.exitCode;
  if (details.signal === null) receipt.signal = null;
  else if (details.signal !== undefined) receipt.signal = signals.has(details.signal) ? details.signal : 'unknown';
  if (boundedInteger(details.errno, -65535, 65535)) receipt.errno = details.errno;
  if (boundedInteger(details.timeoutMs, 1, 300_000)) receipt.timeoutMs = details.timeoutMs;
  failures.set(error, Object.freeze(receipt));
  return error;
}

export function ownedFailure(context, details) {
  return rememberFailure(new Error('Native installer check failed.'), context, details);
}

export function publicFailure(error, stage) {
  return { ...(failures.get(error) ?? {
    ...childContext(stage, 'none'),
    category: error instanceof AssertionError ? 'assertion-failed' : 'unknown',
    outputCategory: 'unknown',
  }) };
}
