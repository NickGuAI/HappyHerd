/** Exercises Saved Credentials with a loopback API and real child processes using synthetic secrets. */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type SavedCredentialSummary } from '@happyherd/wire';

import { handleCredentialsCommand } from '@/commands/credentials';
import { configuration } from '@/configuration';

const token = 'synthetic-bearer-token-never-print';
const firstSecret = 'synthetic-first-secret = "quotes"\n第二行';
const secondSecret = 'synthetic-second-secret-with-spaces ';
const first: SavedCredentialSummary = {
  id: 'credential-first',
  name: 'Work token=primary',
  type: 'token',
  service: 'Example service',
  username: 'test-user',
  usage: ['skills', 'mcp'],
  version: 1,
  createdAt: 10,
  updatedAt: 20,
};
const second: SavedCredentialSummary = {
  ...first,
  id: 'credential/second ?#%',
  name: 'Second login',
  type: 'login',
  service: '',
  username: null,
  usage: [],
};
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

interface Reply {
  status: number;
  body: unknown;
  raw?: string;
  disconnect?: boolean;
  hang?: boolean;
}

interface RecordedRequest {
  method: string | undefined;
  path: string | undefined;
  headers: IncomingHttpHeaders;
}

type Dependencies = NonNullable<Parameters<typeof handleCredentialsCommand>[1]>;

describe('credentials command', (): void => {
  let server: Server;
  let requests: RecordedRequest[];
  let listReply: Reply;
  let revealReplies: Map<string, Reply>;
  let dependencies: Dependencies;
  let captured: string[];
  let directory: string;
  let marker: string;

  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'happyherd-credentials-test-'));
    marker = join(directory, 'child.json');
    requests = [];
    captured = [];
    listReply = { status: 200, body: { credentials: [first, second] } };
    revealReplies = new Map([
      [`/v1/credentials/${encodeURIComponent(first.id)}/reveal`, { status: 200, body: { id: first.id, secret: firstSecret } }],
      [`/v1/credentials/${encodeURIComponent(second.id)}/reveal`, { status: 200, body: { id: second.id, secret: secondSecret } }],
    ]);
    server = createServer((request, response): void => {
      requests.push({ method: request.method, path: request.url, headers: { ...request.headers } });
      const reply = request.method === 'GET' && request.url === '/v1/credentials'
        ? listReply
        : request.method === 'POST' ? revealReplies.get(request.url ?? '') : undefined;
      if (reply?.disconnect) {
        request.socket.destroy();
        return;
      }
      response.writeHead(reply?.status ?? 404, { 'Content-Type': 'application/json' });
      if (reply?.hang) {
        response.flushHeaders();
        return;
      }
      response.end(reply?.raw ?? JSON.stringify(reply?.body ?? { error: 'Unexpected test request' }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback API address');
    dependencies = {
      serverUrl: `http://127.0.0.1:${address.port}///`,
      readCredentials: async (): Promise<{ token: string }> => ({ token }),
    };
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]): void => { captured.push(format(...values)); });
    vi.spyOn(console, 'error').mockImplementation((...values: unknown[]): void => { captured.push(format(...values)); });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
  });

  afterEach(async (): Promise<void> => {
    vi.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error): void => { if (error) reject(error); else resolve(); });
    });
    await rm(directory, { recursive: true, force: true });
    const output = captured.join('\n');
    for (const value of [token, firstSecret, secondSecret, JSON.stringify(firstSecret).slice(1, -1)]) {
      expect(output.includes(value)).toBe(false);
    }
  });

  function childArguments(): string[] {
    return ['run', '--env', `SAVED_VALUE=${first.id}`, '--', process.execPath, '-e',
      'require("node:fs").writeFileSync(process.argv[1], "started")', marker];
  }

  async function expectCommandError(args: string[], message: string | RegExp, overrides: Dependencies = {}): Promise<void> {
    await expect(handleCredentialsCommand(args, { ...dependencies, ...overrides }).catch((error: unknown): never => {
      // Exercise the message that index.ts prints, without exposing the raw error.
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    })).rejects.toThrow(message);
    expect(existsSync(marker)).toBe(false);
  }

  it('lists parsed JSON summaries without revealing or leaking extra fields, and sends the client headers', async (): Promise<void> => {
    listReply.body = { credentials: [{ ...first, secret: firstSecret }, second], secret: secondSecret };

    expect(await handleCredentialsCommand(['list', '--json'], dependencies)).toBe(0);

    expect(captured).toEqual([JSON.stringify([first, second], null, 2)]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'GET',
      path: '/v1/credentials',
      headers: { authorization: `Bearer ${token}`, 'x-happy-client': `cli-coding-session/${configuration.currentCliVersion}` },
    });
  });

  it('formats text rows, dropping empty service and username parts', async (): Promise<void> => {
    listReply.body = { credentials: [first, second,
      { ...first, id: 'service-only', username: '' },
      { ...first, id: 'username-only', service: '' },
    ] };

    expect(await handleCredentialsCommand(['list'], dependencies)).toBe(0);

    expect(captured).toEqual([
      `${first.name}\ttoken\tskills,mcp\tExample service · test-user\t${first.id}`,
      `${second.name}\tlogin\t-\t-\t${second.id}`,
      `${first.name}\ttoken\tskills,mcp\tExample service\tservice-only`,
      `${first.name}\ttoken\tskills,mcp\ttest-user\tusername-only`,
    ]);
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('prints the empty-list message', async (): Promise<void> => {
    listReply.body = { credentials: [] };
    expect(await handleCredentialsCommand(['list'], dependencies)).toBe(0);
    expect(captured).toEqual(['No saved credentials.']);
  });

  it.each([['--unknown'], ['unexpected'], ['--json', '--json']])('rejects list arguments %j before network I/O', async (...args: string[]): Promise<void> => {
    await expectCommandError(['list', ...args], 'Unknown option or argument');
    expect(requests).toEqual([]);
  });

  it.each([[], ['help'], ['--help'], ['-h']])('shows help for %j without authentication or network I/O', async (...args: string[]): Promise<void> => {
    expect(await handleCredentialsCommand(args, {
      ...dependencies,
      readCredentials: async (): Promise<null> => { throw new Error('Help must not read credentials'); },
    })).toBe(0);
    expect(captured[0]).toContain('happyherd credentials list [--json]');
    expect(captured[0]).toContain('happyherd credentials run --env');
    expect(requests).toEqual([]);
  });

  it('rejects unknown actions', async (): Promise<void> => {
    await expectCommandError(['reveal'], 'Unknown credentials action');
    expect(requests).toEqual([]);
  });

  it('injects exact values by name and id once per credential, preserves argv and the parent environment, and returns exit 7', async (): Promise<void> => {
    const environmentBefore = JSON.stringify(process.env);
    const listenersBefore = signals.map((signal) => process.listeners(signal));
    const script = 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({'
      + 'first: process.env.SAVED_FIRST, alias: process.env.SAVED_ALIAS, second: process.env.SAVED_SECOND,'
      + 'path: process.env.PATH, argv: process.argv.slice(1)})); process.exit(7)';
    const childArgs = [marker, 'literal=argument', '--env', 'untouched'];

    const code = await handleCredentialsCommand([
      'run', '--env', `SAVED_FIRST=${first.name}`, '--env', `SAVED_ALIAS=${first.id}`,
      '--env', `SAVED_SECOND=${second.id}`, '--', process.execPath, '-e', script, ...childArgs,
    ], dependencies);

    const observed = JSON.parse(await readFile(marker, 'utf8')) as {
      first: string; alias: string; second: string; path: string; argv: string[];
    };
    expect(code).toBe(7);
    expect(observed).toEqual({ first: firstSecret, alias: firstSecret, second: secondSecret, path: process.env.PATH, argv: childArgs });
    expect(observed.argv.join(' ')).not.toContain(firstSecret);
    expect(observed.argv.join(' ')).not.toContain(secondSecret);
    expect(JSON.stringify(process.env) === environmentBefore).toBe(true);
    expect(captured).toEqual([]);
    expect(requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: 'GET', path: '/v1/credentials' },
      { method: 'POST', path: `/v1/credentials/${encodeURIComponent(first.id)}/reveal` },
      { method: 'POST', path: `/v1/credentials/${encodeURIComponent(second.id)}/reveal` },
    ]);
    for (const request of requests) {
      expect(request.headers.authorization).toBe(`Bearer ${token}`);
      expect(request.headers['x-happy-client']).toBe(`cli-coding-session/${configuration.currentCliVersion}`);
    }
    expect(signals.map((signal) => process.listeners(signal))).toEqual(listenersBefore);
  });

  it('preserves an empty secret and an environment variable named __proto__', async (): Promise<void> => {
    revealReplies.set(`/v1/credentials/${first.id}/reveal`, { status: 200, body: { id: first.id, secret: '' } });
    expect(await handleCredentialsCommand([
      'run', '--env', `__proto__=${first.id}`, '--', process.execPath, '-e',
      'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ value: process.env.__proto__ }))', marker,
    ], dependencies)).toBe(0);
    expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({ value: '' });
    expect(captured).toEqual([]);
  });

  it.each(['list', 'run'])('rejects unauthenticated %s without a request', async (action: string): Promise<void> => {
    await expectCommandError(action === 'list' ? ['list'] : childArguments(), 'Not authenticated. Run "happyherd auth login" first.', {
      readCredentials: async (): Promise<null> => null,
    });
    expect(requests).toEqual([]);
  });

  it.each([
    { label: 'invalid VAR', args: ['--env', '1BAD=ref', '--', 'node'], message: 'Invalid environment variable' },
    { label: 'empty VAR', args: ['--env', '=ref', '--', 'node'], message: 'Invalid environment variable' },
    { label: 'duplicate VAR', args: ['--env', 'VALUE=one', '--env', 'VALUE=two', '--', 'node'], message: 'Duplicate environment variable' },
    { label: 'missing separator', args: ['--env', 'VALUE=ref', 'node'], message: 'Expected "--"' },
    { label: 'missing command', args: ['--env', 'VALUE=ref', '--'], message: 'A command is required' },
    { label: 'empty command', args: ['--env', 'VALUE=ref', '--', ''], message: 'A command is required' },
    { label: 'missing env', args: ['--', 'node'], message: 'At least one --env' },
    { label: 'missing pair', args: ['--env', '--', 'node'], message: 'Expected --env' },
    { label: 'malformed pair', args: ['--env', 'VALUE', '--', 'node'], message: 'Expected --env' },
    { label: 'empty REF', args: ['--env', 'VALUE=', '--', 'node'], message: 'required after "="' },
    { label: 'unknown option', args: ['--json', '--', 'node'], message: 'Only --env' },
    { label: 'unexpected argument', args: ['--env', 'VALUE=ref', 'extra', '--', 'node'], message: 'Only --env' },
  ])('rejects $label before authentication or network I/O', async ({ args, message }: { args: string[]; message: string }): Promise<void> => {
    await expectCommandError(['run', ...args], message, {
      readCredentials: async (): Promise<null> => { throw new Error('Invalid arguments must not read credentials'); },
    });
    expect(requests).toEqual([]);
  });

  it('names every unknown reference before revealing any valid reference', async (): Promise<void> => {
    await expectCommandError([
      'run', '--env', `KNOWN=${first.id}`, '--env', 'UNKNOWN=missing-one', '--env', 'OTHER=missing-two',
      '--', process.execPath, '-e', 'process.exit(99)',
    ], /missing-one.*missing-two/);
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('rejects a reference matching one name and another id before any reveal', async (): Promise<void> => {
    listReply.body = { credentials: [first, { ...second, name: first.id }] };
    await expectCommandError([
      'run', '--env', `UNIQUE=${first.name}`, '--env', `AMBIGUOUS=${first.id}`,
      '--', process.execPath, '-e', 'process.exit(99)',
    ], `Saved credential reference "${first.id}" is ambiguous`);
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('resolves a credential whose own name and id are equal only once', async (): Promise<void> => {
    listReply.body = { credentials: [{ ...first, name: first.id }] };
    expect(await handleCredentialsCommand(childArguments(), dependencies)).toBe(0);
    expect(requests).toHaveLength(2);
    expect(await readFile(marker, 'utf8')).toBe('started');
  });

  it.each([
    { label: 'list 401', action: 'list', status: 401, message: 'happyherd auth login' },
    { label: 'reveal 401', action: 'run', status: 401, message: 'happyherd auth login' },
    { label: 'reveal 404', action: 'run', status: 404, message: 'Saved credential not found' },
    { label: 'list 503', action: 'list', status: 503, message: 'HTTP 503' },
    { label: 'reveal 500', action: 'run', status: 500, message: 'HTTP 500' },
  ])('handles $label without exposing the response body or starting the child', async ({ action, status, message }: {
    action: string; status: number; message: string;
  }): Promise<void> => {
    const reply: Reply = { status, body: { error: firstSecret, secret: secondSecret, token } };
    if (action === 'list') listReply = reply;
    else revealReplies.set(`/v1/credentials/${first.id}/reveal`, reply);
    await expectCommandError(action === 'list' ? ['list'] : childArguments(), message);
    expect(requests).toHaveLength(action === 'list' ? 1 : 2);
  });

  it.each([
    { label: 'malformed list JSON', action: 'list', reply: { status: 200, body: null, raw: firstSecret } },
    { label: 'invalid list schema', action: 'list', reply: { status: 200, body: { credentials: [{ secret: firstSecret }] } } },
    { label: 'malformed reveal JSON', action: 'run', reply: { status: 200, body: null, raw: firstSecret } },
    { label: 'invalid reveal schema', action: 'run', reply: { status: 200, body: { id: first.id, secret: { value: firstSecret } } } },
    { label: 'mismatched reveal id', action: 'run', reply: { status: 200, body: { id: firstSecret, secret: secondSecret } } },
  ])('rejects $label without echoing response data or starting the child', async ({ action, reply }: { action: string; reply: Reply }): Promise<void> => {
    if (action === 'list') listReply = reply;
    else revealReplies.set(`/v1/credentials/${first.id}/reveal`, reply);
    await expectCommandError(action === 'list' ? ['list'] : childArguments(), 'Unexpected response');
  });

  it.each(['list', 'run'])('sanitizes network errors during %s', async (action: string): Promise<void> => {
    const reply: Reply = { status: 200, body: null, disconnect: true };
    if (action === 'list') listReply = reply;
    else revealReplies.set(`/v1/credentials/${first.id}/reveal`, reply);
    await expectCommandError(action === 'list' ? ['list'] : childArguments(), 'The HappyHerd server could not be reached.');
  });

  it('bounds response-body reads with a real timeout and reports an unreachable server', async (): Promise<void> => {
    listReply.hang = true;
    await expectCommandError(['list'], 'The HappyHerd server could not be reached.');
  }, 20_000);

  it('sanitizes a missing executable error and removes its signal listeners', async (): Promise<void> => {
    const listenersBefore = signals.map((signal) => process.listeners(signal));
    const command = join(directory, 'nonexistent-executable');
    await expectCommandError(['run', '--env', `VALUE=${first.id}`, '--', command], `Could not start command "${command}".`);
    expect(signals.map((signal) => process.listeners(signal))).toEqual(listenersBefore);
    expect(requests).toHaveLength(2);
  });

  it('sanitizes synchronous spawn failures involving a secret containing a null byte', async (): Promise<void> => {
    revealReplies.set(`/v1/credentials/${first.id}/reveal`, { status: 200, body: { id: first.id, secret: `${firstSecret}\0` } });
    await expectCommandError(childArguments(), `Could not start command "${process.execPath}".`);
  });

  it.each(signals)('forwards %s to the real child, returns its signal exit code, and removes all listeners', async (signal: NodeJS.Signals): Promise<void> => {
    const listenersBefore = signals.map((value) => process.listeners(value));
    const existing = process.listeners(signal);
    const completion = handleCredentialsCommand([
      'run', '--env', `VALUE=${first.id}`, '--', process.execPath, '-e',
      'setTimeout(() => process.exit(99), 3000); require("node:fs").writeFileSync(process.argv[1], "ready")', marker,
    ], dependencies);
    try {
      await vi.waitFor((): void => { expect(existsSync(marker)).toBe(true); }, { timeout: 2000 });
      const forwarding = process.listeners(signal).filter((listener) => !existing.includes(listener));
      expect(forwarding).toHaveLength(1);
      // Invoke only the installed process listener so Vitest's own signal handlers are untouched.
      forwarding[0](signal);
      expect(await completion).toBe(128 + constants.signals[signal]);
      expect(signals.map((value) => process.listeners(value))).toEqual(listenersBefore);
      expect(captured).toEqual([]);
    } finally {
      await completion;
    }
  });
});
