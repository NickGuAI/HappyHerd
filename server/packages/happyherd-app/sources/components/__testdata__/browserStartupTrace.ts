import { createRequire } from 'node:module';

// Diagnostic-only adapter to the installed Playwright package-exported internal.
// This is not a stable public Playwright API; do not use it in product code.
type Sink = (this: { namespace?: string }, ...args: unknown[]) => void;
type Debug = { log: Sink; namespaces: string | undefined; enable: (namespaces: string | undefined) => void };
type Method = 'Browser.getVersion' | 'Target.setAutoAttach';
type Event = 'process-launching' | 'process-launched' | 'process-exited' | 'command-sent' | 'command-received' | 'command-error-received' | 'trace-started' | 'trace-limit-reached' | 'launch-resolved' | 'launch-rejected' | 'hook-teardown';
type RecordFields = { event: Event; method?: Method; id?: number; pid?: number };
const require = createRequire(import.meta.url);

export function traceBrowserStartup(fixture: 'desktopWorkspace' | 'sideChatHeader') {
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
            pending.set(message.id, message.method);
            emit({ event: 'command-sent', method: message.method, id: message.id });
        } else {
            const method = pending.get(message.id);
            if (!method) return;
            pending.delete(message.id);
            emit({ event: message.error ? 'command-error-received' : 'command-received', method, id: message.id });
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
        emit({ event }, true);
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
