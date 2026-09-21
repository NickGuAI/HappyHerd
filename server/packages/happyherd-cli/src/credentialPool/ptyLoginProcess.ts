import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

import { spawn as spawnPty } from '@lydell/node-pty';

export type PtyLoginSpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
};

/**
 * Presents a PTY-backed command through the small ChildProcess surface used by
 * CredentialLoginManager. Claude's setup-token command renders with Ink and
 * requires a real terminal before it prints the browser authorization URL.
 */
export function spawnPtyLoginProcess(
  command: string,
  args: string[],
  options: PtyLoginSpawnOptions,
): ChildProcess {
  const terminal = spawnPty(command, args, {
    name: 'xterm-256color',
    cols: 4_096,
    rows: 24,
    cwd: options.cwd,
    env: options.env,
  });
  const stdout = new PassThrough();
  let exitCode: number | null = null;
  let killed = false;

  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      try {
        terminal.write(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error('PTY input failed.'));
      }
    },
  });

  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    stdin: { value: stdin, enumerable: true },
    stdout: { value: stdout, enumerable: true },
    stderr: { value: null, enumerable: true },
    pid: { value: terminal.pid, enumerable: true },
    exitCode: { get: () => exitCode, enumerable: true },
    killed: { get: () => killed, enumerable: true },
  });
  child.kill = ((signal: NodeJS.Signals = 'SIGTERM') => {
    if (exitCode !== null) return false;
    try {
      killed = true;
      if (process.platform === 'win32') terminal.kill();
      else terminal.kill(signal);
      return true;
    } catch {
      return false;
    }
  }) as ChildProcess['kill'];

  const dataSubscription = terminal.onData((data) => stdout.write(data));
  terminal.onExit(({ exitCode: code }) => {
    exitCode = code;
    dataSubscription.dispose();
    stdin.end();
    stdout.end();
    child.emit('close', code, null);
  });

  return child;
}
