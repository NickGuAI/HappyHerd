import chalk from 'chalk';
import type { HappyHerdAutomationCreateInput, HappyHerdAutomationUpdateInput } from '@slopus/happy-wire';
import { daemonAutomationAction } from '@/daemon/controlClient';
import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning';

type Flags = Record<string, string | boolean>;

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
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { positional, flags };
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
  const instruction = stringFlag(flags, 'instruction', !partial);
  const schedule = stringFlag(flags, 'schedule', !partial);
  const timezone = stringFlag(flags, 'timezone', !partial);
  const workspace = stringFlag(flags, 'workspace', !partial);
  const rail = stringFlag(flags, 'rail', !partial);
  const commander = stringFlag(flags, 'commander');
  const status = stringFlag(flags, 'status');
  const maxRetriesRaw = stringFlag(flags, 'max-retries');
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
  } as HappyHerdAutomationCreateInput | HappyHerdAutomationUpdateInput;
}

function help(): void {
  console.log(`
${chalk.bold('happy automation')} - Manage machine-local HappyHerd schedules

Usage:
  happy automation list [--json]
  happy automation create --name NAME --kind scheduled|heartbeat|memory-maintenance \\
    --instruction TEXT --schedule CRON --timezone IANA --workspace PATH \\
    --rail claude|codex [--commander ID|none] [--status active|paused] [--max-retries N]
  happy automation update ID [the same optional flags]
  happy automation pause|resume|run-now|delete|history ID [--json]

Definitions are stored below ~/.herd/agentcontext/automations/happyherd and
executed by this machine's HappyHerd daemon. Legacy Herd definitions are not claimed.
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
