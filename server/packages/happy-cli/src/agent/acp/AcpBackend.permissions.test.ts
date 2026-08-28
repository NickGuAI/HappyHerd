import { describe, expect, it, vi } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import { AcpBackend, resolveAcpPermissionResponse } from './AcpBackend';
import { GeminiPermissionHandler } from '@/gemini/utils/permissionHandler';

const options = [
  { optionId: 'provider-once', name: 'Approve once', kind: 'allow_once' },
  { optionId: 'provider-always', name: 'Approve always', kind: 'allow_always' },
  { optionId: 'provider-deny', name: 'Reject', kind: 'reject_once' },
] as const;

describe('ACP permission responses', () => {
  it('returns the provider option ID matching the standard permission kind', () => {
    expect(resolveAcpPermissionResponse([...options], 'approved')).toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-once' },
    });
    expect(resolveAcpPermissionResponse([...options], 'approved_for_session')).toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-always' },
    });
    expect(resolveAcpPermissionResponse([...options], 'denied')).toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-deny' },
    });
  });

  it('cancels instead of inventing an option ID on abort or mismatch', () => {
    expect(resolveAcpPermissionResponse([...options], 'abort')).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(resolveAcpPermissionResponse([], 'approved')).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(resolveAcpPermissionResponse([
      { optionId: 'provider-always', name: 'Approve always', kind: 'allow_always' },
    ], 'approved')).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('prefers the narrow provider approval option for a non-interactive bypass', () => {
    expect(resolveAcpPermissionResponse([...options], 'approved_without_prompt')).toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-once' },
    });
    expect(resolveAcpPermissionResponse([
      { optionId: 'provider-always', name: 'Approve always', kind: 'allow_always' },
    ], 'approved_without_prompt')).toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-always' },
    });
  });
});

const rawPermissionRequest = {
  sessionId: 'provider-session-1',
  toolCall: {
    toolCallId: 'grok-tool-17',
    title: 'Run focused tests',
    kind: 'execute',
    rawInput: { command: 'pnpm test' },
  },
  options: [...options],
} satisfies RequestPermissionRequest;

function createBackend(permissionHandler: object, agentName = 'grok') {
  const backend = new AcpBackend({
    agentName,
    cwd: '/repo',
    command: 'grok',
    permissionHandler: permissionHandler as never,
  });
  const messages: Array<Record<string, unknown>> = [];
  backend.onMessage((message) => messages.push(message as unknown as Record<string, unknown>));
  return { backend, messages };
}

describe('ACP permission callback handling', () => {
  it('auto-approves bypass without emitting or storing a pending prompt', async () => {
    const handleToolCall = vi.fn(async () => ({ decision: 'approved_without_prompt' as const }));
    const { backend, messages } = createBackend({
      requiresUserInput: () => false,
      handleToolCall,
    });

    const response = await backend.handlePermissionRequest(rawPermissionRequest);

    expect(response).toEqual({ outcome: { outcome: 'selected', optionId: 'provider-once' } });
    expect(handleToolCall).toHaveBeenCalledOnce();
    expect(handleToolCall).toHaveBeenCalledWith(
      'grok-tool-17',
      'execute',
      { command: 'pnpm test' },
      'Run focused tests',
    );
    expect(messages.filter((message) => message.type === 'permission-request')).toHaveLength(0);
    expect(messages.filter((message) => message.type === 'tool-result')).toHaveLength(0);
  });

  it('emits one prompt for an interactive callback and no synthetic tool result', async () => {
    let resolveDecision: ((value: { decision: 'approved' }) => void) | undefined;
    const handleToolCall = vi.fn(() => new Promise<{ decision: 'approved' }>((resolve) => {
      resolveDecision = resolve;
    }));
    const { backend, messages } = createBackend({
      requiresUserInput: () => true,
      handleToolCall,
    });

    const responsePromise = backend.handlePermissionRequest(rawPermissionRequest);
    await vi.waitFor(() => {
      expect(messages.filter((message) => message.type === 'permission-request')).toHaveLength(1);
    });

    resolveDecision?.({ decision: 'approved' });
    await expect(responsePromise).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'provider-once' },
    });
    expect(handleToolCall).toHaveBeenCalledOnce();
    expect(messages.filter((message) => message.type === 'permission-request')).toHaveLength(1);
    expect(messages.filter((message) => message.type === 'tool-result')).toHaveLength(0);
  });

  it.each(['safe-yolo', 'read-only'] as const)(
    'keeps titled execute callbacks pending under Gemini %s policy',
    async (permissionMode) => {
      let state: Record<string, any> = {};
      const session = {
        rpcHandlerManager: {
          registerHandler: vi.fn(),
        },
        updateAgentState: vi.fn((updater: (currentState: Record<string, any>) => Record<string, any>) => {
          state = updater(state);
          return state;
        }),
      };
      const permissionHandler = new GeminiPermissionHandler(session as never);
      permissionHandler.setPermissionMode(permissionMode);
      const { backend } = createBackend(permissionHandler, 'gemini');
      const callback = {
        ...rawPermissionRequest,
        toolCall: {
          ...rawPermissionRequest.toolCall,
          toolCallId: 'gemini-tool-17',
          title: 'Run deployment command',
        },
      } satisfies RequestPermissionRequest;

      const responsePromise = backend.handlePermissionRequest(callback);
      await vi.waitFor(() => {
        expect(state.requests?.['gemini-tool-17']).toMatchObject({
          tool: 'Run deployment command',
          arguments: { command: 'pnpm test' },
        });
      });
      expect(state.completedRequests?.['gemini-tool-17']).toBeUndefined();

      permissionHandler.abortAll();
      await expect(responsePromise).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    },
  );
});
