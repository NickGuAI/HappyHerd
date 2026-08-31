import chalk from 'chalk';
import {
  type HappyHerdAutomationCreateInput,
  type HappyHerdAutomationUpdateInput,
} from '@slopus/happy-wire';
import { daemonAutomationAction } from '@/daemon/controlClient';
import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning';

type Flags = Record<string, string | boolean | string[]>;

function setFlag(flags: Flags, key: string, value: string | true): void {
  if (key === 'tag' || key === 'argument') {
    if (value === true) {
      flags[key] = true;
      return;
    }
    const current = flags[key];
    flags[key] = typeof current === 'string'
      ? [current, value]
      : Array.isArray(current)
        ? [...current, value]
        : value;
    return;
  }
  flags[key] = value;
}

function parseFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const equalsIndex = value.indexOf('=');
    if (equalsIndex > 2) {
      setFlag(flags, value.slice(2, equalsIndex), value.slice(equalsIndex + 1));
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (key === 'argument') {
      if (next === undefined) {
        setFlag(flags, key, true);
      } else {
        setFlag(flags, key, next);
        index += 1;
      }
      continue;
    }
    if (next && !next.startsWith('--')) {
      setFlag(flags, key, next);
      index += 1;
    } else {
      setFlag(flags, key, true);
    }
  }
  return { positional, flags };
}

function repeatedArgumentFlag(flags: Flags): string[] {
  const value = flags.argument;
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.some((entry) => typeof entry !== 'string')) {
    throw new Error('--argument requires a value');
  }
  return values as string[];
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

function inputFromFlags(flags: Flags, partial: false): HappyHerdAutomationCreateInput;
function inputFromFlags(flags: Flags, partial: true): HappyHerdAutomationUpdateInput;
function inputFromFlags(flags: Flags, partial: boolean): HappyHerdAutomationCreateInput | HappyHerdAutomationUpdateInput {
  const name = stringFlag(flags, 'name', !partial);
  const kind = stringFlag(flags, 'kind', !partial);
  const rail = stringFlag(flags, 'rail', !partial);
  const instruction = stringFlag(flags, 'instruction', !partial && rail !== 'exec');
  const executable = stringFlag(flags, 'executable', !partial && rail === 'exec');
  const schedule = stringFlag(flags, 'schedule', !partial);
  const timezone = stringFlag(flags, 'timezone', !partial);
  const workspace = stringFlag(flags, 'workspace', !partial);
  const commander = stringFlag(flags, 'commander');
  const status = stringFlag(flags, 'status');
  const maxRetriesRaw = stringFlag(flags, 'max-retries');
  const tags = repeatedStringFlag(flags, 'tag');
  const commandArguments = repeatedArgumentFlag(flags);
  const clearTags = booleanFlag(flags, 'clear-tags');
  const clearArguments = booleanFlag(flags, 'clear-arguments');
  if (tags.length > 0 && clearTags) {
    throw new Error('--tag and --clear-tags cannot be combined');
  }
  if (commandArguments.length > 0 && clearArguments) {
    throw new Error('--argument and --clear-arguments cannot be combined');
  }
  const execRail = rail === 'exec';
  return {
    ...(name ? { name } : {}),
    ...(kind ? { kind: kind as HappyHerdAutomationCreateInput['kind'] } : {}),
    ...(instruction ? { instruction } : {}),
    ...(executable ? { executable } : {}),
    ...(commandArguments.length > 0
      ? { arguments: commandArguments }
      : clearArguments ? { arguments: [] } : (!partial && execRail ? { arguments: [] } : {})),
    ...(schedule ? { schedule } : {}),
    ...(timezone ? { timezone } : {}),
    ...(workspace ? { workspace } : {}),
    ...(rail ? { rail: rail as HappyHerdAutomationCreateInput['rail'] } : {}),
    ...(commander !== undefined
      ? { commanderId: commander === 'none' ? null : commander }
      : (!partial && !execRail ? { commanderId: null } : {})),
    ...(status ? { status: status as HappyHerdAutomationCreateInput['status'] } : (!partial ? { status: 'active' as const } : {})),
    ...(maxRetriesRaw !== undefined
      ? { maxRetries: Number.parseInt(maxRetriesRaw, 10) }
      : (!partial && !execRail ? { maxRetries: 0 } : {})),
    ...(tags.length > 0 ? { tags } : clearTags ? { tags: [] } : {}),
  } as HappyHerdAutomationCreateInput | HappyHerdAutomationUpdateInput;
}

function help(): void {
  console.log(`
${chalk.bold('happy automation')} - Manage machine-local HappyHerd schedules

Usage:
  happy automation list [--json]
  happy automation create --name NAME --kind scheduled|memory-maintenance \\
    --instruction TEXT --schedule CRON --timezone IANA --workspace PATH \\
    --rail claude|codex [--commander ID|none] [--status active|paused] [--max-retries N] \\
    [--tag VALUE ...]
  happy automation create --name NAME --kind scheduled --rail exec \\
    --executable ABSOLUTE_PATH [--argument VALUE ...] --schedule CRON \\
    --timezone IANA --workspace PATH [--status active|paused] [--tag VALUE ...]
  happy automation update ID [the same optional flags] [--clear-tags] [--clear-arguments]
  happy automation pause|resume|run-now|delete|history ID [--json]
  happy automation stop-run AUTOMATION_ID RUN_ID [--json]
  happy automation abandon-run AUTOMATION_ID RUN_ID --session SESSION_ID|none --confirm ABANDON [--json]

Definitions are stored below the configured HAPPY_HOME_DIR at
agentcontext/automations/happyherd and
executed by this machine's HappyHerd daemon. Only manifests in this namespace
are managed. Agent runs complete when their provider reports a terminal outcome.
Exec runs launch one fixed absolute executable with an exact argument array, shell=false, and no agent session.
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
    case 'stop-run':
      if (!positional[0] || !positional[1]) throw new Error('Automation id and run id are required');
      result = await daemonAutomationAction('stop-run', {
        id: positional[0],
        runId: positional[1],
      });
      break;
    case 'abandon-run': {
      if (!positional[0] || !positional[1]) throw new Error('Automation id and run id are required');
      const session = stringFlag(flags, 'session', true)!;
      const confirmation = stringFlag(flags, 'confirm');
      if (confirmation !== 'ABANDON') throw new Error('--confirm ABANDON is required');
      result = await daemonAutomationAction('abandon-run', {
        id: positional[0],
        runId: positional[1],
        input: {
          sessionId: session === 'none' ? null : session,
          confirmation,
        },
      });
      break;
    }
    default:
      throw new Error(`Unknown automation command: ${action}`);
  }
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}
