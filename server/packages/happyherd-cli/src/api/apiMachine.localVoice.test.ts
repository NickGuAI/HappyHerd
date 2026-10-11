import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuration } from '@/configuration';
import {
    LocalVoiceStatusSchema,
    VOICE_RPC_METHODS,
} from '@happyherd/wire';
import { ApiMachineClient } from './apiMachine';
import type { Machine } from './types';
import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';
import type { RpcHandlerManager } from './rpc/RpcHandlerManager';

describe.each(['legacy', 'dataKey'] as const)('local voice RPC over %s machine encryption', (encryptionVariant) => {
    it('registers the bounded local voice API on the existing machine RPC scope', async () => {
        const happyHomeDir = await mkdtemp(join(tmpdir(), 'happyherd-local-voice-rpc-'));
        const originalHappyHerdHomeDir = configuration.happyHomeDir;
        Object.defineProperty(configuration, 'happyHomeDir', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: happyHomeDir,
        });
        const machine: Machine = {
            id: 'voice-machine',
            metadata: { host: 'linux-host', platform: 'linux', happyCliVersion: 'test', homeDir: '/tmp', happyHomeDir, happyLibDir: join(happyHomeDir, 'lib') },
            metadataVersion: 0,
            daemonState: null,
            daemonStateVersion: 0,
            encryptionKey: new Uint8Array(32).fill(7),
            encryptionVariant,
        };
        let client: ApiMachineClient | undefined;
        try {
            client = new ApiMachineClient('fixture-token', machine);
            const manager = (client as unknown as { rpcHandlerManager: RpcHandlerManager }).rpcHandlerManager;
            const registered = [
                VOICE_RPC_METHODS.status,
                VOICE_RPC_METHODS.install,
                VOICE_RPC_METHODS.uploadStart,
                VOICE_RPC_METHODS.uploadChunk,
                VOICE_RPC_METHODS.transcribe,
                VOICE_RPC_METHODS.speak,
                VOICE_RPC_METHODS.operation,
                VOICE_RPC_METHODS.read,
                VOICE_RPC_METHODS.cancel,
                VOICE_RPC_METHODS.release,
            ];
            for (const method of registered) expect(manager.hasHandler(method), method).toBe(true);
            const response = await manager.handleRequest({
                method: `${machine.id}:${VOICE_RPC_METHODS.status}`,
                params: encodeBase64(encrypt(machine.encryptionKey, encryptionVariant, {})),
            });
            const status = LocalVoiceStatusSchema.parse(decrypt(machine.encryptionKey, encryptionVariant, decodeBase64(response)));
            expect(status).toMatchObject({ stt: { state: 'unsupported' }, tts: { state: 'not-installed' } });
            const service = (client as unknown as { localVoiceService: { root: string } }).localVoiceService;
            expect(service.root).toBe(join(happyHomeDir, 'local-voice'));
            await expect(stat(join(happyHomeDir, 'local-voice', 'operations'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            const shutdown = client?.shutdown();
            Object.defineProperty(configuration, 'happyHomeDir', {
                configurable: true,
                enumerable: true,
                writable: true,
                value: originalHappyHerdHomeDir,
            });
            await Promise.all([shutdown, rm(happyHomeDir, { recursive: true, force: true })]);
        }
    });
});
