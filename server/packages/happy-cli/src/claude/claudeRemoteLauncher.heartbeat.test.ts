import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    let unattended = false;
    return {
        claudeRemote: vi.fn(),
        setUnattended(value: boolean) {
            unattended = value;
        },
        permissionToolCall: vi.fn(async () => {
            if (unattended) throw new Error('Unattended Claude automation requested interactive permission for AskUserQuestion');
            return { behavior: 'allow' };
        }),
    };
});

vi.mock('./claudeRemote', () => ({ claudeRemote: mocks.claudeRemote }));
vi.mock('ink', () => ({ render: vi.fn() }));
vi.mock('@/ui/ink/messageBuffer', () => ({
    MessageBuffer: class {
        addMessage = vi.fn();
        clear = vi.fn();
    },
}));
vi.mock('@/ui/ink/RemoteModeDisplay', () => ({ RemoteModeDisplay: () => null }));
vi.mock('@/ui/messageFormatterInk', () => ({ formatClaudeMessageForInk: vi.fn() }));
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), debugLargeJson: vi.fn() },
}));
vi.mock('./utils/permissionHandler', () => ({
    PermissionHandler: class {
        constructor(_session: unknown, options?: { unattended?: boolean }) {
            mocks.setUnattended(Boolean(options?.unattended));
        }
        reset = vi.fn();
        setOnPermissionRequest = vi.fn();
        getResponseLookup = vi.fn(() => new Map());
        handleToolCall = mocks.permissionToolCall;
        isAborted = vi.fn(() => false);
        handleModeChange = vi.fn();
        setPermissionModeUpdater = vi.fn();
        clearPermissionModeUpdater = vi.fn();
        getResponseForToolUseId = vi.fn();
    },
}));
vi.mock('./utils/SDKToLogConverter', () => ({
    SDKToLogConverter: class {
        convert = vi.fn(() => null);
        resetParentChain = vi.fn();
        updateSessionId = vi.fn();
        convertSidechainUserMessage = vi.fn(() => null);
        generateInterruptedToolResult = vi.fn(() => null);
    },
}));
vi.mock('./utils/OutgoingMessageQueue', () => ({
    OutgoingMessageQueue: class {
        enqueue = vi.fn();
        releaseToolCall = vi.fn();
        flush = vi.fn(async () => undefined);
        destroy = vi.fn();
    },
}));
vi.mock('./utils/questionNotification', () => ({ getAskUserQuestionToolCallIds: vi.fn(() => []) }));
vi.mock('@/utils/terminalStdinCleanup', () => ({ cleanupStdinAfterInk: vi.fn(async () => undefined) }));

import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { AgentState } from '@/api/types';
import type { EnhancedMode } from './loop';
import { claudeRemoteLauncher } from './claudeRemoteLauncher';

describe('claudeRemoteLauncher heartbeat receipt', () => {
    it('persists a failed terminal receipt for a Claude error result', async () => {
        let agentState: AgentState = {};
        const receiptStates: AgentState[] = [];
        const client = {
            sessionId: 'session-one',
            rpcHandlerManager: { registerHandler: vi.fn() },
            updateAgentState: vi.fn(async (update: (state: AgentState) => AgentState) => {
                agentState = update(agentState);
                receiptStates.push(agentState);
            }),
            updateMetadata: vi.fn(),
            closeClaudeSessionTurn: vi.fn(),
            sendSessionEvent: vi.fn(),
            sendClaudeSessionMessage: vi.fn(),
            getMetadata: vi.fn(() => ({})),
        };
        const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify({
            permissionMode: mode.permissionMode,
        }));
        queue.pushIsolated('heartbeat prompt', {
            permissionMode: 'default',
            heartbeat: {
                schemaVersion: 1,
                automationId: '11111111-1111-4111-8111-111111111111',
                occurrenceId: '22222222-2222-4222-8222-222222222222',
            },
        }, undefined, '22222222-2222-4222-8222-222222222222');

        let launch = 0;
        mocks.claudeRemote.mockImplementation(async (options: any) => {
            launch += 1;
            const message = await options.nextMessage();
            if (launch === 1) {
                expect(message).toBeNull();
                return;
            }
            expect(message).toMatchObject({
                message: 'heartbeat prompt',
                queueMessageIds: ['22222222-2222-4222-8222-222222222222'],
            });
            options.onMessage({
                type: 'result',
                subtype: 'error_max_turns',
                is_error: true,
                errors: ['maximum turns reached'],
            });
            await options.onReady();
            queue.close();
        });
        const onProviderResult = vi.fn();

        await expect(claudeRemoteLauncher({
            sessionId: 'claude-session-one',
            path: '/srv/app',
            logPath: '/tmp/claude.log',
            allowedTools: [],
            mcpServers: {},
            hookSettingsPath: '/tmp/settings.json',
            jsRuntime: 'node',
            queue,
            client,
            api: { push: () => ({ sendSessionNotification: vi.fn() }) },
            onAbort: vi.fn(),
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            clearSessionId: vi.fn(),
            consumeOneTimeFlags: vi.fn(),
        } as any, { onProviderResult })).resolves.toBe('exit');

        expect(receiptStates.map((state) => state.heartbeatDelivery?.status)).toEqual(['started', 'failed']);
        expect(agentState.heartbeatDelivery).toMatchObject({
            automationId: '11111111-1111-4111-8111-111111111111',
            occurrenceId: '22222222-2222-4222-8222-222222222222',
            status: 'failed',
            message: 'maximum turns reached',
        });
        expect(onProviderResult).toHaveBeenCalledWith({
            status: 'failed',
            message: 'maximum turns reached',
        });
    });

    it('turns an unexpected unattended permission callback into a terminal provider failure', async () => {
        const client = {
            sessionId: 'session-one',
            rpcHandlerManager: { registerHandler: vi.fn() },
            updateAgentState: vi.fn(),
            updateMetadata: vi.fn(),
            closeClaudeSessionTurn: vi.fn(),
            sendSessionEvent: vi.fn(),
            sendClaudeSessionMessage: vi.fn(),
            getMetadata: vi.fn(() => ({})),
        };
        const queue = new MessageQueue2<EnhancedMode>((mode) => JSON.stringify(mode));
        queue.push('ask before running', { permissionMode: 'bypassPermissions' });
        queue.close();

        mocks.claudeRemote.mockImplementation(async (options: any) => {
            const message = await options.nextMessage();
            expect(message).toMatchObject({ message: 'ask before running' });
            return options.canCallTool('AskUserQuestion', {}, {
                signal: new AbortController().signal,
                toolUseID: 'question-one',
                requestId: 'request-one',
            });
        });
        const onProviderResult = vi.fn();

        await expect(claudeRemoteLauncher({
            sessionId: 'claude-session-one',
            path: '/srv/app',
            logPath: '/tmp/claude.log',
            allowedTools: [],
            mcpServers: {},
            hookSettingsPath: '/tmp/settings.json',
            jsRuntime: 'node',
            queue,
            client,
            api: { push: () => ({ sendSessionNotification: vi.fn() }) },
            onAbort: vi.fn(),
            onSessionFound: vi.fn(),
            onThinkingChange: vi.fn(),
            clearSessionId: vi.fn(),
            consumeOneTimeFlags: vi.fn(),
        } as any, { onProviderResult, unattended: true })).resolves.toBe('exit');

        expect(onProviderResult).toHaveBeenCalledWith({
            status: 'failed',
            message: expect.stringContaining('requested interactive permission'),
        });
    });
});
