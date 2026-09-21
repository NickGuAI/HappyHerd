import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeBase64, encrypt, getRandomBytes } from '@/api/encryption';
import { RpcHandlerManager } from './RpcHandlerManager';

function request(key: Uint8Array, method: string, params: unknown) {
    return {
        method: `machine-private-id:${method}`,
        params: encodeBase64(encrypt(key, 'legacy', params)),
    };
}

describe('RpcHandlerManager automation profiling', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('records only the finite automation method, outcome, and daemon duration', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const key = getRandomBytes(32);
        const logger = vi.fn();
        const manager = new RpcHandlerManager({
            scopePrefix: 'machine-private-id',
            encryptionKey: key,
            encryptionVariant: 'legacy',
            logger,
        });
        manager.registerHandler('happyherd-automations-list', async () => {
            vi.setSystemTime(1_037);
            return { automations: [] };
        });

        await manager.handleRequest(request(
            key,
            'happyherd-automations-list',
            { privatePayload: 'do-not-log' },
        ));

        const profileLine = logger.mock.calls
            .map(([message]) => String(message))
            .find((message) => message.startsWith('[AUTOMATIONS_PROFILE]'));
        expect(profileLine).toBe(
            '[AUTOMATIONS_PROFILE] method=happyherd-automations-list outcome=success daemon_ms=37',
        );
        expect(profileLine).not.toContain('machine-private-id');
        expect(profileLine).not.toContain('do-not-log');
    });

    it('records handler failure but ignores unrelated RPC methods', async () => {
        const key = getRandomBytes(32);
        const logger = vi.fn();
        const manager = new RpcHandlerManager({
            scopePrefix: 'machine-private-id',
            encryptionKey: key,
            encryptionVariant: 'legacy',
            logger,
        });
        manager.registerHandler('happyherd-automations-create', async () => {
            throw new Error('failed');
        });
        manager.registerHandler('read-file', async () => ({ ok: true }));

        await manager.handleRequest(request(key, 'happyherd-automations-create', {}));
        await manager.handleRequest(request(key, 'read-file', {}));

        const profileLines = logger.mock.calls
            .map(([message]) => String(message))
            .filter((message) => message.startsWith('[AUTOMATIONS_PROFILE]'));
        expect(profileLines).toHaveLength(1);
        expect(profileLines[0]).toMatch(
            /^\[AUTOMATIONS_PROFILE\] method=happyherd-automations-create outcome=error daemon_ms=\d+$/,
        );
    });
});
