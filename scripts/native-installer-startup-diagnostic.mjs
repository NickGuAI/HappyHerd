import path from 'node:path';

const markers = {
  startedCount: '[DAEMON RUN] Starting daemon process...',
  versionMismatchCount: '[DAEMON RUN] Daemon version mismatch detected, restarting daemon with current CLI version',
  lockFailureCount: '[DAEMON RUN] Failed to acquire daemon lock; daemon startup did not complete',
  authCompleteCount: '[DAEMON RUN] Auth and machine setup complete',
  stateWrittenCount: '[DAEMON RUN] Daemon state written',
  readyCount: '[DAEMON RUN] Daemon started successfully, waiting for shutdown request',
  unexpectedFatalCount: '[DAEMON RUN][FATAL] Failed somewhere unexpectedly - exiting with code 1',
  uncaughtCount: '[DAEMON RUN] FATAL: Uncaught exception',
  unhandledCount: '[DAEMON RUN] FATAL: Unhandled promise rejection',
  forcedExitCount: '[DAEMON RUN] Startup malfunctioned, forcing exit with code 1',
};

function occurrences(value, marker) {
  return value.split(marker).length - 1;
}

export function isOwnedDaemonLogPath(realTestHome, logsRootReal, candidateReal) {
  return path.isAbsolute(realTestHome)
    && logsRootReal === path.join(realTestHome, '.happyherd', 'logs')
    && path.isAbsolute(candidateReal)
    && path.dirname(candidateReal) === logsRootReal
    && path.basename(candidateReal).endsWith('-daemon.log');
}

export function classifyDaemonStartup({ foregroundOutput, daemonLog, statePresent, bytesRead }) {
  const counts = Object.fromEntries(Object.entries(markers)
    .map(([name, marker]) => [name, occurrences(daemonLog, marker)]));
  const nonzeroExitCount = (daemonLog.match(/\[DAEMON RUN\] Process exiting with code: [1-9][0-9]*/g) || []).length;
  const foregroundFailed = foregroundOutput.includes('Failed to start daemon');
  const earlyExit = counts.unexpectedFatalCount > 0
    || counts.uncaughtCount > 0
    || counts.unhandledCount > 0
    || counts.forcedExitCount > 0
    || nonzeroExitCount > 0;
  const category = counts.lockFailureCount > 0
    ? 'lock-failure-marker'
    : earlyExit
      ? 'early-exit-marker'
      : foregroundFailed && statePresent
        ? 'state-present-after-foreground-failure'
        : foregroundFailed && counts.stateWrittenCount > 0
          ? 'state-written-after-foreground-failure'
          : foregroundFailed && counts.startedCount > 0
            ? 'pre-state-incomplete'
            : 'unclassified';

  return {
    category,
    foregroundFailed,
    statePresent,
    bytesRead,
    ...counts,
    nonzeroExitCount,
  };
}
