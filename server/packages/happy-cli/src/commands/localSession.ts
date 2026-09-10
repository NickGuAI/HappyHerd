import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  inspectLocalSession, sendLocalSessionMessage,
  LocalSessionInspectRequestSchema, LocalSessionSendRequestSchema,
  type LocalSessionInspectRequest, type LocalSessionSendRequest,
  type LocalSessionInspectReceipt, type LocalSessionSendReceipt,
} from '@/daemon/localSessionClient';

export type LocalSessionCommandDependencies = {
  readTextFile?: (file: string) => Promise<string>;
  send?: (request: LocalSessionSendRequest) => Promise<LocalSessionSendReceipt>;
  inspect?: (request: LocalSessionInspectRequest) => Promise<LocalSessionInspectReceipt>;
  output?: (message: string) => void;
  setExitCode?: (code: number) => void;
};

function options(args: string[], allowed: readonly string[]) {
  const [sessionId, ...rest] = args;
  if (!sessionId || sessionId.startsWith('-')) throw new Error('An exact session ID is required');
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flags.has(flag)) throw new Error(`Duplicate option ${flag}`);
    if (flag === '--json') { flags.set(flag, true); continue; }
    if (!allowed.includes(flag)) throw new Error(`Unknown option ${flag}`);
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    flags.set(flag, value);
  }
  return { sessionId, flags, json: flags.get('--json') === true };
}

export function parseLocalSessionSendOptions(args: string[]) {
  const parsed = options(args, ['--text-file', '--message-id']);
  const textFile = parsed.flags.get('--text-file');
  const messageId = parsed.flags.get('--message-id');
  if (typeof textFile !== 'string' || !path.isAbsolute(textFile)) throw new Error('--text-file requires an absolute file path');
  if (typeof messageId !== 'string' || !messageId.trim()) throw new Error('--message-id is required for safe message retries');
  LocalSessionSendRequestSchema.pick({ sessionId: true, messageId: true }).parse({ sessionId: parsed.sessionId, messageId });
  return { sessionId: parsed.sessionId, textFile, messageId, json: parsed.json };
}

export function parseLocalSessionInspectOptions(args: string[]) {
  const parsed = options(args, ['--limit']);
  const rawLimit = parsed.flags.get('--limit');
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  return { ...LocalSessionInspectRequestSchema.parse({ sessionId: parsed.sessionId, limit }), json: parsed.json };
}

export async function handleLocalSessionSendCommand(args: string[], dependencies: LocalSessionCommandDependencies = {}): Promise<void> {
  const parsed = parseLocalSessionSendOptions(args);
  const output = dependencies.output ?? console.log;
  let receipt: LocalSessionSendReceipt;
  try {
    const text = await (dependencies.readTextFile ?? (file => readFile(file, 'utf8')))(parsed.textFile);
    const request = LocalSessionSendRequestSchema.parse({ sessionId: parsed.sessionId, messageId: parsed.messageId, text });
    receipt = await (dependencies.send ?? sendLocalSessionMessage)(request);
  } catch (error) {
    receipt = {
      schemaVersion: 1, type: 'session-message', success: false, status: 'failed',
      sessionId: parsed.sessionId, messageId: parsed.messageId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  output(parsed.json ? JSON.stringify(receipt)
    : `${receipt.sessionId}: message ${receipt.messageId} ${receipt.status}${receipt.error ? ` (${receipt.error})` : ''}`);
  if (!receipt.success) (dependencies.setExitCode ?? (code => { process.exitCode = code; }))(1);
}

export async function handleLocalSessionInspectCommand(args: string[], dependencies: LocalSessionCommandDependencies = {}): Promise<void> {
  const parsed = parseLocalSessionInspectOptions(args);
  const receipt = await (dependencies.inspect ?? inspectLocalSession)({ sessionId: parsed.sessionId, limit: parsed.limit });
  (dependencies.output ?? console.log)(JSON.stringify(receipt, null, parsed.json ? undefined : 2));
}
