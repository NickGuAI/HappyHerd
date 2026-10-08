import { describe, expect, it, vi } from 'vitest';
import { fork } from 'node:child_process';
import type { PersistedSession } from '@/persistence';
import { hasPersistedProcessConflict, isPidAlive, machineBootTimeMs } from './sessionLiveness';

// Keep the existing 5s test budget. Fail an IPC phase before Vitest times out so
// cleanup and the first lifecycle failure remain observable.
function startOwner() {
    const owner = fork(new URL('./fixtures/resume-owner.cjs', import.meta.url), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {}, execArgv: [],
    });
    const started = Date.now();
    const trace: string[] = [];
    const messages: Record<string, unknown>[] = [];
    const changed = new Set<() => void>();
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let failure: Error | undefined;
    let backendPid: number | undefined;
    const record = (event: string) => {
        trace.push(`${Date.now() - started}ms ${event}`);
        for (const notify of changed) notify();
    };
    owner.on('message', (message: Record<string, unknown>) => {
        messages.push(message);
        if (typeof message.backendPid === 'number') backendPid = message.backendPid;
        record(`message ${JSON.stringify(message)}`);
    });
    // Subscribe at fork time, not after an assertion or a possibly missed exit.
    owner.on('exit', (code, signal) => { exit = { code, signal }; record(`exit ${code}/${signal}`); });
    owner.on('error', (error) => { failure ??= error; record(`error ${error.message}`); });
    owner.on('disconnect', () => record('disconnect'));
    const wait = (phase: string, done: () => boolean, exiting = false, budget = 3500 - (Date.now() - started), cleaning = false) => {
        record(`await ${phase}`);
        return new Promise<void>((resolve, reject) => {
            const finish = (error?: Error) => {
                clearTimeout(timer);
                clearInterval(poll);
                changed.delete(check);
                if (error) reject(error); else resolve();
            };
            const diagnostic = (reason: string) => new Error(`${phase}: ${reason}; ${trace.join(' -> ')}`);
            const check = () => {
                if (done()) finish();
                else if (!cleaning && failure) finish(diagnostic(failure.message));
                else if (!cleaning && (exit || (!exiting && !owner.connected))) finish(diagnostic('owner ended before acknowledgement'));
            };
            const timer = setTimeout(() => finish(diagnostic('deadline exceeded')), Math.max(0, budget));
            const poll = cleaning ? setInterval(check, 10) : undefined;
            changed.add(check);
            check();
        });
    };
    return {
        owner,
        get backendPid() { return backendPid; },
        message: (key: string) => wait(key, () => messages.some((message) => message[key] === true)),
        async stop() {
            record('send SIGTERM');
            expect(owner.kill('SIGTERM')).toBe(true);
            await wait('stopping', () => messages.some((message) => message.stopping === true));
        },
        async finish() {
            record('send finish');
            owner.send('finish', (error) => { if (error) { failure ??= error; record(`send error ${error.message}`); } });
            await wait('owner exit', () => !!exit, true);
            expect(exit).toEqual({ code: 0, signal: null });
        },
        async cleanup() {
            const dead = () => !!exit && !isPidAlive(backendPid);
            if (dead()) return;
            // Disconnect also works before ready, when the parent has no backend PID.
            if (owner.connected) owner.disconnect();
            try {
                await wait('cleanup exit', dead, true, 1000, true);
            } catch (error) {
                // Kill only this fixture's processes, then confirm their termination.
                if (backendPid) {
                    try { process.kill(backendPid, 'SIGKILL'); } catch (killError) {
                        if ((killError as NodeJS.ErrnoException).code !== 'ESRCH') throw killError;
                    }
                }
                if (!exit) owner.kill('SIGKILL');
                await wait('forced cleanup exit', dead, true, 250, true);
                throw error;
            }
        },
    };
}

async function withOwner(run: (fixture: ReturnType<typeof startOwner>) => Promise<void>) {
    const fixture = startOwner();
    let firstFailure: unknown;
    try {
        await run(fixture);
    } catch (error) {
        firstFailure = error;
        throw error;
    } finally {
        try { await fixture.cleanup(); } catch (cleanupError) {
            if (firstFailure) throw new AggregateError([firstFailure, cleanupError], 'Fixture failed; cleanup also failed');
            throw cleanupError;
        }
    }
}

describe('session liveness (PR #1715)', () => {
    it('keeps a real owner and backend live after SIGTERM until confirmed exit', async () => {
        await withOwner(async (fixture) => {
            const { owner } = fixture;
            await fixture.message('ready');
            const saved = { savedAt: Date.now(), metadata: { hostPid: owner.pid } } as PersistedSession;
            expect(hasPersistedProcessConflict(saved, 0)).toBe(true);
            await fixture.stop();
            expect(isPidAlive(fixture.backendPid)).toBe(true);
            expect(hasPersistedProcessConflict(saved, 0)).toBe(true);
            await fixture.finish();
            expect(isPidAlive(owner.pid)).toBe(false);
            expect(isPidAlive(fixture.backendPid)).toBe(false);
        });
    });

    it.each(['backendStarted', 'ready'])('cleans up owner and backend on IPC loss at %s', async (phase) => {
        let ownerPid: number | undefined;
        let backendPid: number | undefined;
        await withOwner(async (fixture) => {
            await fixture.message(phase);
            ownerPid = fixture.owner.pid;
            backendPid = fixture.backendPid;
            fixture.owner.disconnect();
            await expect(fixture.message('stopping')).rejects.toThrow('owner ended before acknowledgement');
        });
        expect(isPidAlive(ownerPid)).toBe(false);
        expect(isPidAlive(backendPid)).toBe(false);
    });

    it('rejects a missing acknowledgement even when the owner has already exited', async () => {
        await withOwner(async (fixture) => {
            await fixture.message('ready');
            await fixture.finish();
            await expect(fixture.message('stopping')).rejects.toThrow('owner ended before acknowledgement');
        });
    });

    it('cleans up when disconnected before any readiness message', async () => {
        let ownerPid: number | undefined;
        await withOwner(async (fixture) => {
            ownerPid = fixture.owner.pid;
            fixture.owner.disconnect();
            await expect(fixture.message('ready')).rejects.toThrow('owner ended before acknowledgement');
        });
        expect(isPidAlive(ownerPid)).toBe(false);
    });

    it.each([undefined, 0, -1, 1.5, NaN, Infinity])('does not probe invalid PID %s', (pid) => {
        const kill = vi.fn();
        expect(isPidAlive(pid, kill)).toBe(false);
        expect(kill).not.toHaveBeenCalled();
    });

    it('only treats ESRCH as proof of death', () => {
        expect(isPidAlive(123, () => {})).toBe(true);
        for (const code of ['ESRCH', 'EPERM', 'EACCES', undefined]) {
            expect(isPidAlive(123, () => { throw Object.assign(new Error('probe'), { code }); })).toBe(code !== 'ESRCH');
        }
    });

    it('subtracts uptime from now', () => {
        expect(machineBootTimeMs(60, 1_000_000)).toBe(940_000);
    });

    it('rejects a live same-boot persisted PID without granting ownership or signalling it', () => {
        const probe = vi.spyOn(process, 'kill').mockReturnValue(true);
        const persisted = { metadata: { hostPid: 123 }, savedAt: 200 } as PersistedSession;
        try {
            expect(hasPersistedProcessConflict(persisted, 100)).toBe(true);
            expect(probe.mock.calls).toEqual([[123, 0]]);
            probe.mockClear();
            expect(hasPersistedProcessConflict(persisted, 300)).toBe(false);
            expect(hasPersistedProcessConflict(undefined, 100)).toBe(false);
            expect(probe).not.toHaveBeenCalled();
        } finally {
            probe.mockRestore();
        }
    });
});
