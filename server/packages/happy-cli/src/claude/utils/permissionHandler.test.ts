import { describe, expect, it, vi } from 'vitest';
import { PermissionHandler } from './permissionHandler';
import type { EnhancedMode } from '../loop';

vi.mock('@/lib', () => ({
    logger: {
        debug: vi.fn(),
    },
}));

const mode: EnhancedMode = {
    permissionMode: 'default',
};

function createSessionMock() {
    let state: Record<string, any> = {};
    const handlers = new Map<string, (message: any) => Promise<void>>();
    const sendSessionNotification = vi.fn();
    const pushClient = { sendSessionNotification };

    return {
        session: {
            client: {
                sessionId: 'happy-session-1',
                getMetadata: vi.fn(() => ({})),
                updateAgentState: vi.fn((updater: (currentState: Record<string, any>) => Record<string, any>) => {
                    state = updater(state);
                    return state;
                }),
                rpcHandlerManager: {
                    registerHandler: vi.fn((name: string, handler: (message: any) => Promise<void>) => {
                        handlers.set(name, handler);
                    }),
                },
            },
            api: {
                push: vi.fn(() => pushClient),
            },
        },
        getState: () => state,
        handlers,
        sendSessionNotification,
    };
}

function getPermissionResponseHandler(handlers: Map<string, (message: any) => Promise<void>>) {
    const handler = handlers.get('permission');
    expect(handler).toBeDefined();
    return handler!;
}

describe('PermissionHandler', () => {
    it('rejects the Codex-only yolo mode at the Claude permission boundary', async () => {
        const { session } = createSessionMock();
        const handler = new PermissionHandler(session as any);

        await expect(handler.handleModeChange('yolo'))
            .rejects.toThrow('Unsupported Claude permission mode: yolo');
    });

    it('auto-approves tool calls in bypassPermissions mode', async () => {
        const { session } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const controller = new AbortController();

        handler.handleModeChange('bypassPermissions');

        const result = await handler.handleToolCall(
            'Write',
            { file_path: '/tmp/x', content: 'y' },
            mode,
            { signal: controller.signal, toolUseID: 'toolu_bypass', requestId: 'request_bypass' },
        );

        expect(result).toMatchObject({ behavior: 'allow' });
    });

    it('auto-approves ExitPlanMode in bypassPermissions mode without surfacing a request', async () => {
        const { session, getState, sendSessionNotification } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const controller = new AbortController();

        handler.handleModeChange('bypassPermissions');

        const result = await handler.handleToolCall(
            'ExitPlanMode',
            { plan: 'Implement the requested change.' },
            mode,
            { signal: controller.signal, toolUseID: 'toolu_exit_plan', requestId: 'request_exit_plan' },
        );

        expect(result).toMatchObject({ behavior: 'allow' });
        expect(getState().requests).toBeUndefined();
        expect(sendSessionNotification).not.toHaveBeenCalled();
    });

    it('keeps AskUserQuestion interactive in bypassPermissions mode', async () => {
        const { session, getState, handlers } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const controller = new AbortController();

        handler.handleModeChange('bypassPermissions');

        const pending = handler.handleToolCall(
            'AskUserQuestion',
            { questions: [{ question: 'Continue?' }] },
            mode,
            { signal: controller.signal, toolUseID: 'toolu_question', requestId: 'request_question' },
        );

        expect(getState().requests.toolu_question).toMatchObject({
            tool: 'AskUserQuestion',
        });
        await getPermissionResponseHandler(handlers)({
            id: 'toolu_question',
            approved: true,
            updatedInput: { answers: { 'Continue?': 'Yes' } },
        });
        await expect(pending).resolves.toMatchObject({
            behavior: 'allow',
            updatedInput: {
                questions: [{ question: 'Continue?' }],
                answers: { 'Continue?': 'Yes' },
            },
        });
    });

    it.each(['default', 'auto'] as const)('%s keeps executable callbacks interactive', async (permissionMode) => {
        const { session, getState } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const controller = new AbortController();

        handler.handleModeChange(permissionMode);
        const pending = handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            mode,
            { signal: controller.signal, toolUseID: `toolu_${permissionMode}`, requestId: `request_${permissionMode}` },
        );

        expect(getState().requests[`toolu_${permissionMode}`]).toMatchObject({ tool: 'Bash' });
        controller.abort();
        await expect(pending).rejects.toThrow('Permission request aborted');
    });

    it('acceptEdits allows edits but keeps shell callbacks interactive', async () => {
        const { session, getState } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const editController = new AbortController();
        const shellController = new AbortController();

        handler.handleModeChange('acceptEdits');
        await expect(handler.handleToolCall(
            'Write',
            { file_path: '/tmp/x', content: 'y' },
            mode,
            { signal: editController.signal, toolUseID: 'toolu_edit', requestId: 'request_edit' },
        )).resolves.toMatchObject({ behavior: 'allow' });

        const pendingShell = handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            mode,
            { signal: shellController.signal, toolUseID: 'toolu_shell', requestId: 'request_shell' },
        );
        expect(getState().requests.toolu_shell).toMatchObject({ tool: 'Bash' });
        shellController.abort();
        await expect(pendingShell).rejects.toThrow('Permission request aborted');
    });

    it.each(['Bash', 'ExitPlanMode'] as const)('dontAsk denies an unapproved %s callback without prompting', async (toolName) => {
        const { session, getState, sendSessionNotification } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const controller = new AbortController();

        await handler.handleModeChange('dontAsk');
        const result = await handler.handleToolCall(
            toolName,
            toolName === 'Bash' ? { command: 'pwd' } : { plan: 'Implement the change.' },
            mode,
            { signal: controller.signal, toolUseID: `toolu_${toolName}`, requestId: `request_${toolName}` },
        );

        expect(result).toMatchObject({
            behavior: 'deny',
            message: expect.stringContaining('dontAsk'),
        });
        expect(getState().requests).toBeUndefined();
        expect(sendSessionNotification).not.toHaveBeenCalled();
    });

    it('plan allows read-only callbacks but keeps execution and plan exit interactive', async () => {
        const { session, getState } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const readController = new AbortController();
        const shellController = new AbortController();
        const exitController = new AbortController();

        handler.handleModeChange('plan');
        await expect(handler.handleToolCall(
            'Read',
            { file_path: '/tmp/x' },
            mode,
            { signal: readController.signal, toolUseID: 'toolu_read', requestId: 'request_read' },
        )).resolves.toMatchObject({ behavior: 'allow' });

        const pendingShell = handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            mode,
            { signal: shellController.signal, toolUseID: 'toolu_plan_shell', requestId: 'request_plan_shell' },
        );
        const pendingExit = handler.handleToolCall(
            'ExitPlanMode',
            { plan: 'Implement the requested change.' },
            mode,
            { signal: exitController.signal, toolUseID: 'toolu_plan_exit', requestId: 'request_plan_exit' },
        );
        expect(getState().requests).toMatchObject({
            toolu_plan_shell: { tool: 'Bash' },
            toolu_plan_exit: { tool: 'ExitPlanMode' },
        });
        shellController.abort();
        exitController.abort();
        await expect(pendingShell).rejects.toThrow('Permission request aborted');
        await expect(pendingExit).rejects.toThrow('Permission request aborted');
    });

    it('fails an unattended interactive request without creating pending approval state', async () => {
        const { session, getState } = createSessionMock();
        const handler = new PermissionHandler(session as any, { unattended: true });
        const controller = new AbortController();

        handler.handleModeChange('bypassPermissions');

        await expect(handler.handleToolCall(
            'AskUserQuestion',
            { questions: [{ question: 'Continue?' }] },
            mode,
            { signal: controller.signal, toolUseID: 'toolu_question', requestId: 'request_question' },
        )).rejects.toThrow(/unattended Claude automation requested interactive permission/i);
        expect(getState().requests).toBeUndefined();
    });

    it('does not send a Codex-only mode to the live Claude query', async () => {
        const { session } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const setMode = vi.fn(async () => {});

        handler.setPermissionModeUpdater(setMode);
        await expect(handler.handleModeChange('yolo'))
            .rejects.toThrow('Unsupported Claude permission mode: yolo');

        expect(setMode).not.toHaveBeenCalled();
    });

    it('syncs an exact bypassPermissions selection into an existing query', async () => {
        const { session } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const setMode = vi.fn(async () => {});

        handler.setPermissionModeUpdater(setMode);
        handler.handleModeChange('bypassPermissions');

        expect(setMode).toHaveBeenCalledWith('bypassPermissions');
    });

    it('applies an explicit default after bypassPermissions to the SDK and local callback policy', async () => {
        const { session, getState } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const setMode = vi.fn(async () => {});
        const controller = new AbortController();

        handler.setPermissionModeUpdater(setMode);
        await handler.handleModeChange('bypassPermissions');
        await handler.handleModeChange('default');

        expect(setMode).toHaveBeenNthCalledWith(1, 'bypassPermissions');
        expect(setMode).toHaveBeenNthCalledWith(2, 'default');

        const pending = handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            mode,
            { signal: controller.signal, toolUseID: 'toolu_default_again', requestId: 'request_default_again' },
        );
        expect(getState().requests.toolu_default_again).toMatchObject({ tool: 'Bash' });
        controller.abort();
        await expect(pending).rejects.toThrow('Permission request aborted');
    });

    it('waits for the active SDK query to accept a mode change', async () => {
        const { session } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        let release!: () => void;
        const modeChanged = new Promise<void>((resolve) => {
            release = resolve;
        });
        handler.setPermissionModeUpdater(() => modeChanged);

        let completed = false;
        const changing = handler.handleModeChange('dontAsk').then(() => {
            completed = true;
        });
        await Promise.resolve();
        expect(completed).toBe(false);

        release();
        await changing;
        expect(completed).toBe(true);
    });

    it('keeps the prior local policy when the active SDK rejects a mode change', async () => {
        const { session } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const setMode = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('native mode rejected'));

        handler.setPermissionModeUpdater(setMode);
        await handler.handleModeChange('bypassPermissions');
        await expect(handler.handleModeChange('default')).rejects.toThrow('native mode rejected');

        await expect(handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            mode,
            { signal: new AbortController().signal, toolUseID: 'toolu_still_bypass', requestId: 'request_still_bypass' },
        )).resolves.toMatchObject({ behavior: 'allow' });
    });

    it('rejects ExitPlanMode when Claude cannot apply the approved next mode', async () => {
        const { session, getState, handlers } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        await handler.handleModeChange('plan');
        handler.setPermissionModeUpdater(vi.fn(async () => {
            throw new Error('native mode rejected');
        }));

        const pending = handler.handleToolCall(
            'ExitPlanMode',
            { plan: 'Implement the requested change.' },
            mode,
            { signal: new AbortController().signal, toolUseID: 'toolu_exit_rejected', requestId: 'request_exit_rejected' },
        );
        await expect(getPermissionResponseHandler(handlers)({
            id: 'toolu_exit_rejected',
            approved: true,
            mode: 'default',
        })).rejects.toThrow('native mode rejected');
        await expect(pending).rejects.toThrow('native mode rejected');
        expect(handler.getResponses().has('toolu_exit_rejected')).toBe(false);
        expect(getState().completedRequests.toolu_exit_rejected).toMatchObject({
            status: 'denied',
            reason: expect.stringContaining('native mode rejected'),
        });
    });

    it('keeps main-thread request IDs unchanged', async () => {
        const { session, getState, handlers } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const controller = new AbortController();

        const pending = handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            mode,
            { signal: controller.signal, toolUseID: 'toolu_main', requestId: 'request_main' },
        );

        expect(getState().requests.toolu_main).toMatchObject({
            tool: 'Bash',
            arguments: { command: 'pwd' },
        });

        await getPermissionResponseHandler(handlers)({ id: 'toolu_main', approved: true });
        await expect(pending).resolves.toMatchObject({ behavior: 'allow' });
    });

    it('uses agentID to disambiguate sub-agent permission requests with the same toolUseID', async () => {
        const { session, getState, handlers, sendSessionNotification } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const firstController = new AbortController();
        const secondController = new AbortController();

        const firstPending = handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            mode,
            { signal: firstController.signal, toolUseID: 'toolu_shared', agentID: 'agent-a', requestId: 'request_agent_a' },
        );
        const secondPending = handler.handleToolCall(
            'Bash',
            { command: 'whoami' },
            mode,
            { signal: secondController.signal, toolUseID: 'toolu_shared', agentID: 'agent-b', requestId: 'request_agent_b' },
        );

        expect(getState().requests).toMatchObject({
            'agent-a:toolu_shared': {
                tool: 'Bash',
                arguments: { command: 'pwd' },
                // Raw provider id rides along so the app can attach the
                // permission card to the sidechain tool call.
                toolUseId: 'toolu_shared',
            },
            'agent-b:toolu_shared': {
                tool: 'Bash',
                arguments: { command: 'whoami' },
                toolUseId: 'toolu_shared',
            },
        });
        expect(sendSessionNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({
            data: expect.objectContaining({ requestId: 'agent-a:toolu_shared' }),
        }));
        expect(sendSessionNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({
            data: expect.objectContaining({ requestId: 'agent-b:toolu_shared' }),
        }));

        const respondToPermission = getPermissionResponseHandler(handlers);
        await respondToPermission({
            id: 'agent-b:toolu_shared',
            approved: false,
            reason: 'not this one',
        });
        await respondToPermission({
            id: 'agent-a:toolu_shared',
            approved: true,
        });

        await expect(firstPending).resolves.toMatchObject({ behavior: 'allow' });
        await expect(secondPending).resolves.toMatchObject({
            behavior: 'deny',
            message: 'not this one',
        });
        expect(getState().completedRequests['agent-a:toolu_shared']).toMatchObject({
            status: 'approved',
            toolUseId: 'toolu_shared',
        });
        expect(getState().completedRequests['agent-b:toolu_shared']).toMatchObject({
            status: 'denied',
            toolUseId: 'toolu_shared',
        });
    });

    it('can look up a single sub-agent response by raw toolUseID for transcript follow-up paths', async () => {
        const { session, handlers } = createSessionMock();
        const handler = new PermissionHandler(session as any);
        const controller = new AbortController();

        const pending = handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            mode,
            { signal: controller.signal, toolUseID: 'toolu_result', agentID: 'agent-a', requestId: 'request_result' },
        );

        await getPermissionResponseHandler(handlers)({
            id: 'agent-a:toolu_result',
            approved: false,
            reason: 'denied',
            mode: 'default',
        });

        await expect(pending).resolves.toMatchObject({ behavior: 'deny' });
        expect(handler.getResponseForToolUseId('toolu_result')).toMatchObject({
            approved: false,
            reason: 'denied',
        });
        expect(handler.isAborted('toolu_result')).toBe(true);
    });
});
