// Parse only the fixed record in the helper's already-owned, bounded output.
// Never copy surrounding stdout/stderr or unknown properties into diagnostics.
const prefix = '[HAPPYHERD_DAEMON_START_READINESS] ';
const expected = {
  'state-unavailable': false,
  'process-check-failed': false,
  'http-ok': true,
  'http-request-failed': false,
  'accepted-without-port': true,
  'accepted-after-http-non-ok': true,
};
const keysAre = (value, names) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const unavailable = reason => ({ status: 'unavailable', reason });

export function parseReadinessSummary(foregroundOutput) {
  if (typeof foregroundOutput !== 'string') return unavailable('invalid-record');
  const records = foregroundOutput.split(/\r?\n/).filter(line => line.startsWith(prefix));
  if (records.length === 0) return unavailable('missing-record');
  if (records.length !== 1 || records[0].length > 16 * 1024) return unavailable('invalid-record');
  try {
    const value = JSON.parse(records[0].slice(prefix.length));
    if (!keysAre(value, ['schemaVersion', 'attempts']) || value.schemaVersion !== 1
      || !Array.isArray(value.attempts) || value.attempts.length < 1 || value.attempts.length > 50) {
      return unavailable('invalid-record');
    }
    const attempts = [];
    for (const [index, row] of value.attempts.entries()) {
      if (!keysAre(row, ['attempt', 'reason', 'ready'])
        || row.attempt !== index + 1 || typeof row.reason !== 'string' || !Object.hasOwn(expected, row.reason)
        || row.ready !== expected[row.reason]) {
        return unavailable('invalid-record');
      }
      attempts.push({ attempt: row.attempt, reason: row.reason, ready: row.ready });
    }
    return { status: 'available', summary: { schemaVersion: 1, attempts } };
  } catch { return unavailable('invalid-record'); }
}

// Existing classifier output has a fixed schema. Reconstruct it explicitly;
// never spread an arbitrary object or expose added/raw diagnostic fields.
const categories = new Set(['lock-failure-marker', 'early-exit-marker',
  'state-present-after-foreground-failure', 'state-written-after-foreground-failure',
  'pre-state-incomplete', 'unclassified']);
const countKeys = ['bytesRead', 'startedCount', 'versionMismatchCount', 'lockFailureCount',
  'authCompleteCount', 'stateWrittenCount', 'readyCount', 'unexpectedFatalCount',
  'uncaughtCount', 'unhandledCount', 'forcedExitCount', 'nonzeroExitCount'];
function reconstructDiagnostic(value) {
  if (!keysAre(value, ['category', 'foregroundFailed', 'statePresent', ...countKeys])
    || !categories.has(value.category) || typeof value.foregroundFailed !== 'boolean'
    || typeof value.statePresent !== 'boolean'
    || countKeys.some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) return {};
  const result = { category: value.category, foregroundFailed: value.foregroundFailed, statePresent: value.statePresent };
  for (const key of countKeys) result[key] = value[key];
  return result;
}

export async function reportWithReadinessSummary(foregroundOutput, collect, emit) {
  const readiness = parseReadinessSummary(foregroundOutput);
  let diagnostic;
  try { diagnostic = await collect(); }
  catch { /* No extra read/probe if the existing collection fails. */ }
  try {
    const result = reconstructDiagnostic(diagnostic);
    result.readiness = readiness;
    emit(result);
  } catch { /* Reporting cannot replace the original foreground failure. */ }
}
