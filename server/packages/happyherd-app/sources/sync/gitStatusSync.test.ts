import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: {} as any,
    sessionBash: vi.fn(),
}));

vi.mock('./ops', () => ({ sessionBash: mocks.sessionBash }));
vi.mock('./storage', () => ({ storage: { getState: () => mocks.state } }));

import { GitStatusSync } from './gitStatusSync';

const STATUS = [
    '# branch.oid 0123456789abcdef',
    '# branch.head main',
    '1 .M N... 100644 100644 100644 0123456789abcdef 0123456789abcdef src/app.ts',
    '? notes.md',
].join('\n');

function session(id: string, active: boolean) {
    return { id, active, metadata: { machineId: 'machine-1', path: '/repo' } };
}

// Let the debounce elapse and the refresh's awaited RPCs settle.
async function settle(ms = 300) {
    await vi.advanceTimersByTimeAsync(ms);
}

let git: GitStatusSync;

beforeEach(() => {
    vi.useFakeTimers();
    mocks.state = {
        sessions: { a: session('a', true), b: session('b', true) },
        pathGitStatus: {},
        applyGitStatus: vi.fn((key: string, status: unknown) => { mocks.state.pathGitStatus[key] = status; }),
        applyGitStatusFiles: vi.fn(),
    };
    mocks.sessionBash.mockReset();
    mocks.sessionBash.mockImplementation(async (_sessionId: string, request: { command: string }) => {
        if (request.command.includes('rev-parse')) return { success: true, stdout: 'true\n', stderr: '', exitCode: 0 };
        if (request.command.includes(' status ')) return { success: true, stdout: STATUS, stderr: '', exitCode: 0 };
        if (request.command.includes('--cached')) return { success: true, stdout: '', stderr: '', exitCode: 0 };
        return { success: true, stdout: '3\t1\tsrc/app.ts\n', stderr: '', exitCode: 0 };
    });
    git = new GitStatusSync();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('GitStatusSync', () => {
    it('coalesces a burst of invalidations into one refresh of four git commands', async () => {
        expect(git.hasStatus('a')).toBe(false);
        for (let i = 0; i < 10; i++) git.invalidate('a');
        await settle();

        expect(mocks.sessionBash).toHaveBeenCalledTimes(4);
        expect(mocks.sessionBash.mock.calls.every(([sessionId]) => sessionId === 'a')).toBe(true);
        expect(git.hasStatus('a')).toBe(true);
    });

    it('spaces refreshes of one project by the minimum interval', async () => {
        git.invalidate('a');
        await settle();
        expect(mocks.sessionBash).toHaveBeenCalledTimes(4);

        git.invalidate('a');
        git.invalidate('b');
        await settle(GitStatusSync.MIN_REFRESH_INTERVAL_MS - 400);
        expect(mocks.sessionBash).toHaveBeenCalledTimes(4);

        await settle(400);
        expect(mocks.sessionBash).toHaveBeenCalledTimes(8);
    });

    it('runs git through a live session after the first session for the path exits', async () => {
        git.getSync('a');
        git.getSync('b');
        mocks.state.sessions.a = session('a', false);

        git.invalidate('a');
        await settle();

        expect(mocks.sessionBash).toHaveBeenCalledTimes(4);
        expect(mocks.sessionBash.mock.calls.every(([sessionId]) => sessionId === 'b')).toBe(true);
    });

    it('keeps the last status without calling an offline session', async () => {
        mocks.state.sessions = { a: session('a', false) };
        git.invalidate('a');
        await settle();

        expect(mocks.sessionBash).not.toHaveBeenCalled();
        expect(mocks.state.applyGitStatus).not.toHaveBeenCalled();
    });

    it('stores the Files sidebar list from the same four commands', async () => {
        git.getSync('a').invalidate();
        await settle(0);

        expect(mocks.sessionBash).toHaveBeenCalledTimes(4);
        expect(mocks.state.applyGitStatusFiles).toHaveBeenCalledOnce();
        const [key, files] = mocks.state.applyGitStatusFiles.mock.calls[0];
        expect(key).toBe('machine-1:/repo');
        expect(files.branch).toBe('main');
        expect(files.unstagedFiles).toEqual(expect.arrayContaining([
            expect.objectContaining({ fullPath: 'src/app.ts', status: 'modified', linesAdded: 3, linesRemoved: 1 }),
            expect.objectContaining({ fullPath: 'notes.md', status: 'untracked' }),
        ]));
    });
});
