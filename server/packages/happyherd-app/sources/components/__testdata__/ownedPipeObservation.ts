// Diagnostic only: private instance hooks, never a prototype or installed-package patch.
// Audited against app-local Playwright 1.62.1 coreBundle.js.
// Caller supplies the version read from its own createRequire resolution.
export type PipeReceipt = {
    event: 'pipe-write-start' | 'pipe-write-return' | 'pipe-frame-observed' | 'pipe-observation-unavailable';
    id?: number;
    reason?: 'version' | 'local-implementation' | 'transport-shape' | 'frame-bound';
};
type MethodOwner = Record<string, any>;

export function observeOwnedPipe(chromium: any, version: string, emit: (receipt: PipeReceipt) => void) {
    let stopped = false;
    let pendingId: number | undefined;
    let wrote = false;
    let sending = false;
    let framed = false;
    const restorers: Array<() => void> = [];
    const report = (receipt: PipeReceipt) => {
        if (stopped) return;
        try { emit(receipt); } catch { /* Diagnostic only. */ }
    };
    const fail = (reason: NonNullable<PipeReceipt['reason']>) => {
        if (stopped) return;
        report({ event: 'pipe-observation-unavailable', reason });
        stop(); // Unavailable is terminal: no later partial or misleading receipts.
    };
    const replace = (owner: MethodOwner, key: string, make: (original: Function) => Function) => {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        const original = owner[key];
        if (typeof original !== 'function') throw new Error('Unavailable diagnostic method');
        const wrapper = make(original);
        Object.defineProperty(owner, key, { configurable: true, writable: true, value: wrapper });
        const restore = () => {
            if (owner[key] !== wrapper) return; // Never overwrite someone else's subsequent method.
            if (descriptor) Object.defineProperty(owner, key, descriptor);
            else delete owner[key];
        };
        restorers.push(restore);
        return restore;
    };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        pendingId = undefined;
        sending = false;
        for (const restore of restorers.reverse()) {
            try { restore(); } catch { /* Do not replace the launch result. */ }
        }
        restorers.length = 0;
    };
    const bind = (result: any) => {
        if (stopped) return;
        const transport = result?.transport;
        const pipeWrite = transport?._pipeWrite;
        if (!transport || typeof transport.send !== 'function'
            || typeof transport._dispatch !== 'function'
            || !Array.isArray(transport._pendingBuffers)
            || !pipeWrite || typeof pipeWrite.write !== 'function') {
            fail('transport-shape');
            return;
        }
        replace(transport, 'send', original => function (this: unknown, ...args: any[]) {
            // Keep only the allowed root method's numeric ID; never retain message/params.
            let observeSend = false;
            try {
                const message = args[0];
                if (!stopped && pendingId === undefined && !framed
                    && message?.method === 'Browser.getVersion' && !message.sessionId
                    && Number.isSafeInteger(message.id) && message.id >= 0) {
                    pendingId = message.id;
                    observeSend = true;
                }
            } catch { /* Delegate unchanged. */ }
            sending = observeSend;
            try { return Reflect.apply(original, this, args); }
            finally { sending = false; }
        });
        replace(pipeWrite, 'write', original => function (this: unknown, ...args: any[]) {
            const observing = !stopped && sending && pendingId !== undefined && !framed;
            if (observing && !wrote) {
                wrote = true;
                report({ event: 'pipe-write-start', id: pendingId });
            }
            // Exact receiver, argument/callback identities, return and thrown error.
            const value = Reflect.apply(original, this, args);
            // Audited send performs JSON write followed synchronously by this delimiter.
            if (observing && args[0] === '\0') report({ event: 'pipe-write-return', id: pendingId });
            return value;
        });
        replace(transport, '_dispatch', original => function (this: any, ...args: any[]) {
            try {
                if (!stopped && pendingId !== undefined && !framed) {
                    const buffer = args[0];
                    if (Buffer.isBuffer(buffer)) {
                        // Read ORIGINAL transport fragment state transiently; retain no shadow buffers.
                        const fragments = this._pendingBuffers;
                        let start = 0;
                        let first = true;
                        let frames = 0;
                        for (let end = buffer.indexOf(0); end !== -1; end = buffer.indexOf(0, start)) {
                            if (++frames > 16) { fail('frame-bound'); break; }
                            const prior = first ? fragments : [];
                            const bytes = prior.reduce((sum: number, item: Buffer) => sum + item.length, 0) + end - start;
                            if (bytes <= 8192) {
                                const message = JSON.parse(Buffer.concat([...prior, buffer.subarray(start, end)], bytes).toString('utf8'));
                                if (message && typeof message === 'object' && !message.sessionId && message.id === pendingId) {
                                    framed = true;
                                    report({ event: 'pipe-frame-observed', id: pendingId });
                                    break;
                                }
                            } else { fail('frame-bound'); break; }
                            first = false;
                            start = end + 1;
                        }
                    }
                }
            } catch { /* Malformed/unexpected diagnostic input must not affect transport. */ }
            // Original NUL parser and setImmediate scheduling execute unchanged, exactly once.
            return Reflect.apply(original, this, args);
        });
    };
    try {
        if (version !== '1.62.1') fail('version');
        else {
            const impl = chromium?._connection?.toImpl?.(chromium);
            if (!impl || typeof impl._launchProcess !== 'function') fail('local-implementation');
            else {
                let restoreLaunch: () => void;
                restoreLaunch = replace(impl, '_launchProcess', original => function (this: unknown, ...args: any[]) {
                    // One owning invocation only. No prototypes/global spawn state are touched.
                    try { restoreLaunch(); } catch { /* Delegate unchanged. */ }
                    const promise = Reflect.apply(original, this, args);
                    try {
                        // Register before _innerLaunch's await continuation, return ORIGINAL promise.
                        promise.then((result: any) => {
                            try { bind(result); } catch { fail('transport-shape'); }
                        }, () => undefined);
                    } catch { fail('transport-shape'); }
                    return promise;
                });
            }
        }
    } catch { fail('local-implementation'); }
    return { stop };
}
