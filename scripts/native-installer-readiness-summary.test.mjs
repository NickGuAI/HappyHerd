import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDaemonStartup } from './native-installer-startup-diagnostic.mjs';
import { parseReadinessSummary, reportWithReadinessSummary } from './native-installer-readiness-summary.mjs';
const prefix = '[HAPPYHERD_DAEMON_START_READINESS] ';
const attempt = { attempt: 1, reason: 'state-unavailable', ready: false };
const summary = { schemaVersion: 1, attempts: [attempt] };
const record = value => prefix + JSON.stringify(value);
const invalid = value => assert.deepEqual(parseReadinessSummary(record(value)), { status: 'unavailable', reason: 'invalid-record' });

test('parses only the fixed record and preserves order and all six allowed readiness branches', () => {
  const reasons = [['state-unavailable', false], ['process-check-failed', false],
    ['http-ok', true], ['http-request-failed', false],
    ['accepted-without-port', true], ['accepted-after-http-non-ok', true]];
  const rows = reasons.map(([reason, ready], index) => ({ attempt: index + 1, reason, ready }));
  const value = { schemaVersion: 1, attempts: rows };
  const parsed = parseReadinessSummary(`Bearer sentinel-secret\nhttps://private.invalid/?token=sentinel\n${record(value)}\r\n/Users/sentinel/home pid=123 argv=secret`);
  assert.deepEqual(parsed, { status: 'available', summary: value });
  for (const secret of ['sentinel', 'pid=', 'argv=']) assert.equal(JSON.stringify(parsed).includes(secret), false);
  // Cleanup-attempt counts follow from these existing failure branches; no new
  // cleanup claim or clock is carried in the receipt.
  assert.equal(parsed.summary.attempts.filter(row => row.reason === 'process-check-failed').length, 1);
  assert.equal(parsed.summary.attempts.filter(row => row.reason === 'http-request-failed').length, 1);
});

test('requires one anchored prefix and rejects malformed, oversized and duplicate records', () => {
  for (const value of [null, 123, {}, '']) assert.equal(parseReadinessSummary(value).status, 'unavailable');
  assert.deepEqual(parseReadinessSummary('other ' + record(summary)), { status: 'unavailable', reason: 'missing-record' });
  for (const text of [prefix + '{', prefix + 'x'.repeat(16 * 1024), record(summary) + '\n' + record(summary)]) {
    assert.deepEqual(parseReadinessSummary(text), { status: 'unavailable', reason: 'invalid-record' });
  }
});

test('fully validates keys, counts, enums, booleans and consecutive indices without accepting timing or cleanup fields', () => {
  for (const value of [null, [], {}, { ...summary, schemaVersion: 2 }, { ...summary, attempts: [] },
    { ...summary, attempts: {} }, { ...summary, secret: 'token-sentinel' },
    { ...summary, attempts: Array.from({ length: 51 }, (_, i) => ({ ...attempt, attempt: i + 1 })) }]) invalid(value);
  for (const patch of [{ reason: 'unsupported' }, { reason: '__proto__' }, { reason: {} },
    { ready: 'false' }, { ready: true }, { attempt: 0 }, { attempt: 2 }, { attempt: 1.5 },
    { elapsedMs: 0 }, { cleanupAttempted: false }, { state: 'sentinel-state' },
    { url: 'https://sentinel.invalid' }, { pid: 123 }, { path: '/sentinel' },
    { token: 'sentinel' }, { argv: ['sentinel'] }]) invalid({ ...summary, attempts: [{ ...attempt, ...patch }] });
  invalid({ ...summary, attempts: [null] });
  const fifty = { ...summary, attempts: Array.from({ length: 50 }, (_, i) => ({ ...attempt, attempt: i + 1 })) };
  assert.deepEqual(parseReadinessSummary(record(fifty)), { status: 'available', summary: fifty });
  const result = parseReadinessSummary(prefix + '{"schemaVersion":1,"attempts":[],"__proto__":{"token":"sentinel"}}');
  assert.equal(result.status, 'unavailable'); assert.equal(JSON.stringify(result).includes('sentinel'), false);
});

test('reconstructs the actual existing classifier counts/category unchanged and never copies arbitrary diagnostic objects', async () => {
  const diagnostic = Object.freeze(classifyDaemonStartup({ foregroundOutput: 'Failed to start daemon',
    daemonLog: '[DAEMON RUN] Daemon state written', statePresent: false, bytesRead: 37 }));
  for (const output of [record(summary), 'raw sentinel credential']) {
    let calls = 0; let emitted;
    await reportWithReadinessSummary(output, async () => { calls++; return diagnostic; }, value => { emitted = value; });
    assert.equal(calls, 1);
    assert.deepEqual(emitted, { ...diagnostic, readiness: parseReadinessSummary(output) });
    assert.equal(JSON.stringify(emitted).includes('sentinel'), false);
  }
  for (const arbitrary of [{ ...diagnostic, token: 'sentinel' }, { ...diagnostic, category: 'sentinel' },
    { ...diagnostic, readyCount: 'sentinel' }, { ...diagnostic, statePresent: 'sentinel' },
    { ...diagnostic, readyCount: -1 }]) {
    let emitted;
    await reportWithReadinessSummary(record(summary), async () => arbitrary, value => { emitted = value; });
    assert.deepEqual(emitted, { readiness: parseReadinessSummary(record(summary)) });
    assert.equal(JSON.stringify(emitted).includes('sentinel'), false);
  }
});

test('collection rejection, missing diagnostic and throwing output sink cannot replace original foreground error', async () => {
  const original = new Error('original foreground exit');
  for (const mode of ['collection-rejects', 'missing-diagnostic', 'sink-throws']) {
    const emitted = [];
    const propagate = async () => {
      try { throw original; }
      catch (error) {
        await reportWithReadinessSummary('raw credential sentinel', async () => {
          if (mode === 'collection-rejects') throw new Error('collection sentinel');
          return null;
        }, value => {
          emitted.push(value);
          if (mode === 'sink-throws') throw new Error('sink sentinel');
        });
        throw error;
      }
    };
    await assert.rejects(propagate, error => error === original);
    assert.deepEqual(emitted, [{ readiness: { status: 'unavailable', reason: 'missing-record' } }]);
    assert.equal(JSON.stringify(emitted).includes('sentinel'), false);
  }
});
