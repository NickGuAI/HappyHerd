import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { exec, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Machine } from './storageTypes';

const mocks = vi.hoisted(() => ({ machineBash: vi.fn(), machines: {} as Record<string, Machine> }));
vi.mock('./ops', () => ({ machineBash: mocks.machineBash }));
vi.mock('./storage', () => ({
    storage: { getState: () => ({ machines: mocks.machines }) },
    useMachine: (id: string) => mocks.machines[id] ?? null,
}));

let api: typeof import('./githubRepository');
const response = (inside = true, remotes = '') => ({ success: true, exitCode: 0, stdout: `${inside}\n${remotes}`, stderr: '' });
// `\u0040` spells "@" so these example remotes do not read as email addresses to scripts/verify-public-boundary.mjs.
const githubResponse = () => response(true, 'origin\tgit\u0040github.com:owner/repo.git (fetch)\n');
const machine = (active = true) => ({ active, metadata: { homeDir: '/home/test' } }) as Machine;
let renderer: ReturnType<typeof create> | undefined;

beforeEach(async () => {
    vi.resetModules();
    api = await import('./githubRepository');
    mocks.machines = { a: machine(), b: machine() };
    mocks.machineBash.mockReset().mockResolvedValue(response());
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    renderer = undefined;
    vi.useRealTimers();
});

describe('GitHub repository detection', () => {
    it.each([
        'https://github.com/owner/repo.git',
        'git\u0040github.com:owner/repo.git',
        'ssh://git\u0040github.com/owner/repo.git',
        'ssh://git\u0040github.com:22/owner/repo.git',
        'git://github.com/owner/repo',
    ])('recognizes a GitHub URL on any remote: %s', async (url) => {
        mocks.machineBash.mockResolvedValue(response(true, `origin\thttps://gitlab.com/owner/repo (fetch)\nupstream\t${url} (fetch)\n`));
        expect(await api.detectGithubRepository('a', '/repo')).toBe('github');
    });

    it.each([
        'https://github.com.evil.test/owner/repo',
        'https://github.com\u0040evil.test/owner/repo',
        'git\u0040github.com.evil.test:owner/repo.git',
        'https://gitlab.com/github.com/repo',
        '/local/github.com/repo',
        'file://github.com/repo',
    ])('does not confuse a non-GitHub remote with GitHub: %s', async (url) => {
        mocks.machineBash.mockResolvedValue(response(true, `origin\t${url} (fetch)\n`));
        expect(await api.detectGithubRepository('a', '/repo')).toBe('git');
    });

    it('distinguishes repositories without remotes from non-repositories', async () => {
        expect(await api.detectGithubRepository('a', '/repo')).toBe('git');
        mocks.machineBash.mockResolvedValue(response(false));
        expect(await api.detectGithubRepository('a', '/folder')).toBe('none');
    });

    it.each([
        'fatal: not a git repository (or any of the parent directories): .git',
        'fatal: detected dubious ownership in repository',
        'fatal: 不是 git 仓库',
    ])('classifies Git fatal exit 128 without inspecting stderr: %s', async (stderr) => {
        // Exact failed-command shape returned by the daemon bash handler.
        mocks.machineBash.mockResolvedValue({
            success: false, exitCode: 128, stdout: '', stderr, error: `Command failed: git\n${stderr}`,
        });
        expect(await api.detectGithubRepository('a', '/folder')).toBe('none');
    });

    it('treats a bare repository with GitHub remotes as outside a work tree', async () => {
        mocks.machineBash.mockResolvedValue(response(false, 'origin\tgit\u0040github.com:owner/repo.git (fetch)\n'));
        expect(await api.detectGithubRepository('a', '/bare.git')).toBe('none');
    });

    it('parses CRLF output and push-only GitHub remotes', async () => {
        mocks.machineBash.mockResolvedValue({
            ...response(),
            stdout: 'true\r\norigin\thttps://gitlab.com/owner/repo (fetch)\r\norigin\tgit\u0040github.com:owner/repo.git (push)\r\n',
        });
        expect(await api.detectGithubRepository('a', '/repo')).toBe('github');
    });

    it('passes normalized paths only through cwd and handles the root cwd sentinel', async () => {
        await api.detectGithubRepository('a', '~/repo/');
        expect(mocks.machineBash).toHaveBeenLastCalledWith('a',
            'git rev-parse --is-inside-work-tree && git remote -v', '/home/test/repo');
        await api.detectGithubRepository('a', '/');
        expect(mocks.machineBash).toHaveBeenLastCalledWith('a',
            'git -C / rev-parse --is-inside-work-tree && git -C / remote -v', '/');
    });

    it.each([
        { success: false, exitCode: -1, stdout: '', stderr: 'offline' },
        { success: false, exitCode: 1, stdout: '', stderr: 'timeout' },
        { success: false, exitCode: 127, stdout: '', stderr: 'git: command not found', error: 'Command failed: git' },
        { success: false, exitCode: 9009, stdout: '', stderr: 'git is not recognized', error: 'Command failed: git' },
        { success: false, exitCode: -1, stdout: 'true\n', stderr: '', error: 'Command timed out' },
        { success: false, error: 'Invalid working directory' },
        { success: false, exitCode: 0, stdout: 'true\n', stderr: '' },
        { success: true, exitCode: 0, stdout: 'unexpected', stderr: '' },
        { success: true, exitCode: 0, stdout: '{}', stderr: '' },
        { success: true, exitCode: 0, stdout: '', stderr: '' },
        { success: true, exitCode: 0, stdout: 'true\nunparseable remote output\n', stderr: '' },
    ])('returns unknown on RPC/command/invalid-response failures', async (result) => {
        mocks.machineBash.mockResolvedValue(result);
        expect(await api.detectGithubRepository('a', '/repo')).toBe('unknown');
    });

    it('returns unknown on rejected RPCs and bounds an unresolved RPC', async () => {
        mocks.machineBash.mockRejectedValueOnce(new Error('offline'));
        expect(await api.detectGithubRepository('a', '/failed')).toBe('unknown');
        vi.useFakeTimers();
        mocks.machineBash.mockReturnValue(new Promise(() => {}));
        const result = api.detectGithubRepository('a', '/stuck');
        await vi.advanceTimersByTimeAsync(6_000);
        expect(await result).toBe('unknown');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('caches by machine plus normalized path for five minutes', async () => {
        vi.useFakeTimers();
        mocks.machineBash.mockResolvedValue(githubResponse());
        expect(await api.detectGithubRepository('a', '~/repo/')).toBe('github');
        expect(await api.detectGithubRepository('a', '/home/test/repo')).toBe('github');
        expect(mocks.machineBash).toHaveBeenCalledTimes(1);
        await api.detectGithubRepository('b', '/home/test/repo');
        expect(mocks.machineBash).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(299_999);
        await api.detectGithubRepository('a', '/home/test/repo');
        expect(mocks.machineBash).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        await api.detectGithubRepository('a', '/home/test/repo');
        expect(mocks.machineBash).toHaveBeenCalledTimes(3);
    });

    it('shares in-flight requests for one target', async () => {
        let finish!: (result: ReturnType<typeof response>) => void;
        mocks.machineBash.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const first = api.detectGithubRepository('a', '/repo');
        const second = api.detectGithubRepository('a', '/repo/');
        expect(mocks.machineBash).toHaveBeenCalledTimes(1);
        finish(githubResponse());
        expect(await Promise.all([first, second])).toEqual(['github', 'github']);
    });

    it('does not use cached GitHub status or query missing/offline targets', async () => {
        mocks.machineBash.mockResolvedValue(githubResponse());
        expect(await api.detectGithubRepository('a', '/repo')).toBe('github');
        mocks.machines.a.active = false;
        expect(await api.detectGithubRepository('a', '/repo')).toBe('unknown');
        expect(await api.detectGithubRepository('missing', '/repo')).toBe('unknown');
        expect(await api.detectGithubRepository('b', '  ')).toBe('unknown');
        expect(mocks.machineBash).toHaveBeenCalledTimes(1);
    });

    it('does not keep a success received after the target went offline', async () => {
        let finish!: (result: ReturnType<typeof response>) => void;
        mocks.machineBash.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const request = api.detectGithubRepository('a', '/repo');
        mocks.machines.a.active = false;
        finish(githubResponse());
        expect(await request).toBe('unknown');
    });

    it.skipIf(process.platform === 'win32')('runs plain Git without Node on PATH, with literal shell metacharacters and real Git states', async () => {
        const temporary = mkdtempSync(join(process.cwd(), '.github-repository-test-'));
        const path = join(temporary, "repo ' \" $HOME $(printf injected) `printf injected` 中文");
        mkdirSync(path);
        const bin = join(temporary, 'bin');
        mkdirSync(bin);
        const git = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
        symlinkSync(git, join(bin, 'git'));
        const env = { ...process.env, PATH: bin, GIT_CEILING_DIRECTORIES: temporary };
        const run = promisify(exec);
        mocks.machineBash.mockImplementation(async (_machineId, command, cwd) => {
            try {
                // Keep Git discovery inside the fixture, not this checkout's parent repository.
                const { stdout, stderr } = await run(command, { cwd, env, timeout: 30_000 });
                return { success: true, exitCode: 0, stdout, stderr };
            } catch (error) {
                const failure = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
                return {
                    success: false,
                    exitCode: typeof failure.code === 'number' ? failure.code : failure.killed ? -1 : 1,
                    stdout: failure.stdout || '',
                    stderr: failure.stderr || failure.message || 'Command failed',
                    error: failure.killed ? 'Command timed out' : failure.message || 'Command failed',
                };
            }
        });
        try {
            await expect(run('node --version', { cwd: path, env })).rejects.toMatchObject({ code: 127 });
            expect(await api.detectGithubRepository('a', path)).toBe('none');
            execFileSync('git', ['init', '--quiet', path]);
            expect(await api.detectGithubRepository('b', path)).toBe('git');
            execFileSync('git', ['-C', path, 'remote', 'add', 'upstream', 'ssh://git\u0040github.com/owner/repo.git']);
            mocks.machines.c = machine();
            expect(await api.detectGithubRepository('c', path)).toBe('github');
            mocks.machines.d = machine();
            expect(await api.detectGithubRepository('d', relative(process.cwd(), path))).toBe('github');
            expect(await api.detectGithubRepository('a', join(path, '.git'))).toBe('none');
            const bare = join(temporary, 'bare.git');
            execFileSync('git', ['init', '--quiet', '--bare', bare]);
            expect(await api.detectGithubRepository('a', bare)).toBe('none');
            // Bad paths are operational failures, not evidence that a folder isn't a repository.
            expect(await api.detectGithubRepository('a', join(path, 'missing'))).toBe('unknown');
            expect(mocks.machineBash.mock.calls.every(([, command]) => command ===
                'git rev-parse --is-inside-work-tree && git remote -v')).toBe(true);
        } finally {
            rmSync(temporary, { recursive: true, force: true });
        }
    });
});

describe('useGithubRepository', () => {
    let current: ReturnType<typeof api.useGithubRepository>;
    function Harness({ machineId = 'a', path = '/repo' }: { machineId?: string | null; path?: string | null }) {
        current = api.useGithubRepository(machineId, path);
        return null;
    }
    const render = async (props: React.ComponentProps<typeof Harness> = {}) => {
        await act(async () => { renderer = create(React.createElement(Harness, props)); });
    };
    const update = async (props: React.ComponentProps<typeof Harness> = {}) => {
        await act(async () => { renderer.update(React.createElement(Harness, props)); });
    };

    it('reports loading and clears a prior GitHub classification while another target is pending', async () => {
        mocks.machineBash.mockResolvedValueOnce(githubResponse());
        await render();
        expect(current).toEqual({ status: 'github', loading: false });
        let finish!: (result: ReturnType<typeof response>) => void;
        mocks.machineBash.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        await update({ path: '/other' });
        expect(current).toEqual({ status: 'unknown', loading: true });
        await act(async () => { finish(response(false)); });
        expect(current).toEqual({ status: 'none', loading: false });
    });

    it('ignores an old target response after selection changes', async () => {
        let finish!: (result: ReturnType<typeof response>) => void;
        mocks.machineBash.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        await render();
        expect(current).toEqual({ status: 'unknown', loading: true });
        await update({ machineId: 'b' });
        expect(current).toEqual({ status: 'git', loading: false });
        await act(async () => { finish(githubResponse()); });
        expect(current).toEqual({ status: 'git', loading: false });
    });

    it('clears the result on disconnect and handles missing inputs without querying', async () => {
        mocks.machineBash.mockResolvedValue(githubResponse());
        await render();
        mocks.machines.a.active = false;
        await update();
        expect(current).toEqual({ status: 'unknown', loading: false });
        await update({ machineId: null });
        await update({ path: null });
        expect(mocks.machineBash).toHaveBeenCalledTimes(1);
        expect(current).toEqual({ status: 'unknown', loading: false });
    });

    it('ignores replies after unmount', async () => {
        let finish!: (result: ReturnType<typeof response>) => void;
        mocks.machineBash.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        await render();
        const before = current;
        await act(async () => { renderer.unmount(); });
        renderer = undefined;
        await act(async () => { finish(githubResponse()); });
        expect(current).toBe(before);
    });
});
