import { describe, expect, it, vi } from 'vitest';
import type { SessionUpdate as AcpSdkSessionUpdate } from '@agentclientprotocol/sdk';

import type { AgentMessage } from '../core';
import type { HandlerContext } from './sessionUpdateHandlers';
import {
  handleToolCall,
  handleToolCallUpdate,
} from './sessionUpdateHandlers';

function createContext() {
  const emitted: AgentMessage[] = [];
  const context = {
    transport: {
      agentName: 'grok',
      getInitTimeout: () => 1_000,
      filterStdout: (line: string) => line,
      filterStderr: (line: string) => line,
    },
    activeToolCalls: new Set<string>(),
    toolCallStartTimes: new Map<string, number>(),
    toolCallTimeouts: new Map<string, NodeJS.Timeout>(),
    toolCallIdToNameMap: new Map<string, string>(),
    toolCallDescriptors: new Map(),
    idleTimeout: null,
    toolCallCountSincePrompt: 0,
    emit: (message: AgentMessage) => emitted.push(message),
    emitIdleStatus: vi.fn(),
    clearIdleTimeout: vi.fn(),
    setIdleTimeout: vi.fn(),
  } as unknown as HandlerContext;

  return { context, emitted };
}

describe('ACP spec-shaped tool updates', () => {
  it('preserves provider id, title, category, raw input, and sparse completion output', () => {
    const { context, emitted } = createContext();

    const start = {
      sessionUpdate: 'tool_call',
      toolCallId: 'grok-tool-17',
      title: 'Run focused tests',
      status: 'in_progress',
      rawInput: {
        command: 'pnpm vitest run src/agent/acp',
        env: { CI: true },
      },
      content: [{
        type: 'content',
        content: { type: 'text', text: 'Starting test process' },
      }],
      locations: [{ path: 'src/agent/acp' }],
    } satisfies AcpSdkSessionUpdate;
    handleToolCall(start, context);

    const completed = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'grok-tool-17',
      status: 'completed',
      rawOutput: {
        exitCode: 0,
        stdout: '12 tests passed',
      },
    } satisfies AcpSdkSessionUpdate;
    handleToolCallUpdate(completed, context);

    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-call',
        callId: 'grok-tool-17',
        toolName: 'unknown',
        title: 'Run focused tests',
        args: {
          command: 'pnpm vitest run src/agent/acp',
          env: { CI: true },
          locations: [{ path: 'src/agent/acp' }],
        },
      }),
      expect.objectContaining({
        type: 'tool-result',
        callId: 'grok-tool-17',
        toolName: 'unknown',
        title: 'Run focused tests',
        result: {
          exitCode: 0,
          stdout: '12 tests passed',
        },
      }),
    ]));
  });

  it('preserves structured failed output and a renderable error across a sparse update', () => {
    const { context, emitted } = createContext();

    const start = {
      sessionUpdate: 'tool_call',
      toolCallId: 'grok-tool-18',
      title: 'Build the web app',
      kind: 'execute',
      rawInput: { command: 'pnpm build' },
    } satisfies AcpSdkSessionUpdate;
    handleToolCall(start, context);

    const failed = {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'grok-tool-18',
      status: 'failed',
      rawOutput: {
        error: { message: 'TypeScript compilation failed' },
        exitCode: 2,
      },
    } satisfies AcpSdkSessionUpdate;
    handleToolCallUpdate(failed, context);

    expect(emitted).toContainEqual(expect.objectContaining({
      type: 'tool-result',
      callId: 'grok-tool-18',
      toolName: 'execute',
      title: 'Build the web app',
      result: {
        error: { message: 'TypeScript compilation failed' },
        exitCode: 2,
      },
      error: 'TypeScript compilation failed',
    }));
  });
});
