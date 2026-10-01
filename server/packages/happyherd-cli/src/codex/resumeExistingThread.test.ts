import { describe, expect, it, vi } from 'vitest';

import { resumeExistingThread } from './resumeExistingThread';

describe('resumeExistingThread', () => {
    it('resumes the thread and updates session metadata', async () => {
        const client = {
            injectDeveloperInstructions: vi.fn().mockResolvedValue({}),
            resumeThread: vi.fn().mockResolvedValue({
                threadId: '019ccca2-1a77-7481-9873-de72f3464372',
                model: 'gpt-5.4',
            }),
        };
        const metadataHandlers: Array<(metadata: any) => any> = [];
        const session = {
            updateMetadata: vi.fn(async (handler) => { metadataHandlers.push(handler); }),
            sendSessionEvent: vi.fn(),
        };
        const messageBuffer = {
            addMessage: vi.fn(),
        };

        const result = await resumeExistingThread({
            client,
            session,
            messageBuffer,
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            model: 'gpt-5.6-sol',
            cwd: '/tmp/project',
            mcpServers: { happyherd: { command: 'happyherd-mcp' } },
            developerInstructions: 'global + commander + project',
            approvalPolicy: 'never',
            sandbox: 'read-only',
        });

        expect(result).toEqual({
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            model: 'gpt-5.4',
        });
        expect(client.resumeThread).toHaveBeenCalledWith({
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            model: 'gpt-5.6-sol',
            cwd: '/tmp/project',
            mcpServers: { happyherd: { command: 'happyherd-mcp' } },
            developerInstructions: 'global + commander + project',
            approvalPolicy: 'never',
            sandbox: 'read-only',
        });
        expect(client.injectDeveloperInstructions).toHaveBeenCalledWith({
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            instructions: 'global + commander + project',
        });
        expect(metadataHandlers).toHaveLength(1);
        expect(metadataHandlers[0]({ existing: true })).toEqual({
            existing: true,
            codexThreadId: '019ccca2-1a77-7481-9873-de72f3464372',
        });
        expect(messageBuffer.addMessage).toHaveBeenCalledWith(expect.stringContaining('Resumed thread'), 'status');
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'Resumed Codex thread 019ccca2-1a77-7481-9873-de72f3464372',
        });
    });

    it.each(['updated context', 'same context'])('awaits native injection before publishing the %s receipt', async (instructions) => {
        let appliedInstructions = instructions === 'same context' ? instructions : 'old context';
        let releaseInjection!: () => void;
        const injection = new Promise<void>(resolve => { releaseInjection = resolve; });
        const client = {
            // The provider resumes history but ignores this configuration override.
            resumeThread: vi.fn(async () => ({ threadId: 'thread-one', model: 'model-one' })),
            injectDeveloperInstructions: vi.fn(async (input: { instructions: string }) => {
                await injection;
                appliedInstructions = input.instructions;
            }),
        };
        let metadata: Record<string, unknown> = { commanderId: 'athena', contextHash: 'old-hash' };
        const session = {
            updateMetadata: vi.fn(async (update: (value: Record<string, unknown>) => Record<string, unknown>) => { metadata = update(metadata); }),
            sendSessionEvent: vi.fn(),
        };
        const options = {
            client, session, messageBuffer: { addMessage: vi.fn() }, threadId: 'thread-one',
            cwd: '/workspace', mcpServers: {}, developerInstructions: instructions,
            contextMetadata: { commanderId: 'athena', contextHash: 'new-hash',
                commanderContextFiles: [{ kind: 'commander' as const, path: '/context/COMMANDER.md' }] },
        };
        const resumed = resumeExistingThread(options);
        await Promise.resolve();
        expect(client.injectDeveloperInstructions).toHaveBeenCalledOnce();
        expect(session.updateMetadata).not.toHaveBeenCalled();
        releaseInjection();
        await resumed;

        expect(appliedInstructions).toBe(instructions);
        expect(metadata).toMatchObject({
            codexThreadId: 'thread-one', contextHash: 'new-hash',
            commanderContextFiles: options.contextMetadata.commanderContextFiles,
            instructionProvider: 'codex', instructionLayer: 'developer',
            instructionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
    });

    it('does not publish a new context receipt when native injection fails', async () => {
        const session = { updateMetadata: vi.fn(), sendSessionEvent: vi.fn() };
        const options = {
            client: {
                resumeThread: vi.fn(async () => ({ threadId: 'thread-one', model: 'model-one' })),
                injectDeveloperInstructions: vi.fn(async () => { throw new Error('native injection failed'); }),
            },
            session, messageBuffer: { addMessage: vi.fn() }, threadId: 'thread-one',
            cwd: '/workspace', mcpServers: {}, developerInstructions: 'new context',
            contextMetadata: { commanderId: 'athena', contextHash: 'new-hash',
                commanderContextFiles: [{ kind: 'commander' as const, path: '/context/COMMANDER.md' }] },
        };
        await expect(resumeExistingThread(options)).rejects.toThrow('native injection failed');
        expect(session.updateMetadata).not.toHaveBeenCalled();
        expect(session.sendSessionEvent).not.toHaveBeenCalled();
    });

    it.each(['hermes', undefined])('preserves concurrent Commander binding %s after successful injection', async (commanderId) => {
        let metadata: Record<string, unknown> = { commanderId, contextHash: 'historical-hash' };
        const options = {
            client: {
                resumeThread: vi.fn(async () => ({ threadId: 'thread-one', model: 'model-one' })),
                injectDeveloperInstructions: vi.fn(async () => undefined),
            },
            session: {
                updateMetadata: vi.fn(async (update: (value: Record<string, unknown>) => Record<string, unknown>) => { metadata = update(metadata); }),
                sendSessionEvent: vi.fn(),
            },
            messageBuffer: { addMessage: vi.fn() }, threadId: 'thread-one', cwd: '/workspace', mcpServers: {},
            developerInstructions: 'new Athena context',
            contextMetadata: { commanderId: 'athena', contextHash: 'new-hash',
                commanderContextFiles: [{ kind: 'commander' as const, path: '/athena/COMMANDER.md' }] },
        };
        await resumeExistingThread(options);
        expect(metadata).toEqual({ commanderId, contextHash: 'historical-hash', codexThreadId: 'thread-one' });
    });

    it('wraps backend resume errors with the thread ID', async () => {
        const client = {
            injectDeveloperInstructions: vi.fn(),
            resumeThread: vi.fn().mockRejectedValue(new Error('thread not found')),
        };
        const session = {
            updateMetadata: vi.fn(),
            sendSessionEvent: vi.fn(),
        };
        const messageBuffer = {
            addMessage: vi.fn(),
        };

        await expect(
            resumeExistingThread({
                client,
                session,
                messageBuffer,
                threadId: 'thread-404',
                cwd: '/tmp/project',
                mcpServers: {},
            }),
        ).rejects.toThrow('Failed to resume Codex thread thread-404: thread not found');
    });
});
