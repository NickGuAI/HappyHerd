import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  CredentialLoginFlow,
  ManagedCredentialProvider,
} from '@slopus/happy-wire';
import crossSpawn from 'cross-spawn';

import {
  managedProviderDirectAuthKeys,
  sanitizeSessionEnvironment,
} from '@/daemon/sessionEnvironment';

import {
  commitCredentialLogin,
  defaultCredentialPoolPaths,
  validateAccountName,
  type CredentialLoginTarget,
  type CredentialPoolPaths,
} from './store';

const LOGIN_TTL_MS = 15 * 60 * 1_000;
const FINISHED_TTL_MS = 5 * 60 * 1_000;
const TERMINATE_GRACE_MS = 2_000;
const MAX_ACTIVE_LOGIN_ATTEMPTS = 3;
const MAX_CAPTURE_CHARS = 128 * 1_024;
const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001b\\))/g;
const URL_PATTERN = /https:\/\/[^\s]+/g;

type LoginAttempt = {
  public: CredentialLoginFlow;
  child: ChildProcess;
  output: string;
  settled: boolean;
  targetKey: string;
  stagingHome: string;
  expiryTimer: NodeJS.Timeout;
  finalization?: Promise<void>;
  loginTarget?: CredentialLoginTarget;
};

export type CredentialLoginManagerDependencies = {
  paths?: CredentialPoolPaths;
  spawn?: typeof crossSpawn;
  now?: () => number;
  commitLogin?: typeof commitCredentialLogin;
  prepareStagingHome?: (stagingHome: string) => Promise<void>;
};

function safeFlow(attempt: LoginAttempt): CredentialLoginFlow {
  return { ...attempt.public };
}

function sanitizedOutput(value: string): string {
  return value.replace(ANSI_ESCAPE, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function providerUrl(provider: ManagedCredentialProvider, output: string): string | undefined {
  const urls = sanitizedOutput(output).match(URL_PATTERN) ?? [];
  for (const candidate of urls) {
    try {
      const url = new URL(candidate.replace(/[),.;\]}]+$/, ''));
      if (url.protocol !== 'https:') continue;
      if (provider === 'claude' && (url.hostname === 'claude.com' || url.hostname === 'claude.ai')) {
        return url.toString();
      }
      if (provider === 'codex' && url.hostname === 'auth.openai.com' && url.pathname.startsWith('/codex/device')) {
        return url.toString();
      }
      if (provider === 'grok' && url.hostname === 'accounts.x.ai') return url.toString();
    } catch {}
  }
  return undefined;
}

function providerCode(output: string): string | undefined {
  const clean = sanitizedOutput(output);
  const patterns = [
    /one-time\s+code[^\n\r]*(?:\r?\n)+\s*([A-Z0-9-]{4,64})/i,
    /(?:user|verification)\s+code\s*[:#-]?\s*([A-Z0-9-]{4,64})/i,
    /\b([A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+)\b/i,
  ];
  for (const pattern of patterns) {
    const code = clean.match(pattern)?.[1]?.toUpperCase();
    if (code && /[-0-9]/.test(code)) return code;
  }
  return undefined;
}

function providerLoginEnvironment(provider: ManagedCredentialProvider, stagingHome: string): NodeJS.ProcessEnv {
  const env = sanitizeSessionEnvironment(process.env);
  const blocked = new Set([
    ...managedProviderDirectAuthKeys('claude'),
    ...managedProviderDirectAuthKeys('codex'),
    ...managedProviderDirectAuthKeys('grok'),
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
    'GROK_HOME',
  ]);
  for (const key of Object.keys(env)) {
    if (blocked.has(key) || /^HAPPYHERD_.*ACCOUNT/.test(key)) delete env[key];
  }
  if (provider === 'claude') env.CLAUDE_CONFIG_DIR = stagingHome;
  if (provider === 'codex') env.CODEX_HOME = stagingHome;
  if (provider === 'grok') env.GROK_HOME = stagingHome;
  return env;
}

function validProviderAuth(provider: 'codex' | 'grok', value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.tokens && typeof record.tokens === 'object' && !Array.isArray(record.tokens)) {
    const tokens = record.tokens as Record<string, unknown>;
    if (['access_token', 'refresh_token'].some(
      (key) => typeof tokens[key] === 'string' && tokens[key] !== '',
    )) return true;
  }
  if (provider === 'grok') {
    const scoped = record['https://accounts.x.ai/sign-in'];
    if (scoped && typeof scoped === 'object' && !Array.isArray(scoped)) {
      const key = (scoped as Record<string, unknown>).key;
      if (typeof key === 'string' && key !== '') return true;
    }
  }
  const keys = provider === 'codex'
    ? ['OPENAI_API_KEY', 'access_token', 'refresh_token']
    : ['XAI_API_KEY', 'api_key', 'access_token', 'refresh_token', 'token'];
  return keys.some((key) => typeof record[key] === 'string' && record[key] !== '');
}

function targetKey(provider: ManagedCredentialProvider, name: string): string {
  return `${provider}:${name}`;
}

export class CredentialLoginManager {
  private readonly paths: CredentialPoolPaths;
  private readonly spawn: typeof crossSpawn;
  private readonly now: () => number;
  private readonly commitLogin: typeof commitCredentialLogin;
  private readonly prepareStagingHome: (stagingHome: string) => Promise<void>;
  private readonly attempts = new Map<string, LoginAttempt>();
  private readonly activeTargets = new Map<string, string>();
  private readonly finalizations = new Set<Promise<void>>();
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private closing = false;

  constructor(dependencies: CredentialLoginManagerDependencies = {}) {
    this.paths = dependencies.paths ?? defaultCredentialPoolPaths();
    this.spawn = dependencies.spawn ?? crossSpawn;
    this.now = dependencies.now ?? Date.now;
    this.commitLogin = dependencies.commitLogin ?? commitCredentialLogin;
    this.prepareStagingHome = dependencies.prepareStagingHome ?? (async (stagingHome) => {
      await mkdir(stagingHome, { recursive: true, mode: 0o700 });
      await chmod(dirname(stagingHome), 0o700);
      await chmod(stagingHome, 0o700);
    });
  }

  async start(
    provider: ManagedCredentialProvider,
    rawName: string,
    loginTarget?: CredentialLoginTarget,
  ): Promise<CredentialLoginFlow> {
    if (this.closing) throw new Error('Credential login management is shutting down.');
    const name = validateAccountName(rawName);
    const key = targetKey(provider, name);
    const id = randomUUID();
    if (this.activeTargets.has(key)) throw new Error('A login is already in progress for this account.');
    if (this.activeTargets.size >= MAX_ACTIVE_LOGIN_ATTEMPTS) {
      throw new Error('Too many provider logins are already in progress.');
    }
    this.activeTargets.set(key, id);
    const stagingHome = join(this.paths.accountsDir, '.pending', id);
    const operation = (async () => {
      try {
        await this.prepareStagingHome(stagingHome);
        if (this.closing) throw new Error('Credential login management is shutting down.');

        const command = provider === 'claude' ? 'claude' : provider;
        const args = provider === 'claude' ? ['setup-token'] : ['login', '--device-auth'];
        const child = this.spawn(command, args, {
          env: providerLoginEnvironment(provider, stagingHome),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        const expiresAt = this.now() + LOGIN_TTL_MS;
        const attempt = {} as LoginAttempt;
        attempt.public = {
          id,
          provider,
          name,
          state: 'starting',
          requiresCodeEntry: provider === 'claude',
          expiresAt,
        };
        attempt.child = child;
        attempt.output = '';
        attempt.settled = false;
        attempt.targetKey = key;
        attempt.stagingHome = stagingHome;
        attempt.loginTarget = loginTarget;
        attempt.expiryTimer = setTimeout(() => {
          this.beginFinalization(attempt, () => this.expire(id));
        }, LOGIN_TTL_MS);
        attempt.expiryTimer.unref?.();
        this.attempts.set(id, attempt);

        const capture = (chunk: Buffer | string) => this.capture(attempt, String(chunk));
        child.stdout?.on('data', capture);
        child.stderr?.on('data', capture);
        child.once('error', () => {
          this.beginFinalization(attempt, () => (
            this.finishFailure(attempt, 'The provider login could not be started.')
          ));
        });
        child.once('close', (code) => {
          this.beginFinalization(attempt, () => this.finishClose(attempt, code));
        });
        return safeFlow(attempt);
      } catch {
        if (this.activeTargets.get(key) === id) this.activeTargets.delete(key);
        await rm(stagingHome, { recursive: true, force: true }).catch(() => {});
        throw new Error('The provider login could not be started.');
      }
    })();
    return this.trackOperation(operation);
  }

  status(id: string): CredentialLoginFlow {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error('Login attempt not found or no longer available.');
    return safeFlow(attempt);
  }

  async submitCode(id: string, rawCode: string): Promise<CredentialLoginFlow> {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error('Login attempt not found or no longer available.');
    if (attempt.public.provider !== 'claude' || !attempt.public.requiresCodeEntry) {
      throw new Error('This provider does not accept a code in HappyHerd.');
    }
    if (attempt.settled || attempt.public.state !== 'waiting-user') {
      throw new Error('This login attempt is not waiting for a code.');
    }
    const code = rawCode.trim();
    if (!code || code.length > 4_096 || /[\r\n]/.test(code)) {
      throw new Error('Enter the one-time code from the provider.');
    }
    if (!attempt.child.stdin?.writable) throw new Error('The provider login is no longer accepting a code.');
    attempt.public = { ...attempt.public, state: 'starting' };
    try {
      await new Promise<void>((resolveWrite, rejectWrite) => {
        attempt.child.stdin!.write(`${code}\n`, (error) => error ? rejectWrite(error) : resolveWrite());
      });
    } catch {
      if (!attempt.settled) attempt.public = { ...attempt.public, state: 'waiting-user' };
      throw new Error('The provider login did not accept the code.');
    }
    return safeFlow(attempt);
  }

  async cancel(id: string): Promise<CredentialLoginFlow> {
    const attempt = this.attempts.get(id);
    if (!attempt) throw new Error('Login attempt not found or no longer available.');
    await this.beginFinalization(attempt, async () => {
      if (!this.claim(attempt)) return;
      await this.terminate(attempt);
      await rm(attempt.stagingHome, { recursive: true, force: true }).catch(() => {});
      this.finish(attempt, { ...attempt.public, state: 'canceled' });
    });
    return safeFlow(attempt);
  }

  async dispose(): Promise<void> {
    this.closing = true;
    await Promise.allSettled([...this.pendingOperations]);
    for (const attempt of this.attempts.values()) {
      this.beginFinalization(attempt, async () => {
        if (!this.claim(attempt)) return;
        try {
          await this.terminate(attempt);
          await rm(attempt.stagingHome, { recursive: true, force: true }).catch(() => {});
        } finally {
          this.releaseTarget(attempt);
        }
      });
    }
    await Promise.all([...this.finalizations]);
    this.attempts.clear();
    this.activeTargets.clear();
  }

  private capture(attempt: LoginAttempt, chunk: string): void {
    if (attempt.settled) return;
    attempt.output = `${attempt.output}${chunk}`.slice(-MAX_CAPTURE_CHARS);
    const output = sanitizedOutput(attempt.output);
    const verificationUrl = providerUrl(attempt.public.provider, output);
    const userCode = attempt.public.provider === 'claude'
      ? undefined
      : providerCode(output);
    if (verificationUrl) {
      attempt.public = {
        ...attempt.public,
        state: 'waiting-user',
        verificationUrl,
        ...(userCode ? { userCode } : {}),
      };
    }
  }

  private async finishClose(attempt: LoginAttempt, code: number | null): Promise<void> {
    if (!this.claim(attempt)) return;
    if (code !== 0) {
      await this.completeFailure(attempt, 'The provider login did not complete.', false);
      return;
    }
    try {
      await this.commit(attempt);
      this.finish(attempt, { ...attempt.public, state: 'succeeded' });
    } catch {
      await this.completeFailure(attempt, 'The provider login completed without a usable credential.', false);
    }
  }

  private async commit(attempt: LoginAttempt): Promise<void> {
    const { provider, name } = attempt.public;
    if (provider === 'claude') {
      const token = sanitizedOutput(attempt.output).match(/sk-ant-[A-Za-z0-9_-]+/)?.[0];
      if (!token) throw new Error('missing token');
      await this.commitLogin({
        provider,
        name,
        token,
      }, { paths: this.paths, target: attempt.loginTarget });
    } else {
      const stagedAuthFile = join(attempt.stagingHome, 'auth.json');
      const bytes = await readFile(stagedAuthFile);
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      if (!validProviderAuth(provider, parsed)) throw new Error('invalid auth file');
      await this.commitLogin({
        provider,
        name,
        authFile: bytes,
      }, { paths: this.paths, target: attempt.loginTarget });
    }
    await rm(attempt.stagingHome, { recursive: true, force: true }).catch(() => {});
  }

  private async finishFailure(attempt: LoginAttempt, error: string): Promise<void> {
    if (!this.claim(attempt)) return;
    await this.completeFailure(attempt, error);
  }

  private async completeFailure(attempt: LoginAttempt, error: string, terminate = true): Promise<void> {
    if (terminate) await this.terminate(attempt);
    await rm(attempt.stagingHome, { recursive: true, force: true }).catch(() => {});
    this.finish(attempt, { ...attempt.public, state: 'failed', error });
  }

  private async expire(id: string): Promise<void> {
    const attempt = this.attempts.get(id);
    if (!attempt || !this.claim(attempt)) return;
    await this.terminate(attempt);
    await rm(attempt.stagingHome, { recursive: true, force: true }).catch(() => {});
    this.finish(attempt, { ...attempt.public, state: 'expired', error: 'The provider login expired.' });
  }

  async withTargetReservations<T>(
    targets: Array<{ provider: ManagedCredentialProvider; name: string }>,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.closing) throw new Error('Credential account management is shutting down.');
    const keys = [...new Set(targets.map((target) => (
      targetKey(target.provider, validateAccountName(target.name))
    )))];
    if (keys.some((key) => this.activeTargets.has(key))) {
      throw new Error('Cancel the active login before changing this account.');
    }
    const reservation = `mutation:${randomUUID()}`;
    for (const key of keys) this.activeTargets.set(key, reservation);
    const pending = (async () => {
      try {
        return await operation();
      } finally {
        for (const key of keys) {
          if (this.activeTargets.get(key) === reservation) this.activeTargets.delete(key);
        }
      }
    })();
    return this.trackOperation(pending);
  }

  private async terminate(attempt: LoginAttempt): Promise<void> {
    if (attempt.child.exitCode !== null && attempt.child.exitCode !== undefined) return;
    await new Promise<void>((resolveClose) => {
      let done = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        attempt.child.removeListener('close', finish);
        resolveClose();
      };
      attempt.child.once('close', finish);
      attempt.child.kill('SIGTERM');
      timer = setTimeout(() => {
        attempt.child.kill('SIGKILL');
        finish();
      }, TERMINATE_GRACE_MS);
      timer.unref?.();
    });
  }

  private claim(attempt: LoginAttempt): boolean {
    if (attempt.settled) return false;
    attempt.settled = true;
    clearTimeout(attempt.expiryTimer);
    return true;
  }

  private finish(attempt: LoginAttempt, flow: CredentialLoginFlow): void {
    attempt.output = '';
    attempt.public = flow;
    this.releaseTarget(attempt);
    this.scheduleRemoval(attempt);
  }

  private releaseTarget(attempt: LoginAttempt): void {
    if (this.activeTargets.get(attempt.targetKey) === attempt.public.id) {
      this.activeTargets.delete(attempt.targetKey);
    }
  }

  private beginFinalization(attempt: LoginAttempt, operation: () => Promise<void>): Promise<void> {
    if (attempt.finalization) return attempt.finalization;
    const finalization = operation();
    attempt.finalization = finalization;
    this.finalizations.add(finalization);
    void finalization.then(
      () => this.finalizations.delete(finalization),
      () => this.finalizations.delete(finalization),
    );
    return finalization;
  }

  private scheduleRemoval(attempt: LoginAttempt): void {
    const timer = setTimeout(() => this.attempts.delete(attempt.public.id), FINISHED_TTL_MS);
    timer.unref?.();
  }

  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.pendingOperations.add(operation);
    void operation.then(
      () => this.pendingOperations.delete(operation),
      () => this.pendingOperations.delete(operation),
    );
    return operation;
  }
}
