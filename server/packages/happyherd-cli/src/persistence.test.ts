import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    acquireDaemonLock,
    clearDaemonState,
    persistSession,
    persistSessionRegistration,
    readPersistedSessions,
    releaseDaemonLock,
    SandboxConfigSchema,
    type PersistedSession,
} from './persistence';

const mockConfiguration = vi.hoisted(() => ({
    daemonLockFile: '',
    daemonStateFile: '',
    isDaemonProcess: false,
    logsDir: '/tmp',
    sessionsFile: '',
}));

vi.mock('@/configuration', () => ({
    configuration: mockConfiguration,
}));

describe('SandboxConfigSchema', () => {
    it('applies defaults when values are omitted', () => {
        const parsed = SandboxConfigSchema.parse({});

        expect(parsed).toEqual({
            enabled: false,
            sessionIsolation: 'workspace',
            customWritePaths: [],
            denyReadPaths: ['~/.ssh', '~/.aws', '~/.gnupg'],
            extraWritePaths: ['/tmp'],
            denyWritePaths: ['.env'],
            networkMode: 'allowed',
            allowedDomains: [],
            deniedDomains: [],
            allowLocalBinding: true,
        });
    });

    it('accepts a fully custom valid sandbox config', () => {
        const parsed = SandboxConfigSchema.parse({
            enabled: true,
            workspaceRoot: '~/projects',
            sessionIsolation: 'custom',
            customWritePaths: ['~/projects/foo', '/var/tmp'],
            denyReadPaths: ['~/.ssh'],
            extraWritePaths: ['/tmp', '/private/tmp'],
            denyWritePaths: ['.env', '.secrets'],
            networkMode: 'custom',
            allowedDomains: ['api.openai.com', '*.github.com'],
            deniedDomains: ['tracking.example.com'],
            allowLocalBinding: false,
        });

        expect(parsed.enabled).toBe(true);
        expect(parsed.workspaceRoot).toBe('~/projects');
        expect(parsed.sessionIsolation).toBe('custom');
        expect(parsed.networkMode).toBe('custom');
        expect(parsed.allowedDomains).toEqual(['api.openai.com', '*.github.com']);
        expect(parsed.allowLocalBinding).toBe(false);
    });

    it('rejects invalid enum values', () => {
        expect(() =>
            SandboxConfigSchema.parse({
                sessionIsolation: 'invalid',
            }),
        ).toThrow();

        expect(() =>
            SandboxConfigSchema.parse({
                networkMode: 'invalid',
            }),
        ).toThrow();
    });

    it('rejects invalid field types', () => {
        expect(() =>
            SandboxConfigSchema.parse({
                allowLocalBinding: 'yes',
            }),
        ).toThrow();

        expect(() =>
            SandboxConfigSchema.parse({
                denyReadPaths: [123],
            }),
        ).toThrow();
    });
});

describe('acquireDaemonLock', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = mkdtempSync(join(tmpdir(), 'happyherd-daemon-lock-'));
        mockConfiguration.daemonLockFile = join(testDir, 'daemon.state.json.lock');
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it.each([
        ['empty', ''],
        ['non-numeric', 'not-a-pid'],
        ['zero-pid', '0'],
    ])('treats a %s lock file as stale and acquires a fresh lock', async (_label, lockContent) => {
        writeFileSync(mockConfiguration.daemonLockFile, lockContent, 'utf-8');

        // Lock creation is atomic including the PID payload (temp file +
        // hard link), so a payload-less lock can never belong to a live
        // acquirer and is reclaimed on first sight.
        const lockHandle = await acquireDaemonLock(2, 0);

        expect(lockHandle).not.toBeNull();
        expect(readFileSync(mockConfiguration.daemonLockFile, 'utf-8')).toBe(String(process.pid));
        await releaseDaemonLock(lockHandle!);
        expect(existsSync(mockConfiguration.daemonLockFile)).toBe(false);
    });

    it('creates the lock with its PID payload atomically (no temp file left behind)', async () => {
        const lockHandle = await acquireDaemonLock(1, 0);

        expect(lockHandle).not.toBeNull();
        expect(readFileSync(mockConfiguration.daemonLockFile, 'utf-8')).toBe(String(process.pid));
        expect(existsSync(`${mockConfiguration.daemonLockFile}.${process.pid}.tmp`)).toBe(false);
        await releaseDaemonLock(lockHandle!);
    });

    it('does not clear a lock held by a live process', async () => {
        writeFileSync(mockConfiguration.daemonLockFile, String(process.pid), 'utf-8');

        const lockHandle = await acquireDaemonLock(1, 0);

        expect(lockHandle).toBeNull();
        expect(readFileSync(mockConfiguration.daemonLockFile, 'utf-8')).toBe(String(process.pid));
    });
});

describe('daemon state and lock ownership', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = mkdtempSync(join(tmpdir(), 'happyherd-daemon-files-'));
        mockConfiguration.daemonStateFile = join(testDir, 'daemon.state.json');
        mockConfiguration.daemonLockFile = join(testDir, 'daemon.state.json.lock');
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    function writeDaemonFiles(pid: number, instanceId: string): void {
        writeFileSync(mockConfiguration.daemonStateFile, JSON.stringify({
            pid, httpPort: 39001, startTime: 'start', startedWithCliVersion: '1.0.0', instanceId,
        }));
        writeFileSync(mockConfiguration.daemonLockFile, String(pid));
    }

    it.each([
        ['its own files', 4321, 'stopping', false],
        ['a later daemon\'s files', 5555, 'later', true],
        ['a state file from another run of its PID', 4321, 'other-run', true],
    ])('lets a stopping daemon clear only its own files: %s', async (_label, pid, instanceId, kept) => {
        writeDaemonFiles(pid, instanceId);

        await clearDaemonState({ pid: 4321, instanceId: 'stopping' });

        expect(existsSync(mockConfiguration.daemonStateFile)).toBe(kept);
        expect(existsSync(mockConfiguration.daemonLockFile)).toBe(pid !== 4321);
    });

    it('still clears a stale daemon\'s files when no owner is given', async () => {
        writeDaemonFiles(5555, 'stale');

        await clearDaemonState();

        expect(existsSync(mockConfiguration.daemonStateFile)).toBe(false);
        expect(existsSync(mockConfiguration.daemonLockFile)).toBe(false);
    });

    it('releases the lock file only while it is still the releasing process\'s lock', async () => {
        const lockHandle = await acquireDaemonLock(1, 0);
        expect(lockHandle).not.toBeNull();
        // Another daemon took the lock after this one's lock file was deleted.
        rmSync(mockConfiguration.daemonLockFile);
        writeFileSync(mockConfiguration.daemonLockFile, '5555');

        await releaseDaemonLock(lockHandle!);

        expect(readFileSync(mockConfiguration.daemonLockFile, 'utf-8')).toBe('5555');
    });
});

describe('session persistence', () => {
    let testDir: string;

    const sessionRecord = (savedAt: number, threadId: string): PersistedSession => ({
        encryptionKey: 'AQIDBA==',
        encryptionVariant: 'dataKey',
        seq: 12,
        metadataVersion: 3,
        agentStateVersion: 4,
        metadata: {
            path: '/tmp/repo',
            flavor: 'codex',
            codexThreadId: threadId,
            host: 'localhost',
            homeDir: '/tmp',
            happyHomeDir: '/tmp/.happyherd',
            happyLibDir: '/tmp/happyherd',
            happyToolsDir: '/tmp/happyherd/tools',
        },
        savedAt,
    });

    beforeEach(() => {
        testDir = mkdtempSync(join(tmpdir(), 'happyherd-persisted-sessions-'));
        mockConfiguration.sessionsFile = join(testDir, 'sessions.json');
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('distinguishes a missing session file from a failed read when requested', () => {
        expect(readPersistedSessions({ throwOnError: true })).toEqual({});
        writeFileSync(mockConfiguration.sessionsFile, '{');
        expect(() => readPersistedSessions({ throwOnError: true })).toThrow();
        expect(readPersistedSessions()).toEqual({});
    });

    it('reloads recent and older-than-14-day sessions after an update rewrite', () => {
        const recent = sessionRecord(Date.now(), 'thread-recent');
        const historical = sessionRecord(Date.now() - 45 * 24 * 60 * 60 * 1000, 'thread-historical');
        writeFileSync(mockConfiguration.sessionsFile, JSON.stringify({
            sessions: { recent, historical },
        }), 'utf-8');

        const registeredAfterUpdate = sessionRecord(Date.now(), 'thread-new');
        persistSession('registered-after-update', registeredAfterUpdate);

        expect(readPersistedSessions()).toEqual({
            recent,
            historical,
            'registered-after-update': registeredAfterUpdate,
        });
    });

    it('keeps pending registrations visible and lets a later direct save win', async () => {
        const first = sessionRecord(200, 'first');
        const second = sessionRecord(200, 'second');
        const authoritative = sessionRecord(201, 'authoritative');
        const saves = [persistSessionRegistration('one', first, 100), persistSessionRegistration('two', second, 100)];
        expect(readPersistedSessions()).toEqual({ one: first, two: second });
        expect(persistSession('one', authoritative)).toBe(true);
        await Promise.all(saves);
        expect(JSON.parse(readFileSync(mockConfiguration.sessionsFile, 'utf-8')).sessions)
            .toEqual({ one: authoritative, two: second });
        // A cancelled batch timer must not later replace the authoritative save.
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(readPersistedSessions()).toEqual({ one: authoritative, two: second });
    });

    it('merges another writer before flushing and notices its later changes', async () => {
        const first = sessionRecord(200, 'first');
        const second = sessionRecord(200, 'second');
        const save = persistSessionRegistration('one', first, 100);
        writeFileSync(mockConfiguration.sessionsFile, JSON.stringify({ sessions: { two: second } }));
        await save;
        expect(readPersistedSessions()).toEqual({ one: first, two: second });
        writeFileSync(mockConfiguration.sessionsFile, JSON.stringify({ sessions: { one: second, two: second } }));
        await persistSessionRegistration('one', first, 100);
        expect(readPersistedSessions()).toEqual({ one: first, two: second });
    });

    it('dates an identical pre-boot record again without changing current-boot conflict decisions', async () => {
        const old = sessionRecord(90, 'same');
        persistSession('one', old);
        await persistSessionRegistration('one', { ...old, savedAt: 110 }, 100);
        expect(readPersistedSessions().one.savedAt).toBe(110);
        const reordered = { ...old, savedAt: 120, metadata: Object.fromEntries(Object.entries(old.metadata).reverse()) as typeof old.metadata };
        await persistSessionRegistration('one', reordered, 100);
        expect(readPersistedSessions().one.savedAt).toBe(110);
    });

    it('rejects failed saves and lets an identical repeat save the record', async () => {
        const record = sessionRecord(200, 'retry');
        // A directory at the temporary-file path makes the real write fail.
        const temporaryPath = mockConfiguration.sessionsFile + '.tmp';
        mkdirSync(temporaryPath);
        await expect(persistSessionRegistration('one', record, 100)).rejects.toThrow('Failed to persist');
        expect(readPersistedSessions()).toEqual({});
        rmSync(temporaryPath, { recursive: true });
        await persistSessionRegistration('one', record, 100);
        expect(readPersistedSessions()).toEqual({ one: record });
    });
});
