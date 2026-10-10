import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery, mockResolveExecutable } = vi.hoisted(() => ({
    mockQuery: vi.fn(),
    mockResolveExecutable: vi.fn(() => '/installed/claude'),
}));

vi.mock('./query', () => ({ query: mockQuery }));
vi.mock('./claudeExecutable', () => ({ resolveClaudeCodeExecutable: mockResolveExecutable }));

import { discoverClaudeModels } from './modelDiscovery';

describe('Claude SDK model discovery', () => {
    let session: {
        initializationResult: ReturnType<typeof vi.fn>;
        supportedModels: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.useRealTimers();
        session = {
            initializationResult: vi.fn(async () => ({})),
            supportedModels: vi.fn(async () => [{
                value: 'sonnet',
                resolvedModel: 'claude-sonnet-next',
                displayName: 'Sonnet Next',
                description: 'New model',
                supportedEffortLevels: ['high'],
            }]),
            close: vi.fn(),
        };
        mockResolveExecutable.mockReturnValue('/installed/claude');
        mockQuery.mockReturnValue(session);
    });

    afterEach(() => vi.useRealTimers());

    it('reads models without a text prompt and closes the same executable/environment probe', async () => {
        const env = { PATH: '/fixture/bin', CLAUDE_CODE_OAUTH_TOKEN: 'fixture-token' };
        const models = await discoverClaudeModels(env);

        expect(models[0]?.value).toBe('sonnet');
        const request = mockQuery.mock.calls[0]?.[0];
        expect(request.options).toMatchObject({
            pathToClaudeCodeExecutable: '/installed/claude',
            env,
            persistSession: false,
            tools: [],
            mcpServers: {},
            strictMcpConfig: true,
            settingSources: [],
        });
        expect(request.options).not.toHaveProperty('model');
        expect(typeof request.prompt).not.toBe('string');
        expect(session.initializationResult.mock.invocationCallOrder[0])
            .toBeLessThan(session.supportedModels.mock.invocationCallOrder[0]);
        expect(session.close).toHaveBeenCalledOnce();
    });

    it('closes the query when initialization fails', async () => {
        session.initializationResult.mockRejectedValueOnce(new Error('initialize failed'));

        await expect(discoverClaudeModels()).rejects.toThrow('initialize failed');
        expect(session.supportedModels).not.toHaveBeenCalled();
        expect(session.close).toHaveBeenCalledOnce();
    });

    it('aborts and closes a query when the bounded discovery timeout expires', async () => {
        vi.useFakeTimers();
        session.initializationResult.mockImplementation(() => new Promise(() => {}));
        const discovery = discoverClaudeModels(undefined, 25);
        const request = mockQuery.mock.calls[0]?.[0];
        const rejection = expect(discovery).rejects.toThrow('Claude model discovery timed out');

        await vi.advanceTimersByTimeAsync(25);
        await rejection;

        expect(request.options.abort.aborted).toBe(true);
        expect(session.close).toHaveBeenCalledOnce();
    });
});
