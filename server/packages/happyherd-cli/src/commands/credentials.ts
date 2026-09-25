/** Lists account Saved Credentials and injects revealed values into a child environment. */
import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
import spawn from 'cross-spawn';
import { z } from 'zod';
import {
  SavedCredentialRevealResponseSchema,
  SavedCredentialSummarySchema,
  type SavedCredentialSummary,
} from '@happyherd/wire';

import { configuration } from '@/configuration';
import { readCredentials } from '@/persistence';

interface CredentialsDependencies {
  readCredentials?: () => Promise<{ token: string } | null>;
  serverUrl?: string;
  output?: (message: string) => void;
}

interface RunOptions {
  mappings: Map<string, string>;
  command: string;
  args: string[];
}

const SavedCredentialListSchema = z.object({
  credentials: z.array(SavedCredentialSummarySchema),
});
const authenticationError = 'Not authenticated. Run "happyherd auth login" first.';
const unexpectedResponse = 'Unexpected response from the HappyHerd server.';
const unreachableServer = 'The HappyHerd server could not be reached.';

function parseRunOptions(args: string[]): RunOptions {
  const separator = args.indexOf('--');
  if (separator < 0) throw new Error('Expected "--" before the command.');
  const command = args[separator + 1];
  if (!command) throw new Error('A command is required after "--".');

  const mappings = new Map<string, string>();
  for (let index = 0; index < separator; index += 2) {
    if (args[index] !== '--env') throw new Error('Only --env VAR=<name|id> is allowed before "--".');
    const pair = index + 1 < separator ? args[index + 1] : undefined;
    const equals = pair?.indexOf('=') ?? -1;
    if (pair === undefined || equals < 0) throw new Error('Expected --env VAR=<name|id>.');
    const variable = pair.slice(0, equals);
    const reference = pair.slice(equals + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw new Error('Invalid environment variable name.');
    if (mappings.has(variable)) throw new Error(`Duplicate environment variable: ${variable}.`);
    if (!reference) throw new Error('A saved credential name or id is required after "=".');
    mappings.set(variable, reference);
  }
  if (mappings.size === 0) throw new Error('At least one --env VAR=<name|id> is required.');
  return { mappings, command, args: args.slice(separator + 2) };
}

async function requestCredentials<T>(
  serverUrl: string,
  token: string,
  schema: z.ZodType<T>,
  id?: string,
): Promise<T> {
  const path = id === undefined ? '/v1/credentials' : `/v1/credentials/${encodeURIComponent(id)}/reveal`;
  let response: Response;
  try {
    const options: RequestInit & { cache: 'no-store' } = {
      method: id === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Happy-Client': `cli-coding-session/${configuration.currentCliVersion}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    };
    response = await fetch(`${serverUrl}${path}`, options);
  } catch {
    throw new Error(unreachableServer);
  }
  if (response.status === 401) throw new Error(authenticationError);
  if (response.status === 404 && id !== undefined) throw new Error('Saved credential not found.');
  if (!response.ok) throw new Error(`HappyHerd server returned HTTP ${response.status}.`);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    throw new Error(error instanceof SyntaxError ? unexpectedResponse : unreachableServer);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(unexpectedResponse);
  return parsed.data;
}

function resolveReferences(mappings: Map<string, string>, summaries: SavedCredentialSummary[]): Map<string, string> {
  const targets = new Map<string, string>();
  const errors: string[] = [];
  for (const [variable, reference] of mappings) {
    const matches = summaries.filter((summary) => summary.id === reference || summary.name === reference);
    if (matches.length === 0) {
      errors.push(`Unknown saved credential: "${reference}".`);
    } else if (matches.length > 1) {
      errors.push(`Saved credential reference "${reference}" is ambiguous.`);
    } else {
      targets.set(variable, matches[0].id);
    }
  }
  if (errors.length > 0) throw new Error(errors.join(' '));
  return targets;
}

function runWithCredentials(command: string, args: string[], injected: Record<string, string>): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...injected } });
    } catch {
      reject(new Error(`Could not start command "${command}".`));
      return;
    }

    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const listeners = signals.map((signal) => {
      const forward = (): void => { child.kill(signal); };
      process.on(signal, forward);
      return { signal, forward };
    });
    const cleanup = (): void => {
      for (const { signal, forward } of listeners) process.removeListener(signal, forward);
    };
    child.once('error', (): void => {
      cleanup();
      reject(new Error(`Could not start command "${command}".`));
    });
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      resolve(code ?? (signal ? 128 + constants.signals[signal] : 1));
    });
  });
}

export async function handleCredentialsCommand(
  args: string[],
  dependencies: CredentialsDependencies = {},
): Promise<number> {
  const output = dependencies.output ?? ((message: string): void => { console.log(message); });
  const action = args[0];
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    if (args.length > 1) throw new Error('Unexpected argument after credentials help.');
    output(`
happyherd credentials - Use the signed-in account's Saved Credentials

Usage:
  happyherd credentials list [--json]
  happyherd credentials run --env VAR=<name|id> [--env VAR=<name|id> ...] -- <command> [args...]
  happyherd credentials [help|--help|-h]
`);
    return 0;
  }
  if (action !== 'list' && action !== 'run') throw new Error(`Unknown credentials action: ${action}`);
  if (action === 'list' && (args.length > 2 || args.slice(1).some((arg) => arg !== '--json'))) {
    throw new Error('Unknown option or argument for "credentials list".');
  }
  const run = action === 'run' ? parseRunOptions(args.slice(1)) : undefined;
  const credentials = await (dependencies.readCredentials ?? readCredentials)();
  if (!credentials) throw new Error(authenticationError);
  const serverUrl = (dependencies.serverUrl ?? configuration.serverUrl).replace(/\/+$/, '');
  const { credentials: summaries } = await requestCredentials(serverUrl, credentials.token, SavedCredentialListSchema);

  if (!run) {
    if (args[1] === '--json') {
      output(JSON.stringify(summaries, null, 2));
    } else if (summaries.length === 0) {
      output('No saved credentials.');
    } else {
      for (const summary of summaries) {
        const detail = [summary.service, summary.username].filter(Boolean).join(' · ') || '-';
        output([summary.name, summary.type, summary.usage.join(',') || '-', detail, summary.id].join('\t'));
      }
    }
    return 0;
  }

  const targets = resolveReferences(run.mappings, summaries);
  const injected = new Map<string, string>();
  for (const id of new Set(targets.values())) {
    const revealed = await requestCredentials(serverUrl, credentials.token, SavedCredentialRevealResponseSchema, id);
    if (revealed.id !== id) throw new Error(unexpectedResponse);
    for (const [variable, targetId] of targets) {
      if (targetId === id) injected.set(variable, revealed.secret);
    }
  }
  return runWithCredentials(run.command, run.args, Object.fromEntries(injected));
}
