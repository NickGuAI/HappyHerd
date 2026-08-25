import chalk from 'chalk';
import {
  HAPPYHERD_AUTOMATION_MAX_TIMEOUT_MINUTES,
  HAPPYHERD_AUTOMATION_MIN_TIMEOUT_MINUTES,
  HappyHerdAutomationTimeoutMinutesSchema,
  type HappyHerdAutomationCreateInput,
  type HappyHerdAutomationUpdateInput,
} from '@slopus/happy-wire';
import { daemonAutomationAction } from '@/daemon/controlClient';
import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning';

type Flags = Record<string, string | boolean | string[]>;

function parseFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      if (key === 'tag') {
        const current = flags[key];
        flags[key] = typeof current === 'string'
          ? [current, next]
          : Array.isArray(current)
            ? [...current, next]
            : next;
      } else {
        flags[key] = next;
      }
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
}

function repeatedStringFlag(flags: Flags, name: string): string[] {
  const value = flags[name];
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`--${name} requires a value`);
  }
  return values.map((entry) => (entry as string).trim());
}

function booleanFlag(flags: Flags, name: string): boolean {
  const value = flags[name];
  if (value === undefined) return false;
  if (value === true) return true;
  throw new Error(`--${name} does not accept a value`);
}

function stringFlag(flags: Flags, name: string, required = false): string | undefined {
  const value = flags[name];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (required) throw new Error(`--${name} is required`);
  return undefined;
}

function timeoutMinutesFlag(flags: Flags): number | undefined {
  const value = flags['timeout-minutes'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    throw new Error('--timeout-minutes requires a whole-number value');
  }
  const parsed = HappyHerdAutomationTimeoutMinutesSchema.safeParse(Number(value));
  if (!parsed.success) {
    throw new Error(
      `--timeout-minutes must be between ${HAPPYHERD_AUTOMATION_MIN_TIMEOUT_MINUTES} and ${HAPPYHERD_AUTOMATION_MAX_TIMEOUT_MINUTES}`,
    );
  }
  return parsed.data;
}

function timeoutFlag(flags: Flags): number | null | undefined {
  const noTimeout = booleanFlag(flags, 'no-timeout');
  if (noTimeout && flags['timeout-minutes'] !== undefined) {
    throw new Error('--timeout-minutes and --no-timeout cannot be combined');
  }
  return noTimeout ? null : timeoutMinutesFlag(flags);
}

function inputFromFlags(flags: Flags, partial: false): HappyHerdAutomationCreateInput;
function inputFromFlags(flags: Flags, partial: true): HappyHerdAutomationUpdateInput;
function inputFromFlags(flags: Flags, partial: boolean): HappyHerdAutomationCreateInput | HappyHerdAutomationUpdateInput {
  const name = stringFlag(flags, 'name', !partial);
  const kind = stringFlag(flags, 'kind', !partial);
  const instruction = stringFlag(flags, 'instruction', !partial);
  const schedule = stringFlag(flags, 'schedule', !partial);
  const timezone = stringFlag(flags, 'timezone', !partial);
  const workspace = stringFlag(flags, 'workspace', !partial);
  const rail = stringFlag(flags, 'rail', !partial);
  const commander = stringFlag(flags, 'commander');
  const status = stringFlag(flags, 'status');
  const maxRetriesRaw = stringFlag(flags, 'max-retries');
  const timeoutMinutes = timeoutFlag(flags);
  const tags = repeatedStringFlag(flags, 'tag');
  const clearTags = booleanFlag(flags, 'clear-tags');
  if (tags.length > 0 && clearTags) {
    throw new Error('--tag and --clear-tags cannot be combined');
  }
  return {
    ...(name ? { name } : {}),
    ...(kind ? { kind: kind as HappyHerdAutomationCreateInput['kind'] } : {}),
    ...(instruction ? { instruction } : {}),
    ...(schedule ? { schedule } : {}),
    ...(timezone ? { timezone } : {}),
    ...(workspace ? { workspace } : {}),
    ...(rail ? { rail: rail as HappyHerdAutomationCreateInput['rail'] } : {}),
    ...(commander !== undefined ? { commanderId: commander === 'none' ? null : commander } : (!partial ? { commanderId: null } : {})),
    ...(status ? { status: status as HappyHerdAutomationCreateInput['status'] } : (!partial ? { status: 'active' as const } : {})),
    ...(maxRetriesRaw !== undefined
      ? { maxRetries: Number.parseInt(maxRetriesRaw, 10) }
      : (!partial ? { maxRetries: 0 } : {})),
    ...(timeoutMinutes !== undefined ? { timeoutMinutes } : {}),
    ...(tags.length > 0 ? { tags } : clearTags ? { tags: [] } : {}),
  } as HappyHerdAutomationCreateInput | HappyHerdAutomationUpdateInput;
}

function help(): void {
  console.log(`
${chalk.bold('happy automation')} - Manage machine-local HappyHerd schedules

Usage:
  happy automation list [--json]
  happy automation create --name NAME --kind scheduled|heartbeat|memory-maintenance \\
    --instruction TEXT --schedule CRON --timezone IANA --workspace PATH \\
    --rail claude|codex [--commander ID|none] [--status active|paused] [--max-retries N] \\
    [--timeout-minutes N | --no-timeout] [--tag VALUE ...]
  happy automation update ID [the same optional flags] [--clear-tags]
  happy automation pause|resume|run-now|delete|history ID [--json]

Definitions are stored below the configured HAPPY_HOME_DIR at
agentcontext/automations/happyherd and
executed by this machine's HappyHerd daemon. Only manifests in this namespace
are managed. --no-timeout lets the provider run until it completes or the
session is otherwise stopped.
`);
}

export async function handleAutomationCommand(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    help();
    return;
  }
  const { positional, flags } = parseFlags(rest);
  await ensureDaemonRunning();
  let result: unknown;
  switch (action) {
    case 'list':
      result = await daemonAutomationAction('list');
      break;
    case 'create':
      result = await daemonAutomationAction('create', { input: inputFromFlags(flags, false) });
      break;
    case 'update':
      if (!positional[0]) throw new Error('Automation id is required');
      result = await daemonAutomationAction('update', { id: positional[0], input: inputFromFlags(flags, true) });
      break;
    case 'pause':
    case 'resume':
    case 'delete':
    case 'run-now':
    case 'history':
      if (!positional[0]) throw new Error('Automation id is required');
      result = await daemonAutomationAction(action, { id: positional[0] });
      break;
    default:
      throw new Error(`Unknown automation command: ${action}`);
  }
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}
