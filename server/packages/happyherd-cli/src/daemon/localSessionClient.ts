import { z } from 'zod';
import { readDaemonState } from '@/persistence';

const SessionIdSchema = z.string().trim().min(1).max(256);
export const LocalSessionSendRequestSchema = z.object({
  sessionId: SessionIdSchema,
  messageId: z.string().trim().min(1).max(256),
  text: z.string().min(1).max(100_000).refine(value => value.trim().length > 0),
}).strict();
export const LocalSessionInspectRequestSchema = z.object({
  sessionId: SessionIdSchema,
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
export const LocalSessionSendReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('session-message'),
  success: z.boolean(),
  sessionId: SessionIdSchema,
  messageId: z.string(),
  status: z.enum(['queued', 'failed']),
  seq: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});
export const LocalSessionInspectReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('session-inspection'),
  session: z.object({
    id: SessionIdSchema,
    active: z.boolean(),
    providerRunning: z.boolean(),
    seq: z.number(),
    metadata: z.object({
      path: z.string(),
      flavor: z.string().optional(),
      commanderId: z.string().optional(),
      commanderName: z.string().optional(),
      title: z.string().optional(),
      isSuperSession: z.boolean().optional(),
      lifecycleState: z.string().optional(),
    }),
  }),
  recent: z.literal(true),
  limit: z.number().int().min(1).max(100),
  messages: z.array(z.object({
    seq: z.number(), localId: z.string().nullable(), createdAt: z.number(), content: z.unknown(),
  })).max(100),
});

export type LocalSessionSendRequest = z.infer<typeof LocalSessionSendRequestSchema>;
export type LocalSessionInspectRequest = z.infer<typeof LocalSessionInspectRequestSchema>;
export type LocalSessionSendReceipt = z.infer<typeof LocalSessionSendReceiptSchema>;
export type LocalSessionInspectReceipt = z.infer<typeof LocalSessionInspectReceiptSchema>;

async function postLocalSessionRequest(route: string, body: unknown): Promise<unknown> {
  const state = await readDaemonState();
  if (!state?.httpPort) throw new Error('No HappyHerd daemon is running');
  try {
    process.kill(state.pid, 0);
  } catch {
    throw new Error('The recorded HappyHerd daemon is not running');
  }
  const response = await fetch(`http://127.0.0.1:${state.httpPort}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Send includes an authoritative read, encrypted post, and optional resume.
    signal: AbortSignal.timeout(240_000),
  });
  const result = await response.json() as { message?: unknown; error?: unknown };
  if (!response.ok) {
    const message = typeof result.message === 'string' ? result.message
      : typeof result.error === 'string' ? result.error : `HTTP ${response.status}`;
    throw new Error(`Local session request failed: ${message}`);
  }
  return result;
}

export async function sendLocalSessionMessage(request: LocalSessionSendRequest): Promise<LocalSessionSendReceipt> {
  const validated = LocalSessionSendRequestSchema.parse(request);
  const receipt = LocalSessionSendReceiptSchema.parse(await postLocalSessionRequest('/session-send', validated));
  if (receipt.sessionId !== validated.sessionId || receipt.messageId !== validated.messageId) {
    throw new Error('Daemon returned a receipt for another session or message');
  }
  if (receipt.success && (receipt.status !== 'queued' || receipt.seq === undefined)) {
    throw new Error('Daemon did not confirm queued message persistence');
  }
  return receipt;
}

export async function inspectLocalSession(request: LocalSessionInspectRequest): Promise<LocalSessionInspectReceipt> {
  const validated = LocalSessionInspectRequestSchema.parse(request);
  const receipt = LocalSessionInspectReceiptSchema.parse(await postLocalSessionRequest('/session-inspect', validated));
  if (receipt.session.id !== validated.sessionId) throw new Error('Daemon returned another session');
  return receipt;
}
