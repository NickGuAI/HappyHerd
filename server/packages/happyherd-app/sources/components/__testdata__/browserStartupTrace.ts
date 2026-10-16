import { createRequire } from 'node:module';
import { setInterval, clearInterval } from 'node:timers';
import { observeOwnedPipe, type PipeReceipt } from './ownedPipeObservation';

// Diagnostic-only adapter to the installed Playwright package-exported internal.
// This is not a stable public Playwright API; do not use it in product code.
type Sink = (this: { namespace?: string }, ...args: unknown[]) => void;
type Debug = { log: Sink; namespaces: string | undefined; enable: (namespaces: string | undefined) => void };
type Method = 'Browser.getVersion' | 'Target.setAutoAttach';
type Event = 'process-launching' | 'process-launched' | 'process-exited' | 'command-sent' | 'command-received' | 'command-error-received' | 'trace-started' | 'trace-limit-reached' | 'launch-resolved' | 'launch-rejected' | 'hook-teardown';
type Responsiveness = NonNullable<ReturnType<ReturnType<typeof observeStartupResponsiveness>>>;
type RecordFields = { event: Event | PipeReceipt['event']; method?: Method; id?: number; pid?: number; reason?: PipeReceipt['reason'] } & Partial<Responsiveness>;
const require = createRequire(import.meta.url);

export function traceBrowserStartup(fixture: 'desktopWorkspace' | 'sideChatHeader', chromium: unknown) {
    const { debug } = require('playwright-core/lib/utilsBundle') as { debug: Debug };
    const previousSink = debug.log;
    const previousNamespaces = debug.namespaces;
    const previousEnvironment = process.env.DEBUG;
    const startedAt = performance.now();
    const pending = new Map<number, Method>();
    let ordinaryRecords = 0;
    let limitReported = false;
    let terminalReported = false;
    let stopped = false;
    let pipeObservation: ReturnType<typeof observeOwnedPipe> | undefined;
    let finishResponsiveness: ReturnType<typeof observeStartupResponsiveness> | undefined;
    const finishObservation = () => {
        const finish = finishResponsiveness;
        finishResponsiveness = undefined;
        try { return finish?.(); } catch { return undefined; }
    };
    const restoreEnvironment = () => {
        if (previousEnvironment === undefined) delete process.env.DEBUG;
        else process.env.DEBUG = previousEnvironment;
    };
    const emit = (fields: RecordFields, terminal = false) => {
        try {
            // Reserve one limit marker and one terminal receipt: at most 16 total.
            if (terminal) {
                if (terminalReported) return;
                terminalReported = true;
            } else if (ordinaryRecords < 14) {
                ordinaryRecords++;
            } else {
                if (limitReported) return;
                limitReported = true;
                fields = { event: 'trace-limit-reached' };
            }
            console.info('[browser startup]', {
                fixture, at: new Date().toISOString(),
                elapsedMs: Math.round(performance.now() - startedAt), ...fields,
            });
        } catch {
            // Diagnostics must not change launch success or its original rejection.
        }
    };
    debug.log = function (...args: unknown[]) {
        if (stopped || typeof args[0] !== 'string') return;
        const line = args[0].replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
        if (this.namespace === 'pw:browser') {
            const text = line.slice(line.indexOf('pw:browser ') + 'pw:browser '.length);
            if (text.startsWith('<launching> ')) emit({ event: 'process-launching' });
            const launched = /^<launched> pid=(\d+)$/.exec(text);
            if (launched) emit({ event: 'process-launched', pid: Number(launched[1]) });
            const exited = /^\[pid=(\d+)\] <process did exit:/.exec(text);
            if (exited) emit({ event: 'process-exited', pid: Number(exited[1]) });
            return;
        }
        if (this.namespace !== 'pw:protocol') return;
        const send = line.indexOf('SEND ► ');
        const receive = line.indexOf('◀ RECV ');
        const direction = send >= 0 ? 'send' : receive >= 0 ? 'receive' : undefined;
        if (!direction) return;
        // Raw data exists only transiently at the sink. Never retain or forward it.
        let message: { id?: unknown; method?: unknown; sessionId?: unknown; error?: unknown };
        try {
            message = JSON.parse(line.slice((send >= 0 ? send : receive) + 7));
        } catch {
            return; // No raw-text fallback, including truncated protocol messages.
        }
        if (!message || typeof message !== 'object' || message.sessionId) return;
        if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id < 0) return;
        if (direction === 'send') {
            if (message.method !== 'Browser.getVersion' && message.method !== 'Target.setAutoAttach') return;
            if (message.method === 'Browser.getVersion' && !finishResponsiveness) {
                try { finishResponsiveness = observeStartupResponsiveness(); } catch { /* Diagnostics only. */ }
            }
            pending.set(message.id, message.method);
            emit({ event: 'command-sent', method: message.method, id: message.id });
        } else {
            const method = pending.get(message.id);
            if (!method) return;
            pending.delete(message.id);
            if (method === 'Browser.getVersion') pipeObservation?.stop();
            emit({ event: message.error ? 'command-error-received' : 'command-received', method, id: message.id,
                ...(method === 'Browser.getVersion' ? finishObservation() : undefined),
            });
        }
    };
    // Only this isolated fixture worker, only until launch settles / hook teardown.
    // Install the filtering sink BEFORE enabling either diagnostic namespace.
    debug.enable('pw:browser,pw:protocol');
    restoreEnvironment();
    emit({ event: 'trace-started' });
    const stop = (event: 'launch-resolved' | 'launch-rejected' | 'hook-teardown') => {
        if (stopped) return;
        stopped = true;
        pipeObservation?.stop();
        emit({ event, ...finishObservation() }, true);
        try {
            // On hook timeout, late launch and warmup may still execute. Silence
            // diagnostics and keep the dropping sink in this expired worker.
            debug.enable(event === 'hook-teardown' ? '' : previousNamespaces);
            if (event !== 'hook-teardown') debug.log = previousSink;
        } catch {
            // If restoration fails, retain the dropping sink; never mask launch.
        } finally {
            try { restoreEnvironment(); } catch { /* Preserve the operation result. */ }
            pending.clear();
        }
    };
    return {
        stop,
        async launch<T>(operation: () => Promise<T>): Promise<T> {
            let event: 'launch-resolved' | 'launch-rejected' = 'launch-rejected';
            try {
                // Core/debug initialization has already happened via the fixture import.
                // Version lookup failure disables observation, never the launch.
                let version = '';
                try { version = require('playwright-core/package.json').version; } catch { /* Diagnostic only. */ }
                if (!stopped) pipeObservation = observeOwnedPipe(chromium, version, emit);
                const value = await operation();
                event = 'launch-resolved';
                return value;
            } finally {
                // Retain the original rejection object, including TimeoutError/code/cause.
                stop(event);
            }
        },
    };
}


// Diagnostic observation only: no launch deadline, retry or scheduling change.
export function observeStartupResponsiveness() {
    const startedAt = performance.now();
    const startedCpu = process.cpuUsage();
    let lastTickAt = startedAt;
    let ticks = 0;
    let maxGapMs = 0;
    let maxGapStartMs = 0;
    let maxGapEndMs = 0;
    let stopped = false;
    const observeGap = (now: number) => {
        const gap = now - lastTickAt;
        if (gap > maxGapMs) {
            maxGapMs = gap;
            maxGapStartMs = lastTickAt - startedAt;
            maxGapEndMs = now - startedAt;
        }
    };
    const timer = setInterval(() => {
        const now = performance.now();
        observeGap(now);
        lastTickAt = now;
        ticks++;
    }, 250);
    timer.unref();
    return () => {
        if (stopped) return undefined;
        stopped = true;
        clearInterval(timer);
        const now = performance.now();
        observeGap(now); // Include a stalled final interval before response/teardown.
        const cpu = process.cpuUsage(startedCpu);
        return {
            heartbeatTicks: ticks,
            heartbeatElapsedMs: Math.round(now - startedAt),
            heartbeatMaxGapMs: Math.round(maxGapMs),
            heartbeatMaxGapStartMs: Math.round(maxGapStartMs),
            heartbeatMaxGapEndMs: Math.round(maxGapEndMs),
            heartbeatLastTickMs: Math.round(lastTickAt - startedAt),
            cpuUserMicros: cpu.user,
            cpuSystemMicros: cpu.system,
        };
    };
}

// Failure-only observations. These do not alter the original startup trace/caps.
const workspaceOperations = [
    'page-create', 'fixture-navigate', 'missing-initial-wait', 'machine-box', 'missing-capture',
    'recent-box', 'recent-hover', 'recent-wheel', 'recent-scroll-poll', 'root-click', 'root-file-wait',
    'missing-path-fill', 'missing-path-submit', 'missing-again-wait', 'home-click', 'home-file-wait',
    'missing-count-assert', 'home-path-assert', 'directory-call-assert', 'loaded-machine-box',
    'session-click', 'session-path-poll', 'machine-click', 'machine-missing-wait', 'parent-click',
    'parent-file-wait', 'loaded-capture', 'page-close', 'assertion',
] as const;
type WorkspaceOperation = typeof workspaceOperations[number];
type FailureSink = (receipt: unknown) => void;

export function recordWorkspaceAwaitFailure(
    sink: FailureSink = receipt => console.info('[workspace await failure]', receipt),
    clock: () => number = () => performance.now(),
) {
    const events: Array<{ operation: WorkspaceOperation; event: 'begin' | 'end'; elapsedMs: number }> = [];
    let active: WorkspaceOperation | undefined;
    let frozen = false;
    let emitted = false;
    let truncated = false;
    let unavailable = false;
    let startedAt = 0;
    let snapshot: unknown;
    try { startedAt = clock(); } catch { unavailable = true; }
    const elapsed = () => {
        const value = Math.round(clock() - startedAt);
        if (!Number.isFinite(value) || value < 0) throw new Error('Diagnostic clock unavailable');
        return value;
    };
    const mark = (operation: WorkspaceOperation, event: 'begin' | 'end') => {
        if (frozen) return;
        try {
            if (!workspaceOperations.includes(operation)) { unavailable = true; return; }
            if (event === 'begin') active = operation;
            else if (active === operation) active = undefined;
            if (events.length < 66) events.push({ operation, event, elapsedMs: elapsed() });
            else truncated = true;
        } catch { unavailable = true; }
    };
    const freeze = () => {
        if (frozen) return;
        frozen = true;
        let elapsedMs: number | undefined;
        try { elapsedMs = elapsed(); } catch { unavailable = true; }
        // Vitest invokes onFinished after onTaskFinished/afterEach/fixture cleanup.
        // This is callback-time state; the test body may have advanced after its deadline.
        snapshot = { fixture: 'desktopWorkspace', case: 'standalone-1440-missing-path',
            observation: 'task-finished-callback', taskBudgetMs: 10_000,
            events: events.slice(), activeAtCallback: active, callbackElapsedMs: elapsedMs, truncated, unavailable };
    };
    return {
        begin: (operation: WorkspaceOperation) => mark(operation, 'begin'),
        end: (operation: WorkspaceOperation) => mark(operation, 'end'),
        freeze,
        fail() {
            if (emitted) return;
            emitted = true;
            try { freeze(); sink(snapshot); } catch { /* Never replace a test outcome. */ }
        },
    };
}

type WarmupCategory = 'context-create' | 'page-create';
type WarmupReason = 'version' | 'shape' | 'install' | 'ambiguous' | 'observation' | 'restore';

// PRIVATE adapter audited against playwright-core 1.62.1 coreBundle.js:
// Browser.newPage 62319; context channel 62274; page channel 62019;
// connection onmessage 63454 and dispatch 63477. No prototype/package patch.
export function observeWarmupChannels(
    browser: any,
    version: string | undefined = undefined,
    sink: FailureSink = receipt => console.info('[warmup channel failure]', receipt),
    clock: () => number = () => performance.now(),
) {
    const events: Array<{ category: WarmupCategory; event: 'send' | 'response' | 'dispatch-return'; elapsedMs: number; error?: boolean }> = [];
    const pending = new Map<number, WarmupCategory>();
    const restores: Array<() => void> = [];
    let connection: any;
    let context: any;
    let contextId: number | undefined;
    let pageId: number | undefined;
    let contextReturned = false;
    let stopped = false;
    let disabled = false;
    let reason: WarmupReason | undefined;
    let truncated = false;
    let startedAt = 0;
    try { startedAt = clock(); } catch { disabled = true; reason = 'observation'; }
    const unavailable = (value: WarmupReason) => { disabled = true; reason ??= value; };
    const record = (category: WarmupCategory, event: 'send' | 'response' | 'dispatch-return', error?: boolean) => {
        try {
            const elapsedMs = Math.round(clock() - startedAt);
            if (!Number.isFinite(elapsedMs) || elapsedMs < 0) { unavailable('observation'); return; }
            if (events.length < 6) events.push({ category, event, elapsedMs, ...(error === undefined ? {} : { error }) });
            else { truncated = true; unavailable('ambiguous'); }
        } catch { unavailable('observation'); }
    };
    const restore = () => {
        for (const undo of restores.splice(0).reverse()) {
            try { undo(); } catch { unavailable('restore'); }
        }
    };
    const stop = (outcome: 'success' | 'failure' | 'teardown') => {
        if (stopped) return;
        stopped = true;
        const active = [...pending.values()]; // Fixed categories only, never IDs/owners.
        restore();
        pending.clear();
        context = undefined;
        connection = undefined;
        if (outcome !== 'success') {
            try { sink({ fixture: 'sideChatHeader', phase: 'warmup-new-page', outcome,
                events: events.slice(), active, unavailable: reason, truncated }); } catch { /* Diagnostic only. */ }
        }
    };
    const replace = (key: 'onmessage' | 'dispatch', make: (original: Function) => Function) => {
        const owner = connection;
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor && !('value' in descriptor)) throw new Error('Diagnostic shape unavailable');
        const original = owner[key];
        if (typeof original !== 'function') throw new Error('Diagnostic shape unavailable');
        const wrapper = make(original);
        Object.defineProperty(owner, key, { configurable: true, writable: true, value: wrapper });
        restores.push(() => {
            if (Object.getOwnPropertyDescriptor(owner, key)?.value !== wrapper) return;
            if (descriptor) Object.defineProperty(owner, key, descriptor);
            else delete owner[key];
        });
    };
    try {
        if (version === undefined) {
            try { version = require('playwright-core/package.json').version; } catch { unavailable('version'); }
        }
        if (version !== '1.62.1') unavailable('version');
        else if (!disabled) {
            connection = browser?._connection;
            if (!connection || !(connection._objects instanceof Map) || browser._type !== 'Browser'
                || connection._objects.get(browser._guid) !== browser
                || !(browser._contexts instanceof Set) || browser._contexts.size !== 0
                || typeof connection.onmessage !== 'function' || typeof connection.dispatch !== 'function') {
                unavailable('shape');
            } else {
                replace('onmessage', original => function (this: unknown, ...args: any[]) {
                    if (!stopped && !disabled) {
                        try {
                            const message = args[0];
                            const owner = connection._objects.get(message?.guid);
                            const id = message?.id;
                            const method = message?.method;
                            if (Number.isSafeInteger(id) && id > 0) {
                                if (owner === browser && method === 'newContext') {
                                    if (contextId !== undefined) unavailable('ambiguous');
                                    else { contextId = id; pending.set(id, 'context-create'); record('context-create', 'send'); }
                                } else if (owner?._type === 'BrowserContext' && owner._browser === browser && method === 'newPage') {
                                    if (!contextReturned || owner !== context || pageId !== undefined || id === contextId) unavailable('ambiguous');
                                    else { pageId = id; pending.set(id, 'page-create'); record('page-create', 'send'); }
                                }
                            }
                        } catch { unavailable('observation'); }
                    }
                    return Reflect.apply(original, this, args);
                });
                replace('dispatch', original => function (this: unknown, ...args: any[]) {
                    let category: WarmupCategory | undefined;
                    let id: number | undefined;
                    let error = false;
                    if (!stopped && !disabled) {
                        try {
                            id = args[0]?.id;
                            category = pending.get(id!);
                            if (category) {
                                error = Boolean(args[0]?.error); // Never read error content or result.
                                record(category, 'response', error);
                            }
                        } catch { unavailable('observation'); }
                    }
                    // Original return/throw identity and receiver/arguments are untouched.
                    const result = Reflect.apply(original, this, args);
                    if (!stopped && !disabled && category) {
                        try {
                            record(category, 'dispatch-return');
                            pending.delete(id!);
                            if (category === 'context-create' && !error) {
                                if (browser._contexts.size !== 1) unavailable('ambiguous');
                                else {
                                    const created = browser._contexts.values().next().value;
                                    if (created?._browser !== browser || created?._type !== 'BrowserContext'
                                        || connection._objects.get(created._guid) !== created) unavailable('ambiguous');
                                    else { context = created; contextReturned = true; }
                                }
                            }
                        } catch { unavailable('observation'); }
                    }
                    return result;
                });
            }
        }
    } catch {
        unavailable('install');
        restore(); // Roll back first own property if installing the second failed.
    }
    return { stop };
}
