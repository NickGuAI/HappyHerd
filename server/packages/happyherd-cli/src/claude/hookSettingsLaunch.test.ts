import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { claudeLocal } from './claudeLocal';
import { claudeRemote } from './claudeRemote';
import { cleanupHookSettingsFile, generateHookSettingsFile } from './utils/generateHookSettings';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), query: vi.fn(), initialize: vi.fn(), wrap: vi.fn() }));
vi.mock('cross-spawn', () => ({ spawn: mocks.spawn }));
vi.mock('@/claude/sdk', () => ({ query: mocks.query, AbortError: class extends Error {} }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn() } }));
vi.mock('./utils/claudeCheckSession', () => ({ claudeCheckSession: () => true }));
vi.mock('./utils/path', () => ({ getProjectPath: (path: string) => path }));
vi.mock('./utils/systemPrompt', () => ({ systemPrompt: 'test' }));
vi.mock('@/sandbox/manager', () => ({ initializeSandbox: mocks.initialize, wrapCommand: mocks.wrap }));

let root: string;
let settingsPath: string;
const port = 43219;

function checkSettings(path: string) {
    expect(path).toBe(settingsPath);
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    expect(settings.hooks.SessionStart).toEqual([{
        matcher: '*', hooks: [{ type: 'command', command: expect.stringContaining(`session_hook_forwarder.cjs\" ${port}`) }],
    }]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
}

beforeEach(() => {
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'happyherd-hook-launch-test-'));
    settingsPath = generateHookSettingsFile(port, root);
    mocks.spawn.mockImplementation((_command, args) => {
        checkSettings(args[args.indexOf('--settings') + 1]);
        return {
            stdio: [null, null, null, null],
            on: vi.fn((event, callback) => { if (event === 'exit') process.nextTick(() => callback(0)); }),
            kill: vi.fn(),
        };
    });
    mocks.query.mockImplementation(({ options }) => {
        checkSettings(options.settingsPath);
        return { async *[Symbol.asyncIterator]() {} };
    });
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function launch(kind: 'local' | 'remote', beforeLaunch = () => {}) {
    const common = { sessionId: null, path: root, hookSettingsPath: settingsPath, hookSettingsPort: port, onSessionFound: vi.fn() };
    if (kind === 'local') {
        beforeLaunch();
        await claudeLocal({ ...common, abort: new AbortController().signal });
    } else {
        await claudeRemote({
            ...common, allowedTools: [], canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
            nextMessage: vi.fn().mockImplementationOnce(async () => {
                beforeLaunch(); // Deletion while the session is waiting for its next turn.
                return { message: 'control', mode: { permissionMode: 'default' } };
            }).mockResolvedValue(null),
            onReady: vi.fn(), onMessage: vi.fn(), isAborted: () => false,
        });
    }
}

describe.each(['local', 'remote'] as const)('%s Claude hook settings at launch', (kind) => {
    it.each(['file', 'directory'] as const)('relaunches after removal of its %s', async (removed) => {
        await launch(kind);
        await launch(kind, () => {
            if (removed === 'file') unlinkSync(settingsPath);
            else rmSync(dirname(settingsPath), { recursive: true });
            expect(existsSync(settingsPath)).toBe(false);
        });
        expect(kind === 'local' ? mocks.spawn : mocks.query).toHaveBeenCalledTimes(2);
        cleanupHookSettingsFile(settingsPath);
        expect(existsSync(dirname(settingsPath))).toBe(false);
    });
});

describe('hook shutdown cleanup after temp removal', () => {
    it.each(['file', 'directory'] as const)('removes owned directory when %s is already gone', (removed) => {
        if (removed === 'file') unlinkSync(settingsPath);
        else rmSync(dirname(settingsPath), { recursive: true });
        cleanupHookSettingsFile(settingsPath);
        expect(existsSync(dirname(settingsPath))).toBe(false);
        cleanupHookSettingsFile(settingsPath);
    });
});

const sandboxConfig = {
    enabled: true, sessionIsolation: 'workspace' as const,
    customWritePaths: [], denyReadPaths: [], extraWritePaths: [], denyWritePaths: [],
    networkMode: 'allowed' as const, allowedDomains: [], deniedDomains: [], allowLocalBinding: true,
};

describe('local settings after asynchronous sandbox preparation', () => {
    it('restores the directory deleted during sandbox wrapping before spawn', async () => {
        const cleanup = vi.fn(async () => {});
        mocks.initialize.mockResolvedValue(cleanup);
        mocks.wrap.mockImplementation(async () => {
            rmSync(dirname(settingsPath), { recursive: true });
            await Promise.resolve();
            return 'wrapped command';
        });
        const originalSpawn = mocks.spawn.getMockImplementation()!;
        mocks.spawn.mockImplementation((command, args) => {
            expect(command).toBe('wrapped command');
            expect(args).toEqual([]);
            return originalSpawn(command, ['--settings', settingsPath]);
        });
        await claudeLocal({
            sessionId: null, path: root, hookSettingsPath: settingsPath, hookSettingsPort: port,
            onSessionFound: vi.fn(), abort: new AbortController().signal, sandboxConfig,
        });
        expect(cleanup).toHaveBeenCalledOnce();
        expect(mocks.spawn).toHaveBeenCalledOnce();
    });

    it('cleans up an initialized sandbox and preserves the settings error if restoration fails', async () => {
        const cleanup = vi.fn(async () => { throw new Error('secondary cleanup error'); });
        mocks.initialize.mockResolvedValue(cleanup);
        mocks.wrap.mockImplementation(async () => {
            rmSync(dirname(settingsPath), { recursive: true });
            writeFileSync(dirname(settingsPath), 'owned test obstruction');
            return 'wrapped command';
        });
        await expect(claudeLocal({
            sessionId: null, path: root, hookSettingsPath: settingsPath, hookSettingsPort: port,
            onSessionFound: vi.fn(), abort: new AbortController().signal, sandboxConfig,
        })).rejects.toMatchObject({ code: 'EEXIST' });
        expect(cleanup).toHaveBeenCalledOnce();
        expect(mocks.spawn).not.toHaveBeenCalled();
    });
});
