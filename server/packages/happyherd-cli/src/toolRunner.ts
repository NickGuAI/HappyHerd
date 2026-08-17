/** Execute one manifest-declared Skill tool with a child-only issuer token. */

import { spawn } from 'node:child_process';
import {
  existsSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  basename,
  extname,
  isAbsolute,
  join,
} from 'node:path';
import { normalizeIssuer } from './contracts';
import { resolveManagedTool, type RegistryOptions } from './registry';
import type { SecretStore } from './secretStore';

export interface RunManagedToolOptions extends RegistryOptions {
  issuer: string;
  skill: string;
  script: string;
  args: string[];
  secretStore: SecretStore;
  spawn?: typeof spawn;
  parentEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pythonCandidates?: string[];
  signal?: AbortSignal;
  timeoutMilliseconds?: number;
  launcher?: {
    command: string;
    configPath: string;
    pythonRuntime: string;
    nodeRuntime: string;
  };
}

export interface ManagedToolExecution {
  status: number;
  stdout: string;
  stderr: string;
}

export interface PythonRuntime {
  command: string;
  prefixArguments: string[];
}

function verifiedExecutable(candidate: string, platform: NodeJS.Platform): string {
  if (!isAbsolute(candidate)) throw new Error('interpreter candidate must be an absolute path');
  const resolved = realpathSync(candidate);
  if (!isAbsolute(resolved)) throw new Error('interpreter did not resolve to an absolute path');
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error(`interpreter is not a regular file: ${resolved}`);
  if (platform !== 'win32') {
    if ((stat.mode & 0o111) === 0) throw new Error(`interpreter is not executable: ${resolved}`);
    if ((stat.mode & 0o022) !== 0) throw new Error(`interpreter is group- or world-writable: ${resolved}`);
  }
  return resolved;
}

export function resolvePythonRuntime(
  platform: NodeJS.Platform = process.platform,
  candidates: string[] = [],
): PythonRuntime {
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) throw new Error('interpreter candidate must be an absolute path');
    if (!existsSync(candidate)) continue;
    const command = verifiedExecutable(candidate, platform);
    return {
      command,
      prefixArguments: basename(candidate).toLowerCase() === 'py.exe' ? ['-3'] : [],
    };
  }
  throw new Error(
    'the broker-owned Python runtime is missing; repair the verified HappyHerd installation',
  );
}

export function isolatedToolEnvironment(_untrustedParent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Token-bearing tools receive no inherited PATH, home, proxy, CA, language,
  // runtime-option, or credential variables. Every entry below is supplied by
  // HappyHerd after bundle and issuer verification.
  return {};
}

export const MAX_SANITIZED_TOOL_STREAM_BYTES = 1_048_576;

export function sanitizedOutput(value: unknown, accessToken: string): string {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : typeof value === 'string' ? value : '';
  const sanitized = text
    .replaceAll(accessToken, '[REDACTED]')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[^\t\n\r\x20-\x7e\u00a0-\uffff]/g, '');
  const encoded = Buffer.from(sanitized, 'utf8');
  if (encoded.length <= MAX_SANITIZED_TOOL_STREAM_BYTES) return sanitized;
  // Decoding a byte-truncated multibyte sequence can add a three-byte U+FFFD.
  // Trim the decoded tail until the final UTF-8 representation is itself
  // within the bound. JSON can at most double the retained bytes by escaping
  // quotes, backslashes, tabs, CR, and LF, so two streams remain under the
  // broker client's 5 MiB response ceiling.
  let bounded = encoded.subarray(0, MAX_SANITIZED_TOOL_STREAM_BYTES).toString('utf8');
  while (Buffer.byteLength(bounded, 'utf8') > MAX_SANITIZED_TOOL_STREAM_BYTES) {
    bounded = bounded.slice(0, -1);
  }
  return bounded;
}

const MAX_TOOL_STREAM_BYTES = 1_048_576;
const MAX_TOOL_RUNTIME_MILLISECONDS = 60_000;

function captureBoundedStream(
  stream: NodeJS.ReadableStream,
  label: string,
  onOverflow: (error: Error) => void,
): () => Buffer {
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on('data', (value: Buffer | string) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > MAX_TOOL_STREAM_BYTES) {
      onOverflow(new Error(`verified Skill tool ${label} exceeded the 1 MiB limit`));
      return;
    }
    chunks.push(chunk);
  });
  return () => Buffer.concat(chunks);
}

export async function executeManagedTool(options: RunManagedToolOptions): Promise<ManagedToolExecution> {
  const issuer = normalizeIssuer(options.issuer);
  const credential = options.secretStore.get(issuer);
  if (!credential) throw new Error('issuer is not connected; run happyherd connect first');
  if (Date.parse(credential.expiresAt) <= Date.now()) {
    throw new Error('issuer credential is expired; reconnect before running a Skill tool');
  }
  const resolved = resolveManagedTool(issuer, options.skill, options.script, options);
  const extension = extname(resolved.scriptPath).toLowerCase();
  if (!options.launcher) {
    throw new Error('the isolated OS tool launcher is not configured');
  }
  const command = verifiedExecutable(options.launcher.command, options.platform ?? process.platform);
  let runtime: 'python' | 'node' | 'direct';
  if (extension === '.py') {
    verifiedExecutable(options.launcher.pythonRuntime, options.platform ?? process.platform);
    runtime = 'python';
  } else if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    verifiedExecutable(options.launcher.nodeRuntime, options.platform ?? process.platform);
    runtime = 'node';
  } else {
    if ((resolved.declaration.mode & 0o111) === 0) {
      throw new Error('verified tool script has no supported runtime and is not executable');
    }
    runtime = 'direct';
  }
  const args = [
    '--config', options.launcher.configPath,
    '--runtime', runtime,
    '--script', resolved.scriptPath,
    '--cwd', join(resolved.entry.bundlePath, resolved.entry.skill),
    '--',
    ...options.args,
  ];
  const env = isolatedToolEnvironment(options.parentEnv ?? process.env);
  env.HAPPYHERD_ACCESS_TOKEN = credential.accessToken;
  env.HAPPYHERD_ISSUER = issuer;
  env.HAPPYHERD_API_BASE_URL = resolved.manifest.product.baseUrl;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? MAX_TOOL_RUNTIME_MILLISECONDS;
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > MAX_TOOL_RUNTIME_MILLISECONDS) {
    throw new Error('verified Skill tool timeout is invalid');
  }
  if (options.signal?.aborted) throw new Error('verified Skill tool request was cancelled');
  const child = (options.spawn ?? spawn)(command, args, {
    cwd: join(resolved.entry.bundlePath, resolved.entry.skill),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return new Promise<ManagedToolExecution>((resolvePromise, reject) => {
    let terminalError: Error | null = null;
    let settled = false;
    const terminate = (error: Error): void => {
      if (terminalError || settled) return;
      terminalError = error;
      // The protected native launcher is itself the containment boundary. On
      // Linux/macOS it becomes the tool process; on Windows its Job Object is
      // closed when this process dies, which terminates every descendant.
      try { child.kill('SIGKILL'); } catch { /* close/error still settles */ }
    };
    const stdout = captureBoundedStream(child.stdout, 'stdout', terminate);
    const stderr = captureBoundedStream(child.stderr, 'stderr', terminate);
    const timer = setTimeout(() => {
      terminate(new Error('verified Skill tool exceeded the 60 second runtime limit'));
    }, timeoutMilliseconds);
    const cancel = (): void => terminate(new Error('verified Skill tool request was cancelled'));
    options.signal?.addEventListener('abort', cancel, { once: true });
    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    };
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`verified Skill tool could not start: ${error.message}`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminalError) {
        reject(terminalError);
        return;
      }
      resolvePromise({
        status: code ?? 1,
        stdout: sanitizedOutput(stdout(), credential.accessToken),
        stderr: sanitizedOutput(stderr(), credential.accessToken),
      });
    });
  });
}

export async function runManagedTool(options: RunManagedToolOptions): Promise<number> {
  const result = await executeManagedTool(options);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status;
}
