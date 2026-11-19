import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import { commitCredentialLogin, markCredentialAccountLimited, removeCredentialAccount, serializeCredentialPoolState, upsertCredentialAccount } from '@/credentialPool/store';
import { claudeRemote } from './claudeRemote';
import { claudeRemoteLauncher } from './claudeRemoteLauncher';
import { closeClaudeTurnWithStatus, mapClaudeLogMessageToSessionEnvelopes, type ClaudeSessionProtocolState } from './utils/sessionProtocolMapper';
import { CLAUDE_LOGIN_EXPIRED_MESSAGE } from './utils/providerAuth';
import type { SessionEnvelope } from '@happyherd/wire';

// Exercise the real outgoing queue, SDK converter and protocol mapper without
// a terminal, credential store, provider process, relay or push service.
vi.mock('./claudeRemote', () => ({ claudeRemote: vi.fn(), ClaudeRequiredResumeError: class extends Error {} }));
vi.mock('ink', () => ({ render: vi.fn() }));
vi.mock('@/ui/ink/RemoteModeDisplay', () => ({ RemoteModeDisplay: vi.fn() }));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/ui/messageFormatterInk', () => ({ formatClaudeMessageForInk: vi.fn() }));
vi.mock('@/utils/terminalStdinCleanup', () => ({ cleanupStdinAfterInk: vi.fn() }));
vi.mock('@/daemon/controlClient', () => ({ notifyDaemonProviderLimited: vi.fn() }));
vi.mock('node:child_process', () => ({ execSync: () => 'fixture-branch' }));
vi.mock('./utils/permissionHandler', () => ({
    PermissionHandler: class {
        reset = vi.fn();
        clearPermissionModeUpdater = vi.fn();
        setOnPermissionRequest = vi.fn();
        getResponseLookup = () => new Map();
        handleToolCall = vi.fn();
        handleModeChange = vi.fn(async () => {});
    },
}));

function fixture() {
    const handlers = new Map<string, () => Promise<void>>();
    const state: ClaudeSessionProtocolState = { currentTurnId: null };
    const envelopes: SessionEnvelope[] = [];
    const session = {
        sessionId: 'fixture-session', path: '/fixture/project', hookSettingsPath: '/fixture/settings.json', hookSettingsPort: 43219,
        queue: { size: () => 0, completeCurrentBatch: vi.fn(), isClosed: () => false },
        consumeOneTimeFlags: vi.fn(),
        api: { push: () => ({ sendSessionNotification: notification }) },
        client: {
            sessionId: 'fixture-happyherd-session',
            rpcHandlerManager: { registerHandler: (name: string, handler: () => Promise<void>) => handlers.set(name, handler) },
            getMetadata: () => ({}),
            sendSessionEvent: vi.fn(),
            sendClaudeSessionMessageWithAgentImages: vi.fn(),
            sendClaudeSessionMessage: vi.fn((message) => {
                const mapped = mapClaudeLogMessageToSessionEnvelopes(message, state);
                state.currentTurnId = mapped.currentTurnId;
                envelopes.push(...mapped.envelopes);
            }),
            closeClaudeSessionTurn: vi.fn((status) => {
                const mapped = closeClaudeTurnWithStatus(state, status);
                state.currentTurnId = mapped.currentTurnId;
                envelopes.push(...mapped.envelopes);
            }),
        },
    };
    session.client.sendClaudeSessionMessageWithAgentImages = session.client.sendClaudeSessionMessage;
    const notification = vi.fn();
    const stop = () => { void handlers.get('switch')!(); };
    return { session, state, envelopes, notification, stop };
}

describe('claudeRemoteLauncher provider auth', () => {
    beforeEach(() => { vi.mocked(claudeRemote).mockReset(); });
    afterEach(() => { vi.unstubAllEnvs(); });

    it('refreshes a relogged bound account before handing off the next prompt', async () => {
        const root = await mkdtemp(join(tmpdir(), 'claude-refresh-'));
        const oldPool = configuration.credentialPoolFile;
        const oldAccounts = configuration.credentialPoolDir;
        const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
        Object.defineProperty(configuration, 'credentialPoolFile', { value: paths.stateFile, configurable: true });
        Object.defineProperty(configuration, 'credentialPoolDir', { value: paths.accountsDir, configurable: true });
        try {
            const original = await upsertCredentialAccount({ provider: 'claude', name: 'one', credential: { type: 'oauth-token', token: 'synthetic-old' } }, { paths, now: 1 });
            await commitCredentialLogin({ provider: 'claude', name: 'one', token: 'synthetic-new' }, { paths, now: 2, target: { type: 'existing', id: original.id, credentialVersion: original.credentialVersion } });
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_TYPE', 'claude');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'one');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', original.id);
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION', String(original.credentialVersion));
            vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'synthetic-old');
            const { session, stop } = fixture();
            const metadata = { providerAccount: 'one', providerAccountId: original.id, providerAccountCredentialVersion: original.credentialVersion };
            session.client.getMetadata = () => metadata;
            (session.client as any).updateMetadata = vi.fn(async (update: (value: typeof metadata) => typeof metadata) => Object.assign(metadata, update(metadata)));
            (session.queue as any).waitForMessagesAndGetAsString = vi.fn(async () => ({ message: 'next prompt', hash: 'mode', mode: { permissionMode: 'default' }, queueMessageIds: ['prompt'] }));
            const handed: unknown[] = [];
            const tokens: Array<string | undefined> = [];
            const nativeIds: Array<string | null | undefined> = [];
            const { spawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
            vi.mocked(claudeRemote).mockImplementation(async (opts) => {
                const next = await opts.nextMessage();
                const child = spawn(process.execPath, ['-e', `
                    let input = '';
                    process.stdin.on('data', (chunk) => { input += chunk; });
                    process.stdin.on('end', () => process.stdout.write(JSON.stringify({
                        message: JSON.parse(input), token: process.env.CLAUDE_CODE_OAUTH_TOKEN,
                        nativeId: process.env.FIXTURE_NATIVE_ID,
                    })));
                `], {
                    env: { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN, FIXTURE_NATIVE_ID: opts.sessionId ?? '' },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                let output = '';
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', (chunk: string) => { output += chunk; });
                const exited = new Promise<number | null>((resolve, reject) => {
                    child.once('error', reject);
                    child.once('exit', resolve);
                });
                child.stdin.end(JSON.stringify(next));
                expect(await exited).toBe(0);
                const observed = JSON.parse(output);
                handed.push(observed.message);
                tokens.push(observed.token);
                nativeIds.push(observed.nativeId);
                if (next) stop();
            });
            await claudeRemoteLauncher(session as any);
            expect(handed).toHaveLength(2);
            expect(handed[0]).toBeNull();
            expect(handed[1]).toMatchObject({ message: 'next prompt', queueMessageIds: ['prompt'] });
            expect(tokens[1]).toBe('synthetic-new');
            expect(nativeIds).toEqual(['fixture-session', 'fixture-session']);
            expect(metadata).toMatchObject({ providerAccountId: original.id, providerAccountCredentialVersion: original.credentialVersion + 1 });
        } finally {
            Object.defineProperty(configuration, 'credentialPoolFile', { value: oldPool, configurable: true });
            Object.defineProperty(configuration, 'credentialPoolDir', { value: oldAccounts, configurable: true });
            await rm(root, { recursive: true, force: true });
        }
    });

    it('lets the current turn finish before refreshing for the next prompt', async () => {
        const root = await mkdtemp(join(tmpdir(), 'claude-turn-refresh-'));
        const oldPool = configuration.credentialPoolFile;
        const oldAccounts = configuration.credentialPoolDir;
        const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
        Object.defineProperty(configuration, 'credentialPoolFile', { value: paths.stateFile, configurable: true });
        Object.defineProperty(configuration, 'credentialPoolDir', { value: paths.accountsDir, configurable: true });
        try {
            const account = await upsertCredentialAccount({ provider: 'claude', name: 'one', credential: { type: 'oauth-token', token: 'synthetic-old' } }, { paths, now: 1 });
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_TYPE', 'claude');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'one');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', account.id);
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION', String(account.credentialVersion));
            vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'synthetic-old');
            const { session, stop } = fixture();
            const metadata = { providerAccount: 'one', providerAccountId: account.id, providerAccountCredentialVersion: account.credentialVersion };
            session.client.getMetadata = () => metadata;
            (session.client as any).updateMetadata = vi.fn(async (update: (value: typeof metadata) => typeof metadata) => Object.assign(metadata, update(metadata)));
            const queue = vi.fn()
                .mockResolvedValueOnce({ message: 'first', hash: 'mode', mode: { permissionMode: 'default' }, queueMessageIds: ['first'] })
                .mockResolvedValueOnce({ message: 'second', hash: 'mode', mode: { permissionMode: 'default' }, queueMessageIds: ['second'] });
            (session.queue as any).waitForMessagesAndGetAsString = queue;
            let turnFinished = false;
            let calls = 0;
            let first: unknown;
            let boundary: unknown;
            let second: unknown;
            let aborted: boolean | undefined;
            let during: string | undefined;
            let after: string | undefined;
            vi.mocked(claudeRemote).mockImplementation(async (opts) => {
                calls++;
                if (calls === 1) {
                    first = await opts.nextMessage();
                    await commitCredentialLogin({ provider: 'claude', name: 'one', token: 'synthetic-new' }, { paths, now: 2, target: { type: 'existing', id: account.id, credentialVersion: account.credentialVersion } });
                    aborted = opts.signal?.aborted;
                    during = process.env.CLAUDE_CODE_OAUTH_TOKEN;
                    turnFinished = true;
                    boundary = await opts.nextMessage();
                    if (boundary) stop();
                } else {
                    second = await opts.nextMessage();
                    after = process.env.CLAUDE_CODE_OAUTH_TOKEN;
                    stop();
                }
            });
            await claudeRemoteLauncher(session as any);
            expect(calls).toBe(2);
            expect(turnFinished).toBe(true);
            expect(first).toMatchObject({ message: 'first' });
            expect(aborted).toBe(false);
            expect(during).toBe('synthetic-old');
            expect(boundary).toBeNull();
            expect(second).toMatchObject({ message: 'second' });
            expect(after).toBe('synthetic-new');
            expect(metadata.providerAccountCredentialVersion).toBe(account.credentialVersion + 1);
        } finally {
            Object.defineProperty(configuration, 'credentialPoolFile', { value: oldPool, configurable: true });
            Object.defineProperty(configuration, 'credentialPoolDir', { value: oldAccounts, configurable: true });
            await rm(root, { recursive: true, force: true });
        }
    });

    it.each(['unreadable', 'locked', 'in-process'] as const)('delivers with the current credential when the store is %s, then checks the next message', async (failure) => {
        const root = await mkdtemp(join(tmpdir(), 'claude-read-failure-'));
        const oldPool = configuration.credentialPoolFile;
        const oldAccounts = configuration.credentialPoolDir;
        const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
        let releaseLock: (() => void) | undefined;
        let heldLock: Promise<void> | undefined;
        Object.defineProperty(configuration, 'credentialPoolFile', { value: paths.stateFile, configurable: true });
        Object.defineProperty(configuration, 'credentialPoolDir', { value: paths.accountsDir, configurable: true });
        try {
            const account = await upsertCredentialAccount({ provider: 'claude', name: 'one', credential: { type: 'oauth-token', token: 'synthetic-old' } }, { paths, now: 1 });
            await commitCredentialLogin({ provider: 'claude', name: 'one', token: 'synthetic-new' }, { paths, now: 2, target: { type: 'existing', id: account.id, credentialVersion: account.credentialVersion } });
            if (failure === 'unreadable') {
                await writeFile(join(root, 'not-a-directory'), 'fixture');
                Object.defineProperty(configuration, 'credentialPoolFile', { value: join(root, 'not-a-directory', 'pool.json'), configurable: true });
            } else if (failure === 'locked') {
                await writeFile(`${paths.stateFile}.lock`, 'fixture');
            } else {
                let signalReady!: () => void;
                const ready = new Promise<void>((resolve) => { signalReady = resolve; });
                const release = new Promise<void>((resolve) => { releaseLock = resolve; });
                heldLock = serializeCredentialPoolState(paths, async () => { signalReady(); await release; });
                await ready;
            }
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_TYPE', 'claude');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'one');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', account.id);
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION', String(account.credentialVersion));
            vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'synthetic-old');
            const { session, stop } = fixture();
            const metadata = { providerAccount: 'one', providerAccountId: account.id, providerAccountCredentialVersion: account.credentialVersion };
            (session.client as any).updateMetadata = vi.fn(async (update: (value: typeof metadata) => typeof metadata) => Object.assign(metadata, update(metadata)));
            (session.queue as any).waitForMessagesAndGetAsString = vi.fn()
                .mockResolvedValueOnce({ message: 'first', hash: 'mode', mode: { permissionMode: 'default' }, queueMessageIds: ['first'] })
                .mockResolvedValueOnce({ message: 'second', hash: 'mode', mode: { permissionMode: 'default' }, queueMessageIds: ['second'] });
            const handed: unknown[] = [];
            const tokens: Array<string | undefined> = [];
            vi.mocked(claudeRemote).mockImplementation(async (opts) => {
                const started = Date.now();
                const message = await opts.nextMessage();
                if (handed.length === 0 && failure !== 'unreadable') expect(Date.now() - started).toBeLessThan(1500);
                handed.push(message);
                tokens.push(process.env.CLAUDE_CODE_OAUTH_TOKEN);
                if (handed.length === 1) {
                    Object.defineProperty(configuration, 'credentialPoolFile', { value: paths.stateFile, configurable: true });
                    if (failure === 'locked') await rm(`${paths.stateFile}.lock`);
                    if (failure === 'in-process') { releaseLock!(); await heldLock; }
                    handed.push(await opts.nextMessage());
                } else {
                    stop();
                }
            });
            await claudeRemoteLauncher(session as any);
            expect(handed[0]).toMatchObject({ message: 'first' });
            expect(tokens[0]).toBe('synthetic-old');
            expect(handed[1]).toBeNull();
            expect(handed[2]).toMatchObject({ message: 'second' });
            expect(tokens[1]).toBe('synthetic-new');
        } finally {
            releaseLock?.();
            await heldLock;
            Object.defineProperty(configuration, 'credentialPoolFile', { value: oldPool, configurable: true });
            Object.defineProperty(configuration, 'credentialPoolDir', { value: oldAccounts, configurable: true });
            await rm(root, { recursive: true, force: true });
        }
    });

    it('does not refresh a session bound to another account', async () => {
        const root = await mkdtemp(join(tmpdir(), 'claude-other-account-'));
        const oldPool = configuration.credentialPoolFile;
        const oldAccounts = configuration.credentialPoolDir;
        const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
        Object.defineProperty(configuration, 'credentialPoolFile', { value: paths.stateFile, configurable: true });
        Object.defineProperty(configuration, 'credentialPoolDir', { value: paths.accountsDir, configurable: true });
        try {
            const bound = await upsertCredentialAccount({ provider: 'claude', name: 'one', credential: { type: 'oauth-token', token: 'synthetic-one' } }, { paths, now: 1 });
            const other = await upsertCredentialAccount({ provider: 'claude', name: 'two', credential: { type: 'oauth-token', token: 'synthetic-two' } }, { paths, now: 2 });
            await commitCredentialLogin({ provider: 'claude', name: 'two', token: 'synthetic-new' }, { paths, now: 3, target: { type: 'existing', id: other.id, credentialVersion: other.credentialVersion } });
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_TYPE', 'claude');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'one');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', bound.id);
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION', String(bound.credentialVersion));
            vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'synthetic-one');
            const { session, stop } = fixture();
            (session.client as any).updateMetadata = vi.fn();
            (session.queue as any).waitForMessagesAndGetAsString = vi.fn(async () => ({ message: 'prompt', hash: 'mode', mode: { permissionMode: 'default' }, queueMessageIds: ['prompt'] }));
            let handed: unknown;
            let usedToken: string | undefined;
            vi.mocked(claudeRemote).mockImplementation(async (opts) => {
                handed = await opts.nextMessage();
                usedToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
                stop();
            });
            await claudeRemoteLauncher(session as any);
            expect(claudeRemote).toHaveBeenCalledOnce();
            expect(handed).toMatchObject({ message: 'prompt' });
            expect(usedToken).toBe('synthetic-one');
            expect((session.client as any).updateMetadata).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(configuration, 'credentialPoolFile', { value: oldPool, configurable: true });
            Object.defineProperty(configuration, 'credentialPoolDir', { value: oldAccounts, configurable: true });
            await rm(root, { recursive: true, force: true });
        }
    });

    it.each(['limited', 'missing'] as const)('leaves the bound credential alone when its account is %s', async (condition) => {
        const root = await mkdtemp(join(tmpdir(), 'claude-unavailable-account-'));
        const oldPool = configuration.credentialPoolFile;
        const oldAccounts = configuration.credentialPoolDir;
        const paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
        Object.defineProperty(configuration, 'credentialPoolFile', { value: paths.stateFile, configurable: true });
        Object.defineProperty(configuration, 'credentialPoolDir', { value: paths.accountsDir, configurable: true });
        try {
            const bound = await upsertCredentialAccount({ provider: 'claude', name: 'one', credential: { type: 'oauth-token', token: 'synthetic-old' } }, { paths, now: 1 });
            const newer = await commitCredentialLogin({ provider: 'claude', name: 'one', token: 'synthetic-new' }, { paths, now: 2, target: { type: 'existing', id: bound.id, credentialVersion: bound.credentialVersion } });
            if (condition === 'limited') await markCredentialAccountLimited('claude', 'one', Date.now() + 60_000, { paths });
            else await removeCredentialAccount('claude', 'one', paths, { id: newer.id, credentialVersion: newer.credentialVersion });
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_TYPE', 'claude');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT', 'one');
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_ID', bound.id);
            vi.stubEnv('HAPPYHERD_PROVIDER_ACCOUNT_CREDENTIAL_VERSION', String(bound.credentialVersion));
            vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'synthetic-old');
            const { session, stop } = fixture();
            (session.client as any).updateMetadata = vi.fn();
            (session.queue as any).waitForMessagesAndGetAsString = vi.fn(async () => ({ message: 'prompt', hash: 'mode', mode: { permissionMode: 'default' }, queueMessageIds: ['prompt'] }));
            let handed: unknown;
            vi.mocked(claudeRemote).mockImplementation(async (opts) => { handed = await opts.nextMessage(); stop(); });
            await claudeRemoteLauncher(session as any);
            expect(handed).toMatchObject({ message: 'prompt' });
            expect(claudeRemote).toHaveBeenCalledOnce();
            expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('synthetic-old');
            expect((session.client as any).updateMetadata).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(configuration, 'credentialPoolFile', { value: oldPool, configurable: true });
            Object.defineProperty(configuration, 'credentialPoolDir', { value: oldAccounts, configurable: true });
            await rm(root, { recursive: true, force: true });
        }
    });

    it('flushes back-to-back auth output before closing the failed wire turn, without a done push', async () => {
        const { session, state, envelopes, notification, stop } = fixture();
        let eventsAtReady: string[] = [];
        let turnAtReady: string | null | undefined;
        vi.mocked(claudeRemote).mockImplementation(async opts => {
            opts.onCompletionEvent?.(CLAUDE_LOGIN_EXPIRED_MESSAGE);
            opts.onMessage({
                type: 'assistant', error: 'authentication_failed', parent_tool_use_id: null,
                message: { role: 'assistant', content: [{ type: 'text', text: 'Provider login failed' }] },
            } as any);
            await opts.onReady('failed');
            // Verify before cleanup's final flush can hide incorrect ordering.
            eventsAtReady = envelopes.map(envelope => envelope.ev.t);
            turnAtReady = state.currentTurnId;
            stop();
        });
        await claudeRemoteLauncher(session as any);
        expect(eventsAtReady).toEqual(['turn-start', 'text', 'turn-end']);
        expect(envelopes.at(-1)?.ev).toEqual({ t: 'turn-end', status: 'failed' });
        expect(turnAtReady).toBeNull();
        expect(notification).not.toHaveBeenCalled();
        expect(session.client.sendSessionEvent).toHaveBeenCalledWith({ type: 'message', message: CLAUDE_LOGIN_EXPIRED_MESSAGE });
        expect(envelopes.filter(envelope => envelope.ev.t === 'turn-end')).toHaveLength(1);
    });

    it('shows untruncated host-login guidance for a thrown OAuth error and accepts a later invocation', async () => {
        const { session, notification, stop } = fixture();
        vi.mocked(claudeRemote)
            .mockRejectedValueOnce(new Error('Failed to authenticate: OAuth session expired and could not be refreshed\nhttps://fixture-secret@example.invalid'))
            .mockImplementationOnce(async () => { stop(); });
        await claudeRemoteLauncher(session as any);
        expect(session.client.closeClaudeSessionTurn).toHaveBeenCalledWith('failed');
        expect(session.client.sendSessionEvent).toHaveBeenCalledWith({ type: 'message', message: CLAUDE_LOGIN_EXPIRED_MESSAGE });
        expect(JSON.stringify(session.client.sendSessionEvent.mock.calls)).not.toContain('fixture-secret');
        expect(notification).not.toHaveBeenCalled();
        expect(claudeRemote).toHaveBeenCalledTimes(2);
    });

    it('closes an unclassified failed turn after flushing its output without sending a done notification', async () => {
        const { session, state, envelopes, notification, stop } = fixture();
        let eventsAtReady: string[] = [];
        vi.mocked(claudeRemote).mockImplementation(async opts => {
            opts.onMessage({
                type: 'assistant', error: 'unknown', parent_tool_use_id: null,
                message: { role: 'assistant', content: [{ type: 'text', text: 'Provider rejected the request' }] },
            } as any);
            await opts.onReady('failed');
            eventsAtReady = envelopes.map(envelope => envelope.ev.t);
            expect(state.currentTurnId).toBeNull();
            stop();
        });
        await claudeRemoteLauncher(session as any);
        expect(eventsAtReady).toEqual(['turn-start', 'text', 'turn-end']);
        expect(envelopes.at(-1)?.ev).toEqual({ t: 'turn-end', status: 'failed' });
        expect(envelopes.filter(envelope => envelope.ev.t === 'turn-end')).toHaveLength(1);
        expect(notification).not.toHaveBeenCalled();
        expect(session.client.sendSessionEvent).not.toHaveBeenCalled();
    });
});
