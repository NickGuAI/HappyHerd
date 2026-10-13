// SOURCE-ONLY REVIEW PROPOSAL. Private to the two issue-411 browser fixtures.
// No new timer, timeout, retry, worker policy or Playwright option.
export function browserFixtureSetup<Prepared, Browser, Server>(operations: {
    prepare: (stopWithError: (error: unknown) => void) => Promise<Prepared>;
    listen: (prepared: Prepared) => Promise<Server>;
    launch: () => Promise<Browser>;
    warmup?: (browser: Browser, assertActive: () => void, stopWithError: (error: unknown) => void) => Promise<void>;
    closeBrowser: (browser: Browser) => Promise<void>;
    closeServer: (server: Server) => Promise<void>;
    onStop: () => void;
    onCleanupFailure?: (resource: 'browser' | 'server' | 'trace') => void;
}) {
    let started = false;
    let stopped = false;
    let readySettled = false;
    let failed = false;
    let firstError: unknown;
    const stoppedError = new Error('Browser fixture setup stopped before readiness');
    let browser: Browser | undefined;
    let server: Server | undefined;
    let browserAcquired = false;
    let serverAcquired = false;
    let browserClose: Promise<void> | undefined;
    let serverClose: Promise<void> | undefined;
    let disposal: Promise<void> | undefined;
    // Reserve completion slots before ANY operation can synchronously stop us.
    const finishBranches: Array<() => void> = [];
    const branches = [0, 1].map(index => new Promise<void>(resolve => {
        finishBranches[index] = resolve;
    }));
    const cleanupErrors: unknown[] = [];
    let resolveReady!: (value: { browser: Browser; server: Server }) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<{ browser: Browser; server: Server }>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    // Teardown can reject ready before its hook caller resumes. Always observed.
    void ready.catch(() => undefined);
    const assertActive = () => {
        if (stopped) throw failed ? firstError : stoppedError;
    };
    const closeBrowser = () => {
        if (browserAcquired && !browserClose) {
            browserClose = Promise.resolve().then(() => operations.closeBrowser(browser!))
                .catch(error => {
                    cleanupErrors.push(error);
                    try { operations.onCleanupFailure?.('browser'); } catch { /* Reporting cannot replace cleanup failure. */ }
                });
        }
        return browserClose;
    };
    const closeServer = () => {
        if (serverAcquired && !serverClose) {
            serverClose = Promise.resolve().then(() => operations.closeServer(server!))
                .catch(error => {
                    cleanupErrors.push(error);
                    try { operations.onCleanupFailure?.('server'); } catch { /* Reporting cannot replace cleanup failure. */ }
                });
        }
        return serverClose;
    };
    const stop = (): Promise<void> => {
        if (disposal) return disposal;
        // Reserve shared identity before onStop or any other callback can reenter.
        let resolveDisposal!: () => void;
        let rejectDisposal!: (error: unknown) => void;
        disposal = new Promise<void>((resolve, reject) => {
            resolveDisposal = resolve;
            rejectDisposal = reject;
        });
        void disposal.catch(() => undefined);
        stopped = true; // Before tracing or any asynchronous close/wait.
        if (!started) finishBranches.forEach(finish => finish());
        if (!readySettled) {
            readySettled = true;
            rejectReady(failed ? firstError : stoppedError);
        }
        try { operations.onStop(); } catch (error) {
            cleanupErrors.push(error);
            try { operations.onCleanupFailure?.('trace'); } catch { /* Reporting cannot replace cleanup failure. */ }
        }
        closeBrowser();
        closeServer();
        void (async () => {
            // Pending acquisitions are not cancelled by Promise rejection. Their
            // handlers adopt and close them below, without warmup/listen/ready.
            await Promise.allSettled(branches);
            await Promise.all([closeBrowser(), closeServer()]);
            if (!failed && cleanupErrors.length) throw cleanupErrors[0];
        })().then(resolveDisposal, rejectDisposal);
        return disposal;
    };
    const fail = (error: unknown) => {
        if (!stopped && !failed) {
            failed = true;
            firstError = error; // Preserve identity, even undefined/null rejection.
        }
        void stop();
    };
    const initialize = async () => {
        const acquired = await operations.launch();
        browser = acquired;
        browserAcquired = true; // Own browser before warmup can fail or teardown.
        if (stopped) { await closeBrowser(); return; }
        assertActive();
        await operations.warmup?.(acquired, assertActive, fail);
        assertActive();
    };
    const prepareAndListen = async () => {
        const prepared = await operations.prepare(fail);
        assertActive(); // Never begin listening after stop during preparation.
        const acquired = await operations.listen(prepared);
        server = acquired;
        serverAcquired = true; // Successful listen acquisition, including late one.
        if (stopped) { await closeServer(); return; }
        assertActive();
    };
    return {
        start() {
            if (started) return ready;
            started = true;
            if (stopped) return ready;
            // Calling initialize starts launch NOW, before any preparation await.
            // Each rejection handler is attached before starting its sibling.
            void initialize().then(finishBranches[0], error => {
                fail(error);
                finishBranches[0]();
            });
            void prepareAndListen().then(finishBranches[1], error => {
                fail(error);
                finishBranches[1]();
            });
            void Promise.all(branches).then(() => {
                if (stopped || readySettled) return;
                readySettled = true;
                resolveReady({ browser: browser!, server: server! });
            });
            return ready;
        },
        stop,
    };
}
