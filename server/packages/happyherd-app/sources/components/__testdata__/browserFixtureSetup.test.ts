// SOURCE-ONLY REVIEW PROPOSAL: not executed. Synthetic scheduling/lifecycle proof.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserFixtureSetup } from './browserFixtureSetup';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness() {
    const prep = deferred<string>();
    const launch = deferred<object>();
    const listen = deferred<object>();
    const warm = deferred<void>();
    const browser = {};
    const server = {};
    const operations = {
        prepare: vi.fn((_stopWithError: (error: unknown) => void) => prep.promise),
        listen: vi.fn((_prepared: string) => listen.promise),
        launch: vi.fn(() => launch.promise),
        warmup: vi.fn((_browser: object, _active: () => void, _fail: (error: unknown) => void) => warm.promise),
        closeBrowser: vi.fn(async (_browser: object): Promise<void> => undefined),
        closeServer: vi.fn(async (_server: object) => undefined),
        onStop: vi.fn(),
    };
    return { prep, launch, listen, warm, browser, server, operations };
}
afterEach(() => vi.useRealTimers());

describe('two-fixture setup scheduling and resource ownership', () => {
    it('starts initialization before unresolved preparation; readiness joins both independent branches', async () => {
        const h = harness();
        const setup = browserFixtureSetup(h.operations);
        const ready = setup.start();
        const settled = vi.fn();
        void ready.then(settled);
        expect(h.operations.launch).toHaveBeenCalledOnce(); // Earliest scheduling boundary.
        expect(h.operations.prepare).toHaveBeenCalledOnce();
        h.launch.resolve(h.browser); h.warm.resolve(); await drain();
        expect(h.operations.warmup).toHaveBeenCalledOnce();
        expect(settled).not.toHaveBeenCalled();
        h.prep.resolve('prepared'); await drain();
        expect(h.operations.listen).toHaveBeenCalledWith('prepared');
        expect(settled).not.toHaveBeenCalled();
        h.listen.resolve(h.server);
        await expect(ready).resolves.toEqual({ browser: h.browser, server: h.server });
        expect(setup.start()).toBe(ready);
        await setup.stop();
    });

    it('does not publish readiness when preparation/listen finish but warmup is unresolved', async () => {
        const h = harness(); const setup = browserFixtureSetup(h.operations);
        const ready = setup.start(); const settled = vi.fn(); void ready.then(settled);
        h.prep.resolve('prepared'); h.listen.resolve(h.server); h.launch.resolve(h.browser); await drain();
        expect(settled).not.toHaveBeenCalled();
        h.warm.resolve(); await ready; await setup.stop();
    });

    it('stops synchronously before cleanup and prevents warmup navigation after a late page acquisition', async () => {
        const h = harness(); const page = deferred<void>(); const navigate = vi.fn();
        h.operations.warmup.mockImplementation(async (_browser, active) => {
            await page.promise; active(); navigate();
        });
        const setup = browserFixtureSetup(h.operations); const ready = setup.start();
        const rejected = expect(ready).rejects.toThrow('stopped before readiness');
        h.launch.resolve(h.browser); await drain();
        const stop = setup.stop();
        expect(h.operations.onStop).toHaveBeenCalledOnce();
        expect(h.operations.closeBrowser).not.toHaveBeenCalled(); // Close begins in following microtask.
        page.resolve(); h.prep.resolve('prepared');
        await rejected; await stop;
        expect(navigate).not.toHaveBeenCalled(); expect(h.operations.listen).not.toHaveBeenCalled();
    });

    it('preserves even undefined initiating rejection and never starts after prior teardown', async () => {
        const h = harness(); const setup = browserFixtureSetup(h.operations); const ready = setup.start();
        h.prep.reject(undefined); await expect(ready).rejects.toBeUndefined();
        h.launch.reject(new Error('later')); await setup.stop();
        const other = harness(); const stopped = browserFixtureSetup(other.operations);
        await stopped.stop(); await expect(stopped.start()).rejects.toThrow('stopped before readiness');
        expect(other.operations.prepare).not.toHaveBeenCalled(); expect(other.operations.launch).not.toHaveBeenCalled();
    });

    it('reserves disposal identity before a synchronous reentrant onStop callback', async () => {
        const h = harness(); let nested: Promise<void> | undefined;
        const setup = browserFixtureSetup(h.operations);
        h.operations.onStop.mockImplementation(() => { nested = setup.stop(); });
        const ready = setup.start();
        const rejected = expect(ready).rejects.toThrow('stopped before readiness');
        const disposal = setup.stop();
        expect(nested).toBe(disposal);
        expect(h.operations.onStop).toHaveBeenCalledOnce();
        h.launch.resolve(h.browser); h.prep.resolve('prepared');
        await rejected; await disposal;
        expect(h.operations.closeBrowser).toHaveBeenCalledExactlyOnceWith(h.browser);
        expect(h.operations.listen).not.toHaveBeenCalled();
        expect(h.operations.warmup).not.toHaveBeenCalled();
    });

    it('reserves both branch slots before synchronous launch-stop and joins late browser/preparation', async () => {
        const h = harness(); let disposal!: Promise<void>;
        const setup = browserFixtureSetup(h.operations);
        h.operations.launch.mockImplementation(() => { disposal = setup.stop(); return h.launch.promise; });
        const ready = setup.start();
        const rejected = expect(ready).rejects.toThrow('stopped before readiness');
        const closed = vi.fn(); void disposal.then(closed);
        expect(setup.stop()).toBe(disposal);
        expect(h.operations.prepare).toHaveBeenCalledOnce();
        await drain(); expect(closed).not.toHaveBeenCalled();
        h.launch.resolve(h.browser); await drain();
        expect(h.operations.closeBrowser).toHaveBeenCalledExactlyOnceWith(h.browser);
        expect(closed).not.toHaveBeenCalled(); // Preparation completion slot is still pending.
        h.prep.resolve('prepared'); await rejected; await disposal;
        expect(closed).toHaveBeenCalledOnce();
        expect(h.operations.onStop).toHaveBeenCalledOnce();
        expect(h.operations.listen).not.toHaveBeenCalled();
        expect(h.operations.warmup).not.toHaveBeenCalled();
    });

    it.each([
        { first: new Error('first compiler'), siblingRejects: false },
        { first: undefined, siblingRejects: true },
        { first: null, siblingRejects: true },
    ])('rejects readiness promptly but joins both side-chat compiler settlements ($siblingRejects)', async ({ first, siblingRejects }) => {
        const h = harness(); const a = deferred<object>(); const b = deferred<object>();
        const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
        // This exact observation block is also embedded in side-chat prepare.
        // It exercises the real controller boundary; no esbuild or browser runs.
        h.operations.prepare.mockImplementation(async stopWithError => {
            const builds = [a.promise, b.promise];
            let buildFailed = false;
            let firstBuildError: unknown;
            const observedBuilds = builds.map(promise => promise.catch(error => {
                if (!buildFailed) {
                    buildFailed = true;
                    firstBuildError = error;
                    stopWithError(error);
                }
                throw error;
            }));
            const results = await Promise.allSettled(observedBuilds);
            if (buildFailed) throw firstBuildError;
            const bundles = results.map(result => {
                if (result.status === 'rejected') throw result.reason;
                return result.value;
            });
            return String(bundles.length);
        });
        try {
            const setup = browserFixtureSetup(h.operations); const ready = setup.start();
            const rejected = expect(ready).rejects.toBe(first);
            a.reject(first); await rejected;
            const disposal = setup.stop(); const settled = vi.fn(); void disposal.then(settled);
            h.launch.resolve(h.browser); await drain();
            expect(settled).not.toHaveBeenCalled();
            expect(h.operations.closeBrowser).toHaveBeenCalledExactlyOnceWith(h.browser);
            if (siblingRejects) b.reject(new Error('second compiler')); else b.resolve({});
            await disposal;
            expect(h.operations.listen).not.toHaveBeenCalled();
            expect(h.operations.warmup).not.toHaveBeenCalled();
            expect(h.operations.onStop).toHaveBeenCalledOnce();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).not.toHaveBeenCalled();
        } finally { process.off('unhandledRejection', unhandled); }
    });

    it('reports each cleanup category once after primary failure without retaining raw errors', async () => {
        const h = harness(); const categories: string[] = [];
        const sentinel = 'PRIVATE_CLEANUP_ERROR_SENTINEL';
        const primary = new Error('original warmup');
        h.operations.onStop.mockImplementation(() => { throw new Error(sentinel); });
        h.operations.closeBrowser.mockRejectedValue(new Error(sentinel));
        h.operations.closeServer.mockRejectedValue(new Error(sentinel));
        const setup = browserFixtureSetup({ ...h.operations, onCleanupFailure: resource => categories.push(resource) });
        const ready = setup.start(); const rejected = expect(ready).rejects.toBe(primary);
        h.launch.resolve(h.browser); h.prep.resolve('prepared'); h.listen.resolve(h.server); await drain();
        h.warm.reject(primary); await rejected;
        const disposal = setup.stop(); expect(setup.stop()).toBe(disposal); await disposal;
        expect(categories.sort()).toEqual(['browser', 'server', 'trace']);
        expect(JSON.stringify(categories)).not.toContain(sentinel);
        expect(h.operations.closeBrowser).toHaveBeenCalledOnce();
        expect(h.operations.closeServer).toHaveBeenCalledOnce();
        expect(h.operations.onStop).toHaveBeenCalledOnce();
    });

    it.each([false, true])('throwing cleanup reporter preserves initiating error (primary=%s)', async primaryFails => {
        const h = harness(); const primary = new Error('primary'); const cleanup = new Error('original close');
        h.operations.closeBrowser.mockRejectedValue(cleanup);
        const reporter = vi.fn(() => { throw new Error('reporter'); });
        const setup = browserFixtureSetup({ ...h.operations, onCleanupFailure: reporter });
        const ready = setup.start();
        const outcome = primaryFails ? expect(ready).rejects.toBe(primary) : expect(ready).resolves.toEqual({ browser: h.browser, server: h.server });
        h.launch.resolve(h.browser); h.prep.resolve('prepared'); h.listen.resolve(h.server); await drain();
        if (primaryFails) h.warm.reject(primary); else h.warm.resolve();
        await outcome;
        if (primaryFails) await expect(setup.stop()).resolves.toBeUndefined();
        else await expect(setup.stop()).rejects.toBe(cleanup);
        expect(reporter).toHaveBeenCalledExactlyOnceWith('browser');
    });

    it('models avoidable budget contribution with explicitly artificial 400ms warmup', async () => {
        vi.useFakeTimers();
        const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
        const setup = browserFixtureSetup({
            prepare: async () => { await sleep(3871); return {}; },
            listen: async () => ({}),
            launch: async () => { await sleep(25776); return {}; },
            warmup: async () => { await sleep(400); }, // Artificial successful duration, NOT failed 3293ms sample.
            closeBrowser: async () => undefined, closeServer: async () => undefined, onStop: () => undefined,
        });
        const ready = vi.fn();
        void setup.start().then(ready);
        await vi.advanceTimersByTimeAsync(26175); expect(ready).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1); expect(ready).toHaveBeenCalledOnce();
        expect(3871 + 25776 + 400).toBe(30047); // Serial exceeds unchanged 30000; no real-failure claim.
        await setup.stop();
    });

    it.each(['prepare', 'launch', 'warmup', 'listen'] as const)('preserves original %s rejection and consumes sibling rejection', async stage => {
        const h = harness(); const first = Object.assign(new Error(stage), { code: 'ORIGINAL', cause: {} });
        const second = new Error('sibling');
        const setup = browserFixtureSetup(h.operations); const ready = setup.start();
        const rejection = expect(ready).rejects.toBe(first);
        if (stage === 'prepare') h.prep.reject(first);
        if (stage === 'launch') h.launch.reject(first);
        if (stage === 'warmup') { h.launch.resolve(h.browser); await drain(); h.warm.reject(first); }
        if (stage === 'listen') { h.prep.resolve('prepared'); await drain(); h.listen.reject(first); }
        await rejection;
        h.prep.reject(second); h.launch.reject(second); h.listen.reject(second); h.warm.reject(second);
        // Gates not yet consumed by an operation are explicitly observed by the harness.
        await Promise.allSettled([h.prep.promise, h.launch.promise, h.listen.promise, h.warm.promise]);
        await setup.stop();
        expect(h.operations.onStop).toHaveBeenCalledOnce();
    });

    it('closes a browser acquired after stop without starting warmup or readiness', async () => {
        const h = harness(); const setup = browserFixtureSetup(h.operations); const ready = setup.start();
        const rejected = expect(ready).rejects.toThrow('stopped before readiness');
        const stop = setup.stop();
        expect(setup.stop()).toBe(stop); expect(h.operations.onStop).toHaveBeenCalledOnce();
        h.launch.resolve(h.browser); h.prep.resolve('prepared');
        await rejected; await stop;
        expect(h.operations.warmup).not.toHaveBeenCalled();
        expect(h.operations.listen).not.toHaveBeenCalled();
        expect(h.operations.closeBrowser).toHaveBeenCalledExactlyOnceWith(h.browser);
    });

    it('closes a late listening server once and disposes an adopted browser before warmup settles', async () => {
        const h = harness(); const setup = browserFixtureSetup(h.operations); const ready = setup.start();
        const rejection = expect(ready).rejects.toThrow('stopped before readiness');
        h.prep.resolve('prepared'); h.launch.resolve(h.browser); await drain();
        const stop = setup.stop(); await drain();
        expect(h.operations.closeBrowser).toHaveBeenCalledExactlyOnceWith(h.browser);
        h.listen.resolve(h.server); h.warm.reject(new Error('browser closed'));
        await rejection; await stop;
        expect(h.operations.closeServer).toHaveBeenCalledExactlyOnceWith(h.server);
        expect(setup.stop()).toBe(stop);
    });

    it('records warmup error before slow cleanup and never replaces it with preparation or close errors', async () => {
        const h = harness(); const first = new Error('goto failed'); const close = deferred<void>();
        h.operations.closeBrowser.mockImplementation(() => close.promise);
        h.operations.warmup.mockImplementation(async (_browser, _active, stopWithError) => {
            stopWithError(first); // Mirrors integration catch before page-close finally.
            await close.promise;
            throw first;
        });
        const setup = browserFixtureSetup(h.operations); const ready = setup.start();
        const rejected = expect(ready).rejects.toBe(first);
        h.launch.resolve(h.browser); await rejected;
        h.prep.reject(new Error('later preparation')); close.reject(new Error('cleanup'));
        await setup.stop();
        expect(h.operations.closeBrowser).toHaveBeenCalledOnce();
    });

    it('preserves a successful teardown cleanup failure and shares exactly one disposal', async () => {
        const h = harness(); const error = new Error('close failed');
        h.operations.closeBrowser.mockRejectedValue(error);
        const setup = browserFixtureSetup(h.operations); const ready = setup.start();
        h.launch.resolve(h.browser); h.prep.resolve('prepared'); h.listen.resolve(h.server); h.warm.resolve();
        await ready;
        const a = setup.stop(), b = setup.stop(); expect(a).toBe(b);
        await expect(a).rejects.toBe(error);
        expect(h.operations.closeBrowser).toHaveBeenCalledOnce(); expect(h.operations.closeServer).toHaveBeenCalledOnce();
    });

    it('attaches rejection consumers immediately, including a sibling that rejects after failure', async () => {
        const h = harness(); const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
        try {
            const setup = browserFixtureSetup(h.operations); const ready = setup.start();
            const first = new Error('first'); h.prep.reject(first);
            await expect(ready).rejects.toBe(first);
            h.launch.reject(new Error('late sibling'));
            await setup.stop();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).not.toHaveBeenCalled();
        } finally { process.off('unhandledRejection', unhandled); }
    });
});
