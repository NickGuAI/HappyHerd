import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRemote } from './claudeRemote';
import { query } from '@/claude/sdk';
import { Session } from './session';

vi.mock('@/lib', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn() } }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn() } }));
vi.mock('@/claude/sdk', () => ({ query: vi.fn(), AbortError: class extends Error {} }));
vi.mock('./utils/path', () => ({ getProjectPath: () => '/fixture' }));
vi.mock('@/modules/watcher/awaitFileExist', () => ({ awaitFileExist: async () => true }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}

function fixture() {
    const init = deferred<void>();
    let hook: (id: string, source?: string) => void = () => {};
    const unsubscribe = vi.fn();
    const restored = vi.fn(async () => {});
    const aborted = vi.fn(async () => {});
    const mode = {
        model: 'saved', fallbackModel: 'fallback', permissionMode: 'default' as const,
        customSystemPrompt: 'saved system prompt', appendSystemPrompt: 'saved extra instructions',
        allowedTools: ['Read'], disallowedTools: ['Write'], effort: 'high' as const,
    };
    const next = vi.fn().mockResolvedValueOnce({ message: 'continue', mode }).mockResolvedValue(null);
    const inputs: unknown[] = [];
    const close = vi.fn();
    const usage = vi.fn(async (): Promise<unknown> => { throw new Error('usage unavailable'); });
    vi.mocked(query).mockImplementation(({ prompt }) => ({
        initializationResult: () => init.promise,
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage,
        close,
        async *[Symbol.asyncIterator]() {
            const iterator = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]();
            inputs.push((await iterator.next()).value);
            yield { type: 'result', subtype: 'success', is_error: false };
            await iterator.next();
        },
    } as any));
    const baseline = vi.fn();
    const options = {
        sessionId: null, path: '/fixture', allowedTools: [], hookSettingsPath: '/fixture/settings',
        nativeResume: {
            sessionId: 'native-id', mode,
            subscribe: (fn: typeof hook) => { hook = fn; return unsubscribe; }, onRestored: restored, onAborted: aborted,
        },
        nextMessage: next, onReady: vi.fn(), onSessionFound: vi.fn(), onMessage: vi.fn(),
        isAborted: () => false, canCallTool: async () => ({ behavior: 'allow' as const, updatedInput: {} }),
        onUsageBaseline: baseline,
    };
    return { init, emit: (id: string, source: string) => hook(id, source), options, next, inputs, close, restored, aborted, unsubscribe, baseline, usage };
}

async function tick() { await new Promise(resolve => setTimeout(resolve, 0)); }

describe('Claude retained-session native receipt', () => {
    beforeEach(() => { vi.mocked(query).mockReset(); });
    it('requires matching resume hook and initialization before one continuation on the same query', async () => {
        const f = fixture();
        const run = claudeRemote(f.options);
        expect(query).toHaveBeenCalledOnce();
        expect(vi.mocked(query).mock.calls.at(-1)?.[0].options).toMatchObject({
            resume: 'native-id', model: 'saved', fallbackModel: 'fallback', permissionMode: 'default',
            customSystemPrompt: expect.stringContaining('saved system prompt\n\nsaved extra instructions'),
            allowedTools: ['Read'], disallowedTools: ['Write'], effort: 'high',
        });
        f.emit('other-id', 'resume'); f.emit('native-id', 'startup');
        f.init.resolve(); await tick();
        expect(f.restored).not.toHaveBeenCalled(); expect(f.next).not.toHaveBeenCalled();
        f.emit('native-id', 'resume');
        await run;
        expect(f.restored).toHaveBeenCalledOnce();
        expect(f.inputs).toEqual([expect.objectContaining({ message: { role: 'user', content: 'continue' } })]);
        expect(f.baseline).toHaveBeenCalledWith({ sessionId: 'native-id', available: false });
        expect(f.unsubscribe).toHaveBeenCalledOnce();
    });

    it('never reports readiness or consumes input after initialization failure, even with a matching hook', async () => {
        const f = fixture();
        const run = claudeRemote(f.options);
        f.emit('native-id', 'resume');
        f.init.reject(new Error('No conversation found'));
        await expect(run).rejects.toThrow('No conversation found');
        expect(f.restored).not.toHaveBeenCalled(); expect(f.next).not.toHaveBeenCalled();
        expect(f.close).toHaveBeenCalledOnce(); expect(f.unsubscribe).toHaveBeenCalledOnce();
    });
    it('waits for initialization after an earlier matching hook', async () => {
        const f = fixture();
        const run = claudeRemote(f.options);
        f.emit('native-id', 'resume'); await tick();
        expect(f.restored).not.toHaveBeenCalled(); expect(f.next).not.toHaveBeenCalled();
        f.init.resolve();
        await run;
        expect(f.restored).toHaveBeenCalledOnce(); expect(f.inputs).toHaveLength(1);
    });

    it('closes the restored query when the launcher defers the first batch', async () => {
        const f = fixture();
        f.next.mockReset().mockResolvedValue(null);
        const run = claudeRemote(f.options);
        f.emit('native-id', 'resume'); f.init.resolve();
        await run;
        expect(f.restored).toHaveBeenCalledOnce();
        expect(f.close).toHaveBeenCalledOnce(); expect(f.inputs).toEqual([]);
    });

    it('aborts an outstanding hook wait and removes the subscription', async () => {
        const f = fixture();
        const controller = new AbortController();
        const run = claudeRemote({ ...f.options, signal: controller.signal });
        f.init.resolve(); controller.abort();
        await expect(run).resolves.toBeUndefined();
        expect(f.restored).not.toHaveBeenCalled(); expect(f.next).not.toHaveBeenCalled();
        expect(f.close).toHaveBeenCalledOnce(); expect(f.unsubscribe).toHaveBeenCalledOnce();
        expect(f.aborted).toHaveBeenCalledOnce();
        expect(f.close.mock.invocationCallOrder[0]).toBeLessThan(f.aborted.mock.invocationCallOrder[0]);
        expect(f.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(f.aborted.mock.invocationCallOrder[0]);
        f.emit('native-id', 'resume');
        await tick();
        expect(f.restored).not.toHaveBeenCalled();
    });

    it('does not submit a deferred message when retained-session re-entry fails', async () => {
        const f = fixture();
        f.init.reject(new Error('No conversation found'));
        const handoff = vi.fn();
        await expect(claudeRemote({ ...f.options, nativeResume: undefined, requiredSessionId: 'native-id', onMessageHandoff: handoff })).rejects.toThrow('No conversation found');
        expect(f.inputs).toEqual([]); expect(f.close).toHaveBeenCalledOnce();
        expect(handoff).not.toHaveBeenCalled();
        expect(vi.mocked(query).mock.calls[0][0].options).toMatchObject({ resume: 'native-id' });
    });

    it('retains the exact native ID on re-entry when the local transcript check would fail', async () => {
        const f = fixture();
        f.init.resolve();
        await claudeRemote({ ...f.options, nativeResume: undefined, sessionId: 'native-id', requiredSessionId: 'native-id' });
        expect(vi.mocked(query).mock.calls[0][0].options).toMatchObject({ resume: 'native-id' });
        expect(f.inputs).toEqual([expect.objectContaining({ message: { role: 'user', content: 'continue' } })]);
    });

    it('lets an explicit /clear reset the retained conversation without starting a query', async () => {
        const f = fixture();
        f.next.mockReset().mockResolvedValueOnce({ message: '/clear', mode: { permissionMode: 'default' } });
        const reset = vi.fn();
        await claudeRemote({ ...f.options, nativeResume: undefined, sessionId: 'native-id', requiredSessionId: 'native-id', onSessionReset: reset });
        expect(reset).toHaveBeenCalledOnce();
        expect(query).not.toHaveBeenCalled();
    });

    it('fails immediately when initialization rejects before the hook arrives', async () => {
        const f = fixture();
        const run = claudeRemote(f.options);
        f.init.reject(new Error('No conversation found'));
        await expect(run).rejects.toThrow('No conversation found');
        expect(f.restored).not.toHaveBeenCalled(); expect(f.next).not.toHaveBeenCalled();
        expect(f.close).toHaveBeenCalledOnce(); expect(f.unsubscribe).toHaveBeenCalledOnce();
    });

    it('removes the hook subscription if query creation throws synchronously', async () => {
        const f = fixture();
        vi.mocked(query).mockImplementation(() => { throw new Error('query failed'); });
        await expect(claudeRemote(f.options)).rejects.toThrow('query failed');
        expect(f.unsubscribe).toHaveBeenCalledOnce();
        expect(f.restored).not.toHaveBeenCalled(); expect(f.next).not.toHaveBeenCalled();
    });

    it('accepts only a restored active compact/fork ID and releases the constraint on /clear', () => {
        const session = new Session({
            api: {}, client: { keepAlive: vi.fn(), updateMetadata: vi.fn() },
            path: '/fixture', logPath: '/fixture/log', sessionId: 'native-id',
            nativeResume: { sessionId: 'native-id', mode: {}, subscribe: () => () => {}, onRestored: async () => {}, onAborted: async () => {} },
            mcpServers: {}, messageQueue: {}, onModeChange: () => {}, hookSettingsPath: '/fixture/settings',
        } as any);
        try {
            expect(session.requiredSessionId).toBe('native-id');
            session.onSessionFound('wrong-startup', 'startup');
            expect(session.requiredSessionId).toBe('native-id');
            expect(session.sessionId).toBe('native-id');
            session.onSessionFound('wrong-resume', 'resume');
            expect(session.requiredSessionId).toBe('native-id');
            session.onSessionFound('too-early', 'compact');
            expect(session.requiredSessionId).toBe('native-id');
            session.recoveryConfirmed = true;
            session.recoveryQueryActive = true;
            session.onSessionFound('fresh-session', 'startup');
            expect(session.recoveryUnexpectedSessionId).toBe('fresh-session');
            expect(session.sessionId).toBe('native-id');
            session.onSessionFound('legitimate-compact-id', 'compact');
            expect(session.requiredSessionId).toBe('legitimate-compact-id');
            expect(session.recoveryUnexpectedSessionId).toBeUndefined();
            session.onSessionFound('legitimate-fork-id', 'fork');
            expect(session.requiredSessionId).toBe('legitimate-fork-id');
            session.recoveryQueryActive = false;
            session.onSessionFound('unrelated-fork', 'fork');
            expect(session.requiredSessionId).toBe('legitimate-fork-id');
            session.clearSessionId();
            expect(session.requiredSessionId).toBeUndefined();
            session.onSessionFound('new-session-after-clear');
            expect(session.requiredSessionId).toBeUndefined();
        } finally { session.cleanup(); }
    });

    it('after cancellation waits for an explicit prompt before starting a new retained query, without a later receipt', async () => {
        const f = fixture();
        const controller = new AbortController();
        const first = claudeRemote({ ...f.options, signal: controller.signal });
        controller.abort();
        await first;
        const prompt = deferred<{ message: string; mode: typeof f.options.nativeResume.mode } | null>();
        const next = vi.fn().mockReturnValueOnce(prompt.promise).mockResolvedValue(null);
        const resumed = claudeRemote({ ...f.options, nativeResume: undefined, requiredSessionId: 'native-id', nextMessage: next });
        await tick();
        expect(query).toHaveBeenCalledTimes(1);
        expect(f.restored).not.toHaveBeenCalled();
        f.init.resolve();
        prompt.resolve({ message: 'User retry', mode: f.options.nativeResume.mode });
        await resumed;
        expect(query).toHaveBeenCalledTimes(2);
        expect(vi.mocked(query).mock.calls[1][0].options).toMatchObject({ resume: 'native-id' });
        expect(f.restored).not.toHaveBeenCalled();
        expect(f.aborted).toHaveBeenCalledOnce();
    });

    it('preserves user abort during retained-session re-entry without a second milestone', async () => {
        const f = fixture();
        const controller = new AbortController();
        const handoff = vi.fn();
        const running = claudeRemote({ ...f.options, nativeResume: undefined, requiredSessionId: 'native-id', signal: controller.signal, onMessageHandoff: handoff });
        await tick();
        controller.abort();
        f.init.reject(new Error('provider aborted'));
        await expect(running).resolves.toBeUndefined();
        expect(f.restored).not.toHaveBeenCalled(); expect(f.aborted).not.toHaveBeenCalled();
        expect(handoff).not.toHaveBeenCalled(); expect(f.inputs).toEqual([]);
        expect(f.close).toHaveBeenCalledOnce();
    });

    it('does not consume input if abort arrives while the successful receipt call is pending', async () => {
        const f = fixture();
        const controller = new AbortController();
        const receipt = deferred<void>();
        f.restored.mockImplementation(() => receipt.promise);
        const handoff = vi.fn();
        const run = claudeRemote({ ...f.options, signal: controller.signal, onMessageHandoff: handoff });
        f.emit('native-id', 'resume'); f.init.resolve();
        await vi.waitFor(() => expect(f.restored).toHaveBeenCalledOnce());
        controller.abort(); receipt.resolve();
        await expect(run).resolves.toBeUndefined();
        expect(f.next).not.toHaveBeenCalled(); expect(handoff).not.toHaveBeenCalled();
        expect(f.aborted).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
    });

    it('does not collect a queued prompt if abort arrives while usage lookup is pending', async () => {
        const f = fixture();
        const controller = new AbortController();
        const usage = deferred<unknown>();
        f.usage.mockImplementation(() => usage.promise);
        const handoff = vi.fn();
        const run = claudeRemote({ ...f.options, signal: controller.signal, onMessageHandoff: handoff });
        f.emit('native-id', 'resume'); f.init.resolve();
        await vi.waitFor(() => expect(f.usage).toHaveBeenCalledOnce());
        controller.abort(); usage.resolve({});
        await expect(run).resolves.toBeUndefined();
        expect(f.next).not.toHaveBeenCalled(); expect(handoff).not.toHaveBeenCalled();
        expect(f.aborted).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
    });

    it('defers a batch if abort arrives before nextMessage returns it', async () => {
        const f = fixture();
        const controller = new AbortController();
        const batch = deferred<any>();
        const defer = vi.fn();
        const handoff = vi.fn();
        f.next.mockReset().mockReturnValueOnce(batch.promise);
        const run = claudeRemote({ ...f.options, signal: controller.signal, onMessageHandoff: handoff });
        f.emit('native-id', 'resume'); f.init.resolve();
        await vi.waitFor(() => expect(f.next).toHaveBeenCalledOnce());
        controller.abort(); batch.resolve({ message: 'queued', mode: f.options.nativeResume.mode, defer });
        await expect(run).resolves.toBeUndefined();
        expect(defer).toHaveBeenCalledOnce(); expect(handoff).not.toHaveBeenCalled();
        expect(f.close).toHaveBeenCalledOnce();
    });

    it('reports cancellation when abort arrives during a receipt call that later rejects', async () => {
        const f = fixture();
        const controller = new AbortController();
        const receipt = deferred<void>();
        f.restored.mockImplementation(() => receipt.promise);
        const handoff = vi.fn();
        const run = claudeRemote({ ...f.options, signal: controller.signal, onMessageHandoff: handoff });
        f.emit('native-id', 'resume'); f.init.resolve();
        await vi.waitFor(() => expect(f.restored).toHaveBeenCalledOnce());
        controller.abort(); receipt.reject(new Error('receipt not acknowledged'));
        await expect(run).resolves.toBeUndefined();
        expect(f.next).not.toHaveBeenCalled(); expect(handoff).not.toHaveBeenCalled();
        expect(f.close).toHaveBeenCalledOnce(); expect(f.unsubscribe).toHaveBeenCalledOnce();
        expect(f.aborted).toHaveBeenCalledOnce();
        expect(f.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(f.aborted.mock.invocationCallOrder[0]);
    });

});
