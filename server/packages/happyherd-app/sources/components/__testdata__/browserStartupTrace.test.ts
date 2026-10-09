import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import 'playwright-core'; // Initialize the real core logger before interception.
import { traceBrowserStartup } from './browserStartupTrace';

const require = createRequire(import.meta.url);
const { debug } = require('playwright-core/lib/utilsBundle');
const saved = { log: debug.log, namespaces: debug.namespaces, env: process.env.DEBUG, enable: debug.enable };
const protocol = debug('pw:protocol');
const browser = debug('pw:browser');
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
    it('pairs only root startup commands and excludes payloads, arguments and stderr', async () => {
        const trace = traceBrowserStartup('desktopWorkspace');
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
        expect(records.every(r => Object.keys(r).every(key => ['fixture', 'at', 'elapsedMs', 'event', 'method', 'id', 'pid'].includes(key)))).toBe(true);
        expect(inheritedSink).not.toHaveBeenCalled();
        expect(debug.log).toBe(inheritedSink);
        expect(debug.namespaces).toBe('pw:browser,pw:protocol');
        expect(process.env.DEBUG).toBe('previous-environment');
    });

    it('preserves original rejection identity and emits its terminal event', async () => {
        const original = Object.assign(new Error(sentinel), { name: 'TimeoutError', code: 'TEST_CODE', cause: { detail: sentinel } });
        await expect(traceBrowserStartup('sideChatHeader').launch(async () => { throw original; })).rejects.toBe(original);
        expect(records.at(-1)?.event).toBe('launch-rejected');
        expect(JSON.stringify(records)).not.toContain(sentinel);
        expect(debug.log).toBe(inheritedSink);
    });

    it('drops late startup and warmup after hook teardown without reviving the raw sink', async () => {
        const trace = traceBrowserStartup('sideChatHeader');
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
        await traceBrowserStartup('desktopWorkspace').launch(async () => {
            for (let id = 1; id < 40; id++) send({ id, method: 'Browser.getVersion' });
        });
        expect(records).toHaveLength(16);
        expect(records.at(-2)?.event).toBe('trace-limit-reached');
        expect(records.at(-1)?.event).toBe('launch-resolved');
    });

    it('does not replace the operation rejection when diagnostic emission and cleanup throw', async () => {
        vi.mocked(console.info).mockImplementation(() => { throw new Error('synthetic sink failure'); });
        const trace = traceBrowserStartup('desktopWorkspace');
        debug.enable = () => { throw new Error('synthetic restoration failure'); };
        const original = new Error('original operation failure');
        await expect(trace.launch(async () => { throw original; })).rejects.toBe(original);
        expect(process.env.DEBUG).toBe('previous-environment');
        expect(debug.log).not.toBe(inheritedSink);
    });
});
