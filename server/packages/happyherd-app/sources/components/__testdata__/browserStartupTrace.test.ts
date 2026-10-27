import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import 'playwright-core'; // Initialize the real core logger before interception.
import { traceBrowserStartup, recordWorkspaceAwaitFailure, observeWarmupChannels } from './browserStartupTrace';

const require = createRequire(import.meta.url);
const { debug } = require('playwright-core/lib/utilsBundle');
const saved = { log: debug.log, namespaces: debug.namespaces, env: process.env.DEBUG, enable: debug.enable };
const protocol = debug('pw:protocol');
const browser = debug('pw:browser');
const syntheticChromium = { _connection: { toImpl: () => ({ _launchProcess: () => Promise.resolve({}) }) } };
const sentinel = 'SYNTHETIC_PAYLOAD_MUST_NOT_BE_RETAINED';
let records: Array<Record<string, unknown>>;
const inheritedSink = vi.fn();
const send = (message: unknown) => protocol('SEND ► ' + JSON.stringify(message));
const receive = (message: unknown) => protocol('◀ RECV ' + JSON.stringify(message));

beforeEach(() => {
    debug.enable('pw:browser,pw:protocol');
    process.env.DEBUG = 'previous-environment';
    debug.log = inheritedSink;
    inheritedSink.mockClear();
    records = [];
    vi.spyOn(console, 'info').mockImplementation((label, record) => {
        expect(label).toBe('[browser startup]');
        records.push(record);
    });
});
afterEach(() => {
    debug.enable = saved.enable;
    debug.enable(saved.namespaces);
    debug.log = saved.log;
    protocol.useColors = false;
    if (saved.env === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = saved.env;
    vi.restoreAllMocks();
});

describe('fixture browser startup metadata', () => {
    it('orders owned pipe receipts between SEND and RECV and restores the taps at RECV', async () => {
        const write = vi.fn((..._args: unknown[]) => false);
        const dispatch = vi.fn((..._args: unknown[]) => undefined);
        const transport = {
            _pipeWrite: { write }, _pendingBuffers: [] as Buffer[], _dispatch: dispatch,
            send(message: unknown) { this._pipeWrite.write(JSON.stringify(message)); this._pipeWrite.write('\0'); },
        };
        const launchProcess = () => Promise.resolve({ transport });
        const impl = { _launchProcess: launchProcess };
        const chromium = { _connection: { toImpl: () => impl } };
        const trace = traceBrowserStartup('desktopWorkspace', chromium);
        const value = {};
        await expect(trace.launch(async () => {
            await impl._launchProcess();
            const request = { id: 1, method: 'Browser.getVersion', params: { secret: sentinel } };
            send(request);
            transport.send(request);
            transport._dispatch(Buffer.from(JSON.stringify({ id: 1, result: sentinel }) + '\0'));
            receive({ id: 1, result: sentinel });
            expect(transport._dispatch).toBe(dispatch);
            expect(transport._pipeWrite.write).toBe(write);
            return value;
        })).resolves.toBe(value);
        expect(records.map(r => r.event)).toEqual(['trace-started', 'command-sent', 'pipe-write-start', 'pipe-write-return', 'pipe-frame-observed', 'command-received', 'launch-resolved']);
        expect(records.find(r => r.event === 'command-received')?.heartbeatTicks).toBe(0);
        expect(JSON.stringify(records)).not.toContain(sentinel);
        expect(impl._launchProcess).toBe(launchProcess);
        expect(debug.log).toBe(inheritedSink);
    });

    it('pairs only root startup commands and excludes payloads, arguments and stderr', async () => {
        const trace = traceBrowserStartup('desktopWorkspace', syntheticChromium);
        const value = {};
        await expect(trace.launch(async () => {
            browser('<launching> /' + sentinel + ' --profile=' + sentinel);
            browser('<launched> pid=77');
            browser('[pid=77][err] ' + sentinel);
            send({ id: 1, method: 'Browser.getVersion', params: { auth: sentinel } });
            receive({ id: 1, sessionId: 'child', result: { body: sentinel } });
            receive({ id: 999, result: { body: sentinel } });
            receive({ id: 1, result: { body: sentinel } });
            protocol.useColors = true;
            send({ id: 2, method: 'Target.setAutoAttach', params: { body: sentinel } });
            receive({ id: 2, error: { message: sentinel } });
            protocol.useColors = false;
            send({ id: 3, method: 'Runtime.evaluate', params: { expression: sentinel } });
            protocol('SEND ► {malformed ' + sentinel);
            browser('[pid=77] <process did exit: exitCode=1, signal=null>');
            return value;
        })).resolves.toBe(value);
        expect(records.map(r => r.event)).toEqual(['trace-started', 'process-launching', 'process-launched', 'command-sent', 'command-received', 'command-sent', 'command-error-received', 'process-exited', 'launch-resolved']);
        expect(records.filter(r => r.method).map(r => [r.method, r.id])).toEqual([['Browser.getVersion', 1], ['Browser.getVersion', 1], ['Target.setAutoAttach', 2], ['Target.setAutoAttach', 2]]);
        expect(JSON.stringify(records)).not.toContain(sentinel);
        expect(records.every(r => Object.keys(r).every(key => ['fixture', 'at', 'elapsedMs', 'event', 'method', 'id', 'pid', 'heartbeatTicks', 'heartbeatElapsedMs', 'heartbeatMaxGapMs', 'heartbeatMaxGapStartMs', 'heartbeatMaxGapEndMs', 'heartbeatLastTickMs', 'cpuUserMicros', 'cpuSystemMicros', 'reason'].includes(key)))).toBe(true);
        const responsiveness = records.find(r => r.method === 'Browser.getVersion' && r.event === 'command-received')!;
        for (const key of ['heartbeatTicks', 'heartbeatElapsedMs', 'heartbeatMaxGapMs', 'heartbeatMaxGapStartMs', 'heartbeatMaxGapEndMs', 'heartbeatLastTickMs', 'cpuUserMicros', 'cpuSystemMicros']) {
            expect(typeof responsiveness[key]).toBe('number');
            expect(Number.isFinite(responsiveness[key])).toBe(true);
            expect(responsiveness[key]).toBeGreaterThanOrEqual(0);
        }
        expect(responsiveness.heartbeatTicks).toBe(0); // No event-loop turn in this synthetic exchange.
        expect(records.filter(r => r.heartbeatTicks !== undefined)).toHaveLength(1);
        expect(inheritedSink).not.toHaveBeenCalled();
        expect(debug.log).toBe(inheritedSink);
        expect(debug.namespaces).toBe('pw:browser,pw:protocol');
        expect(process.env.DEBUG).toBe('previous-environment');
    });

    it('preserves original rejection identity and emits its terminal event', async () => {
        const original = Object.assign(new Error(sentinel), { name: 'TimeoutError', code: 'TEST_CODE', cause: { detail: sentinel } });
        await expect(traceBrowserStartup('sideChatHeader', syntheticChromium).launch(async () => { throw original; })).rejects.toBe(original);
        expect(records.at(-1)?.event).toBe('launch-rejected');
        expect(JSON.stringify(records)).not.toContain(sentinel);
        expect(debug.log).toBe(inheritedSink);
    });

    it('drops late startup and warmup after hook teardown without reviving the raw sink', async () => {
        const trace = traceBrowserStartup('sideChatHeader', syntheticChromium);
        let resolve!: () => void;
        const pending = trace.launch(() => new Promise<void>(done => { resolve = done; }));
        send({ id: 1, method: 'Browser.getVersion' });
        trace.stop('hook-teardown');
        const count = records.length;
        expect(records.at(-1)?.event).toBe('hook-teardown');
        expect(debug.log).not.toBe(inheritedSink);
        debug.enable('pw:browser,pw:protocol');
        receive({ id: 1, result: { body: sentinel } });
        resolve();
        await pending;
        send({ id: 2, method: 'Target.setAutoAttach', params: { body: sentinel } });
        expect(records).toHaveLength(count);
        expect(inheritedSink).not.toHaveBeenCalled();
        expect(debug.log).not.toBe(inheritedSink);
    });

    it('reserves the terminal receipt after metadata saturation', async () => {
        await traceBrowserStartup('desktopWorkspace', syntheticChromium).launch(async () => {
            for (let id = 1; id < 40; id++) send({ id, method: 'Browser.getVersion' });
        });
        expect(records).toHaveLength(16);
        expect(records.at(-2)?.event).toBe('trace-limit-reached');
        expect(records.at(-1)?.event).toBe('launch-resolved');
    });

    it('does not replace the operation rejection when diagnostic emission and cleanup throw', async () => {
        vi.mocked(console.info).mockImplementation(() => { throw new Error('synthetic sink failure'); });
        const trace = traceBrowserStartup('desktopWorkspace', syntheticChromium);
        debug.enable = () => { throw new Error('synthetic restoration failure'); };
        const original = new Error('original operation failure');
        await expect(trace.launch(async () => { throw original; })).rejects.toBe(original);
        expect(process.env.DEBUG).toBe('previous-environment');
        expect(debug.log).not.toBe(inheritedSink);
    });
});

// Candidate diagnostics: synthetic connection delegates only, no browser launch.
describe('failure-only workspace operation recorder', () => {
    it('freezes callback-time state and ignores post-callback completion; emits only once', () => {
        let now = 0;
        const sink = vi.fn();
        const phase = recordWorkspaceAwaitFailure(sink, () => now);
        phase.begin('page-create'); now = 7; phase.end('page-create');
        now = 8; phase.begin('fixture-navigate'); now = 10000; phase.freeze();
        expect(sink).not.toHaveBeenCalled();
        now = 10001; phase.end('fixture-navigate'); phase.begin('assertion');
        phase.fail(); phase.fail();
        expect(sink).toHaveBeenCalledTimes(1);
        expect(sink.mock.calls[0][0]).toMatchObject({ observation: 'task-finished-callback', taskBudgetMs: 10000, activeAtCallback: 'fixture-navigate', callbackElapsedMs: 10000, truncated: false,
            events: [{ operation: 'page-create', event: 'begin', elapsedMs: 0 },
                { operation: 'page-create', event: 'end', elapsedMs: 7 },
                { operation: 'fixture-navigate', event: 'begin', elapsedMs: 8 }] });
    });

    it('records progress before the callback without claiming the active await at the deadline', () => {
        let now = 0;
        const sink = vi.fn();
        const phase = recordWorkspaceAwaitFailure(sink, () => now);
        phase.begin('fixture-navigate');
        now = 10005; phase.end('fixture-navigate');
        now = 10006; phase.begin('missing-initial-wait');
        now = 10020; phase.freeze(); phase.fail();
        expect(sink.mock.calls[0][0]).toMatchObject({ taskBudgetMs: 10000,
            observation: 'task-finished-callback', callbackElapsedMs: 10020,
            activeAtCallback: 'missing-initial-wait', events: [
                { operation: 'fixture-navigate', event: 'begin', elapsedMs: 0 },
                { operation: 'fixture-navigate', event: 'end', elapsedMs: 10005 },
                { operation: 'missing-initial-wait', event: 'begin', elapsedMs: 10006 },
            ] });
    });

    it('uses a real Vitest finished callback without requiring a timed-out body', ({ onTestFinished }) => {
        const sink = vi.fn();
        const phase = recordWorkspaceAwaitFailure(sink, () => 0);
        phase.begin('home-file-wait');
        onTestFinished(() => {
            phase.freeze(); phase.end('home-file-wait');
            expect(sink).not.toHaveBeenCalled();
            // Exercise failure emission after real runner callback, not a timeout-cause claim.
            phase.fail();
            expect(sink.mock.calls[0][0].activeAtCallback).toBe('home-file-wait');
        });
    });

    it('bounds events, retains fixed categories only and cannot throw diagnostic failures', () => {
        const sink = vi.fn();
        const phase = recordWorkspaceAwaitFailure(sink, () => 0);
        for (let n = 0; n < 100; n++) { phase.begin('assertion'); phase.end('assertion'); }
        phase.begin(sentinel as any); phase.fail();
        expect(sink.mock.calls[0][0]).toMatchObject({ truncated: true, unavailable: true });
        expect(sink.mock.calls[0][0].events).toHaveLength(66);
        expect(JSON.stringify(sink.mock.calls)).not.toContain(sentinel);
        const broken = recordWorkspaceAwaitFailure(() => { throw sentinel; }, () => { throw sentinel; });
        expect(() => { broken.begin('page-create'); broken.end('page-create'); broken.freeze(); broken.fail(); }).not.toThrow();
    });
});

function channelFixture() {
    const returned = {};
    const onmessage = vi.fn(function (this: unknown, ..._args: unknown[]) { return returned; });
    const dispatch = vi.fn(function (this: unknown, ..._args: unknown[]) { return returned; });
    const connection = { _objects: new Map<string, any>(), onmessage, dispatch };
    const browser: any = { _type: 'Browser', _guid: 'browser-private', _connection: connection, _contexts: new Set() };
    connection._objects.set(browser._guid, browser);
    const addContext = () => {
        const context = { _type: 'BrowserContext', _guid: 'context-private', _browser: browser };
        browser._contexts.add(context); connection._objects.set(context._guid, context);
        return context;
    };
    return { connection, browser, onmessage, dispatch, returned, addContext };
}

describe('private owned warmup channel observation', () => {
    it('records context/page boundaries with exact delegation and silent successful restoration', () => {
        const f = channelFixture(); const sink = vi.fn();
        const before = Object.getOwnPropertyDescriptors(f.connection);
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        const request = { id: 1, guid: f.browser._guid, method: 'newContext' };
        const extra = {};
        expect(f.connection.onmessage(request, extra)).toBe(f.returned);
        expect(f.onmessage.mock.contexts[0]).toBe(f.connection);
        expect(f.onmessage.mock.calls[0]).toEqual([request, extra]);
        expect(f.onmessage.mock.calls[0][0]).toBe(request);
        const context = f.addContext();
        const response = { id: 1 };
        expect(f.connection.dispatch(response)).toBe(f.returned);
        expect(f.dispatch.mock.calls[0][0]).toBe(response);
        f.connection.onmessage({ id: 2, guid: context._guid, method: 'newPage' });
        f.connection.dispatch({ id: 2 });
        observer.stop('success'); observer.stop('failure');
        expect(sink).not.toHaveBeenCalled();
        expect(Object.getOwnPropertyDescriptors(f.connection)).toEqual(before);
    });

    it('retains the two complete channel boundaries without payloads on a later failure', () => {
        const f = channelFixture(); const sink = vi.fn();
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        f.connection.onmessage({ id: 1, guid: f.browser._guid, method: 'newContext' });
        const context = f.addContext(); f.connection.dispatch({ id: 1 });
        f.connection.onmessage({ id: 2, guid: context._guid, method: 'newPage' });
        f.connection.dispatch({ id: 2 }); observer.stop('failure');
        expect(sink.mock.calls[0][0].events.map((e: any) => [e.category, e.event])).toEqual([
            ['context-create', 'send'], ['context-create', 'response'], ['context-create', 'dispatch-return'],
            ['page-create', 'send'], ['page-create', 'response'], ['page-create', 'dispatch-return'],
        ]);
        expect(sink.mock.calls[0][0].active).toEqual([]);
        expect(f.dispatch.mock.contexts.every(value => value === f.connection)).toBe(true);
    });

    it.each(['context', 'page'] as const)('captures pending %s before teardown and ignores late wrappers', (boundary) => {
        const f = channelFixture(); const sink = vi.fn();
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        f.connection.onmessage({ id: 1, guid: f.browser._guid, method: 'newContext' });
        if (boundary === 'page') {
            const context = f.addContext(); f.connection.dispatch({ id: 1 });
            f.connection.onmessage({ id: 2, guid: context._guid, method: 'newPage' });
        }
        const lateDispatch = f.connection.dispatch;
        observer.stop('teardown');
        expect(sink.mock.calls[0][0].active).toEqual([boundary === 'context' ? 'context-create' : 'page-create']);
        const frozen = JSON.stringify(sink.mock.calls);
        lateDispatch.call(f.connection, { id: 1 }); observer.stop('failure');
        expect(JSON.stringify(sink.mock.calls)).toBe(frozen);
        expect(f.dispatch).toHaveBeenCalled();
    });

    it('distinguishes an observed response from dispatch throw and preserves the thrown object', () => {
        const f = channelFixture(); const sink = vi.fn(); const error = new Error(sentinel);
        f.dispatch.mockImplementation(() => { throw error; });
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        f.connection.onmessage({ id: 1, guid: f.browser._guid, method: 'newContext' });
        let caught: unknown;
        try { f.connection.dispatch({ id: 1 }); } catch (value) { caught = value; }
        expect(caught).toBe(error); observer.stop('failure');
        expect(sink.mock.calls[0][0].events.map((e: any) => e.event)).toEqual(['send', 'response']);
        expect(JSON.stringify(sink.mock.calls)).not.toContain(sentinel);
    });

    it('does not read params/results/errors or retain unrelated and wrong-owner payloads', () => {
        const f = channelFixture(); const sink = vi.fn();
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        const poison = { get params() { throw sentinel; }, get result() { throw sentinel; }, get url() { throw sentinel; } };
        f.connection._objects.set('other', { _type: 'BrowserContext', _browser: {} });
        f.connection.onmessage({ id: 10, guid: 'other', method: 'newPage' });
        f.connection.onmessage(Object.assign(Object.create(poison), { id: 1, guid: f.browser._guid, method: 'newContext' }));
        f.addContext();
        f.connection.dispatch(Object.assign(Object.create(poison), { id: 1, error: { message: sentinel } }));
        observer.stop('failure');
        expect(sink.mock.calls[0][0].events.map((e: any) => e.category)).toEqual(['context-create', 'context-create', 'context-create']);
        expect(sink.mock.calls[0][0].events[1].error).toBe(true);
        expect(JSON.stringify(sink.mock.calls)).not.toMatch(/browser-private|context-private|SYNTHETIC_PAYLOAD|"id"|"guid"/);
    });

    it.each(['duplicate', 'wrong-context', 'two-contexts'] as const)('disables ambiguous %s observations', (mode) => {
        const f = channelFixture(); const sink = vi.fn();
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        f.connection.onmessage({ id: 1, guid: f.browser._guid, method: 'newContext' });
        if (mode === 'duplicate') f.connection.onmessage({ id: 2, guid: f.browser._guid, method: 'newContext' });
        else {
            const context = f.addContext();
            if (mode === 'two-contexts') f.browser._contexts.add({});
            f.connection.dispatch({ id: 1 });
            if (mode === 'wrong-context') {
                const other = { ...context, _guid: 'different' }; f.connection._objects.set(other._guid, other);
                f.connection.onmessage({ id: 2, guid: other._guid, method: 'newPage' });
            }
        }
        observer.stop('failure');
        expect(sink.mock.calls[0][0].unavailable).toBe('ambiguous');
        expect(sink.mock.calls[0][0].events.length).toBeLessThanOrEqual(6);
    });

    it('rolls back the first installation when the second property is not replaceable', () => {
        const f = channelFixture(); const sink = vi.fn();
        Object.defineProperty(f.connection, 'dispatch', { value: f.dispatch, configurable: false });
        const before = Object.getOwnPropertyDescriptors(f.connection);
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        expect(Object.getOwnPropertyDescriptors(f.connection)).toEqual(before);
        observer.stop('failure'); expect(sink.mock.calls[0][0].unavailable).toBe('install');
    });

    it('deletes inherited-method shadows and never overwrites external replacements', () => {
        const f = channelFixture(); const sink = vi.fn();
        const inherited = { onmessage: f.onmessage, dispatch: f.dispatch };
        delete (f.connection as any).onmessage; delete (f.connection as any).dispatch;
        Object.setPrototypeOf(f.connection, inherited);
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        const replacement = vi.fn(); f.connection.dispatch = replacement;
        observer.stop('failure');
        expect(Object.hasOwn(f.connection, 'onmessage')).toBe(false);
        expect(f.connection.onmessage).toBe(f.onmessage);
        expect(f.connection.dispatch).toBe(replacement);
    });

    it('preserves original send throw even when the diagnostic clock and sink fail', () => {
        const f = channelFixture(); const original = new Error('original');
        f.onmessage.mockImplementation(() => { throw original; });
        let now = 0;
        const observer = observeWarmupChannels(f.browser, '1.62.1', () => { throw sentinel; }, () => {
            if (now++) throw sentinel; return 0;
        });
        let caught: unknown;
        try { f.connection.onmessage({ id: 1, guid: f.browser._guid, method: 'newContext' }); } catch (e) { caught = e; }
        expect(caught).toBe(original);
        expect(() => observer.stop('failure')).not.toThrow();
        expect(f.connection.onmessage).toBe(f.onmessage);
    });

    it.each(['version', 'shape'] as const)('leaves original delegates alone when %s is unavailable', (mode) => {
        const f = channelFixture(); const sink = vi.fn();
        if (mode === 'shape') f.browser._contexts.add({});
        const observer = observeWarmupChannels(f.browser, mode === 'version' ? '0.0.0' : '1.62.1', sink, () => 0);
        expect(f.connection.onmessage).toBe(f.onmessage); expect(f.connection.dispatch).toBe(f.dispatch);
        observer.stop('failure'); expect(sink.mock.calls[0][0].unavailable).toBe(mode);
    });

    it('reports restoration failure without throwing or reviving a late observer', () => {
        const f = channelFixture(); const sink = vi.fn();
        const observer = observeWarmupChannels(f.browser, '1.62.1', sink, () => 0);
        Object.defineProperty(f.connection, 'onmessage', { configurable: false });
        expect(() => observer.stop('failure')).not.toThrow();
        expect(sink.mock.calls[0][0].unavailable).toBe('restore');
        const count = sink.mock.calls.length;
        expect(f.connection.onmessage({ id: 1, guid: f.browser._guid, method: 'newContext' })).toBe(f.returned);
        expect(sink).toHaveBeenCalledTimes(count);
    });
});
