import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextWindowResponseSchema } from '@happyherd/wire';
import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';
import { getProjectPath } from '@/claude/utils/path';
import type { RpcHandlerManager } from './rpc/RpcHandlerManager';

const roots: string[] = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ApiMachineClient encrypted context-window RPC', () => {
    it('does not substitute CLI state for a native Rig machine and remains retryable', async () => {
        const { ApiMachineClient } = await import('./apiMachine');
        const encryptionKey = new Uint8Array(32).fill(11);
        const client = new ApiMachineClient('fixture-token', {
            id: 'fixture-cli-machine', encryptionKey, encryptionVariant: 'legacy',
            metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0,
        } as any);
        const spawnSession = vi.fn();
        client.setRPCHandlers({ spawnSession, stopSession: vi.fn(), requestShutdown: vi.fn() });
        const manager = (client as unknown as { rpcHandlerManager: RpcHandlerManager }).rpcHandlerManager;
        const params = encodeBase64(encrypt(encryptionKey, 'legacy', {
            provider: 'rig', directory: '/fixture/original-cwd', sessionId: 'remote-native-session',
            // These unrelated IDs must never cause a provider fallback.
            claudeSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', codexHome: '/fixture/unrelated-home',
        }));
        for (let attempt = 0; attempt < 2; attempt++) {
            const encrypted = await manager.handleRequest({ method: 'fixture-cli-machine:session-context-window', params });
            expect(ContextWindowResponseSchema.parse(decrypt(encryptionKey, 'legacy', decodeBase64(encrypted))))
                .toEqual({ type: 'error', reason: 'unsupported' });
        }
        expect(spawnSession).not.toHaveBeenCalled();
    });

    it.each(['claude', 'codex'] as const)('reads the native %s fixture through the existing scoped encrypted RPC', async (provider) => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-context-rpc-'));
        roots.push(root);
        vi.stubEnv('CLAUDE_CONFIG_DIR', root);
        const fixturePath = fileURLToPath(new URL(`../contextWindow/fixtures/${provider}-compacted.jsonl`, import.meta.url));
        const nativeTrace = await readFile(fixturePath, 'utf8');
        const directory = '/fixture/project';
        const providerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const traceDirectory = provider === 'claude' ? getProjectPath(directory) : join(root, 'sessions', '2026', '09', '29');
        await mkdir(traceDirectory, { recursive: true });
        const tracePath = join(traceDirectory, provider === 'claude' ? `${providerId}.jsonl` : `rollout-date-${providerId}.jsonl`);
        await writeFile(tracePath, nativeTrace);
        const { ApiMachineClient } = await import('./apiMachine');
        const encryptionKey = new Uint8Array(32).fill(7);
        const client = new ApiMachineClient('fixture-token', {
            id: 'fixture-machine', encryptionKey, encryptionVariant: 'legacy',
            metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0,
        } as any);
        const spawnSession = vi.fn();
        client.setRPCHandlers({ spawnSession, stopSession: vi.fn(), requestShutdown: vi.fn() });
        const manager = (client as unknown as { rpcHandlerManager: RpcHandlerManager }).rpcHandlerManager;
        const params = encodeBase64(encrypt(encryptionKey, 'legacy', {
            provider, directory, claudeSessionId: providerId, codexThreadId: providerId, codexHome: root,
        }));
        const encrypted = await manager.handleRequest({ method: 'fixture-machine:session-context-window', params });
        expect(encrypted).not.toContain('fixture assistant');
        const result = ContextWindowResponseSchema.parse(decrypt(encryptionKey, 'legacy', decodeBase64(encrypted)));
        expect(result.type).toBe('success');
        if (result.type === 'success') {
            expect(result.provider).toBe(provider);
            expect(result.entries.length).toBeGreaterThan(8);
        }
        const wrongScope = await manager.handleRequest({ method: 'another-machine:session-context-window', params });
        expect(decrypt(encryptionKey, 'legacy', decodeBase64(wrongScope))).toEqual({ error: 'Method not found' });
        expect(spawnSession).not.toHaveBeenCalled();
        expect(await readFile(tracePath, 'utf8')).toBe(nativeTrace);
    });
});
