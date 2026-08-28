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
  it.each(['raw-output-first', 'content-first'] as const)(
    'preserves raw output when %s updates complete with a status-only delta',
    (fieldOrder) => {
      const { context, emitted } = createContext();
      const callId = `grok-tool-independent-success-${fieldOrder}`;
      const rawOutputUpdate = {
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        rawOutput: { exitCode: 0, stdout: 'structured result' },
      } satisfies AcpSdkSessionUpdate;
      const contentUpdate = {
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        content: [{
          type: 'content',
          content: { type: 'text', text: 'Human-readable result' },
        }],
      } satisfies AcpSdkSessionUpdate;

      handleToolCall({
        sessionUpdate: 'tool_call',
        toolCallId: callId,
        title: 'Run independent outcome test',
        kind: 'execute',
      } satisfies AcpSdkSessionUpdate, context);
      for (const update of fieldOrder === 'raw-output-first'
        ? [rawOutputUpdate, contentUpdate]
        : [contentUpdate, rawOutputUpdate]) {
        handleToolCallUpdate(update, context);
      }
      handleToolCallUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        status: 'completed',
      } satisfies AcpSdkSessionUpdate, context);

      expect(emitted.at(-1)).toEqual(expect.objectContaining({
        type: 'tool-result',
        callId,
        result: { exitCode: 0, stdout: 'structured result' },
      }));
    },
  );

  it.each(['raw-output-first', 'content-first'] as const)(
    'preserves structured failure output and provider detail when %s updates fail with a status-only delta',
    (fieldOrder) => {
      const { context, emitted } = createContext();
      const callId = `grok-tool-independent-failure-${fieldOrder}`;
      const rawOutputUpdate = {
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        rawOutput: { exitCode: 2, stderr: 'command failed' },
      } satisfies AcpSdkSessionUpdate;
      const contentUpdate = {
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        content: [{
          type: 'content',
          content: { type: 'text', text: 'Provider rejected the command' },
        }],
      } satisfies AcpSdkSessionUpdate;

      handleToolCall({
        sessionUpdate: 'tool_call',
        toolCallId: callId,
        title: 'Run independent failure test',
        kind: 'execute',
      } satisfies AcpSdkSessionUpdate, context);
      for (const update of fieldOrder === 'raw-output-first'
        ? [rawOutputUpdate, contentUpdate]
        : [contentUpdate, rawOutputUpdate]) {
        handleToolCallUpdate(update, context);
      }
      handleToolCallUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: callId,
        status: 'failed',
      } satisfies AcpSdkSessionUpdate, context);

      expect(emitted.at(-1)).toEqual(expect.objectContaining({
        type: 'tool-result',
        callId,
        result: { exitCode: 2, stderr: 'command failed' },
        error: 'Provider rejected the command',
      }));
    },
  );

  it('accumulates split descriptor and output updates before status-only completion', () => {
    const { context, emitted } = createContext();

    handleToolCall({
      sessionUpdate: 'tool_call',
      toolCallId: 'grok-tool-split-success',
      title: 'Run tests',
      status: 'in_progress',
      rawInput: { command: 'pnpm test' },
    } satisfies AcpSdkSessionUpdate, context);

    handleToolCallUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'grok-tool-split-success',
      title: 'Run exact ACP tests',
      kind: 'execute',
      rawInput: { command: 'pnpm test --filter acp' },
      rawOutput: { exitCode: 0, stdout: 'all passed' },
    } satisfies AcpSdkSessionUpdate, context);

    handleToolCallUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'grok-tool-split-success',
      status: 'completed',
    } satisfies AcpSdkSessionUpdate, context);

    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-call',
        callId: 'grok-tool-split-success',
        title: 'Run tests',
      }),
      expect.objectContaining({
        type: 'tool-call',
        callId: 'grok-tool-split-success',
        toolName: 'execute',
        title: 'Run exact ACP tests',
        args: { command: 'pnpm test --filter acp' },
      }),
      expect.objectContaining({
        type: 'tool-result',
        callId: 'grok-tool-split-success',
        toolName: 'execute',
        title: 'Run exact ACP tests',
        result: { exitCode: 0, stdout: 'all passed' },
      }),
    ]));
  });

  it('accumulates split failure output before status-only failure', () => {
    const { context, emitted } = createContext();

    handleToolCall({
      sessionUpdate: 'tool_call',
      toolCallId: 'grok-tool-split-failure',
      title: 'Build app',
      kind: 'execute',
    } satisfies AcpSdkSessionUpdate, context);
    handleToolCallUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'grok-tool-split-failure',
      rawOutput: { error: { message: 'compile failed' }, exitCode: 2 },
    } satisfies AcpSdkSessionUpdate, context);
    handleToolCallUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'grok-tool-split-failure',
      status: 'failed',
    } satisfies AcpSdkSessionUpdate, context);

    expect(emitted.at(-1)).toEqual(expect.objectContaining({
      type: 'tool-result',
      callId: 'grok-tool-split-failure',
      title: 'Build app',
      result: { error: { message: 'compile failed' }, exitCode: 2 },
      error: 'compile failed',
    }));
  });

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
