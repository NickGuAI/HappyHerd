import { describe, expect, it, vi } from 'vitest';

const mockLoggerDebug = vi.hoisted(() => vi.fn());

vi.mock('@/ui/logger', () => ({
  logger: { debug: mockLoggerDebug },
}));

import { AcpBackend } from './AcpBackend';

describe('ACP backend logging', () => {
  it('redacts image data from an otherwise unhandled session update', () => {
    const sentinel = 'PRIVATE_USER_IMAGE_PAYLOAD_SENTINEL';
    const backend = new AcpBackend({
      agentName: 'grok',
      cwd: '/repo',
      command: 'grok',
      permissionHandler: {
        handleToolCall: vi.fn(async () => ({ decision: 'denied' as const })),
      },
    });

    (backend as unknown as {
      handleSessionUpdate: (params: unknown) => void;
    }).handleSessionUpdate({
      sessionId: 'provider-session',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: {
          type: 'image',
          data: sentinel,
          mimeType: 'image/jpeg',
        },
      },
    });

    const logs = JSON.stringify(mockLoggerDebug.mock.calls);
    expect(logs).not.toContain(sentinel);
    expect(logs).toContain('base64Length');
  });

  it('preserves usage updates as context and cumulative-cost evidence', () => {
    const backend = new AcpBackend({
      agentName: 'dsh',
      cwd: '/repo',
      command: 'dsh',
      permissionHandler: {
        handleToolCall: vi.fn(async () => ({ decision: 'denied' as const })),
      },
    });
    const messages: unknown[] = [];
    backend.onMessage((message) => messages.push(message));

    (backend as unknown as {
      handleSessionUpdate: (params: unknown) => void;
    }).handleSessionUpdate({
      sessionId: 'provider-session',
      update: {
        sessionUpdate: 'usage_update',
        used: 42_123,
        size: 131_072,
        cost: { amount: 0.3, currency: 'USD' },
      },
    });

    expect(messages).toEqual([expect.objectContaining({
      type: 'token-count',
      usageSource: 'acp-usage-update',
      used: 42_123,
      size: 131_072,
      cost: { amount: 0.3, currency: 'USD' },
    })]);
  });
});
