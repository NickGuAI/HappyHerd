import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HappyHerdCommanderListResponse } from '@slopus/happy-wire';

vi.mock('@/sync/ops', () => ({
    machineListCommanders: vi.fn(),
    machineReadFile: vi.fn(),
}));
vi.mock('expo-crypto', () => ({
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: vi.fn(),
}));

import { loadCommanderAvatar, resetCommanderAvatarCacheForTests } from './useCommanderAvatar';

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);
const sha256 = async (content: Uint8Array) => createHash('sha256').update(content).digest('hex');

function response(machineId: string, content = png): HappyHerdCommanderListResponse {
    return {
        commanders: [{
            id: 'athena',
            name: 'Athena',
            workspace: '/srv/workspace',
            commanderPath: `/commanders/${machineId}/COMMANDER.md`,
            agentContextPath: `/commanders/${machineId}/agentcontext`,
            avatar: {
                path: `/commanders/${machineId}/avatar.png`,
                mimeType: 'image/png',
                byteLength: content.byteLength,
                sha256: createHash('sha256').update(content).digest('hex'),
            },
        }],
        globalAgentsPath: null,
    };
}

afterEach(() => resetCommanderAvatarCacheForTests());

describe('Commander avatar loading', () => {
    it('loads and caches a validated profile image by machine and Commander', async () => {
        const listCommanders = vi.fn(async (machineId: string) => response(machineId));
        const readFile = vi.fn(async () => ({ success: true, content: png.toString('base64') }));
        const dependencies = { listCommanders, readFile, sha256 };

        const first = await loadCommanderAvatar('machine-one', 'athena', dependencies);
        const second = await loadCommanderAvatar('machine-one', 'athena', dependencies);

        expect(first).toBe(`data:image/png;base64,${png.toString('base64')}`);
        expect(second).toBe(first);
        expect(listCommanders).toHaveBeenCalledOnce();
        expect(readFile).toHaveBeenCalledOnce();
        expect(readFile).toHaveBeenCalledWith('machine-one', '/commanders/machine-one/avatar.png');
    });

    it('never reuses one machine avatar for the same Commander id on another machine', async () => {
        const listCommanders = vi.fn(async (machineId: string) => response(machineId));
        const readFile = vi.fn(async (machineId: string) => ({
            success: true,
            content: Buffer.concat([png.subarray(0, 8), Buffer.from(machineId)]).toString('base64'),
        }));

        // Deliberately return bytes that differ from each descriptor length;
        // both must fail independently instead of cross-populating the cache.
        await expect(loadCommanderAvatar('one', 'athena', { listCommanders, readFile, sha256 })).resolves.toBeNull();
        await expect(loadCommanderAvatar('two', 'athena', { listCommanders, readFile, sha256 })).resolves.toBeNull();

        expect(listCommanders).toHaveBeenCalledTimes(2);
        expect(readFile).toHaveBeenCalledTimes(2);
        expect(readFile.mock.calls.map(([machineId]) => machineId)).toEqual(['one', 'two']);
    });

    it('rejects stale or malformed bytes and retries a transient read failure', async () => {
        const listCommanders = vi.fn(async (machineId: string) => response(machineId));
        const readFile = vi.fn()
            .mockResolvedValueOnce({ success: false, error: 'offline' })
            .mockResolvedValueOnce({ success: true, content: Buffer.from('not-png').toString('base64') })
            .mockResolvedValueOnce({ success: true, content: png.toString('base64') });
        const dependencies = { listCommanders, readFile, sha256 };

        await expect(loadCommanderAvatar('machine-one', 'athena', dependencies)).resolves.toBeNull();
        await expect(loadCommanderAvatar('machine-one', 'athena', dependencies)).resolves.toBeNull();
        await expect(loadCommanderAvatar('machine-one', 'athena', dependencies)).resolves.toContain('data:image/png');

        expect(listCommanders).toHaveBeenCalledTimes(2);
        expect(readFile).toHaveBeenCalledTimes(3);
    });

    it('returns the generated fallback for an offline list and retries the descriptor request', async () => {
        const listCommanders = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(response('machine-one'));
        const readFile = vi.fn(async () => ({ success: true, content: png.toString('base64') }));
        const dependencies = { listCommanders, readFile, sha256 };

        await expect(loadCommanderAvatar('machine-one', 'athena', dependencies)).resolves.toBeNull();
        await expect(loadCommanderAvatar('machine-one', 'athena', dependencies)).resolves.toContain('data:image/png');

        expect(listCommanders).toHaveBeenCalledTimes(2);
        expect(readFile).toHaveBeenCalledOnce();
    });

    it('invalidates a stale descriptor so a refreshed image can load', async () => {
        const updatedPng = Buffer.from(png);
        updatedPng[45] ^= 0x01;
        let descriptorContent = png;
        const listCommanders = vi.fn(async () => response('machine-one', descriptorContent));
        const readFile = vi.fn(async () => ({ success: true, content: updatedPng.toString('base64') }));
        const dependencies = { listCommanders, readFile, sha256 };

        await expect(loadCommanderAvatar('machine-one', 'athena', dependencies)).resolves.toBeNull();
        descriptorContent = updatedPng;
        await expect(loadCommanderAvatar('machine-one', 'athena', dependencies)).resolves.toContain('data:image/png');

        expect(listCommanders).toHaveBeenCalledTimes(2);
        expect(readFile).toHaveBeenCalledTimes(2);
    });

    it('rejects a signature-only image even when its descriptor matches', async () => {
        const signatureOnly = png.subarray(0, 8);
        const listCommanders = vi.fn(async () => response('machine-one', signatureOnly));
        const readFile = vi.fn(async () => ({ success: true, content: signatureOnly.toString('base64') }));

        await expect(loadCommanderAvatar('machine-one', 'athena', {
            listCommanders,
            readFile,
            sha256,
        })).resolves.toBeNull();
    });

    it('uses a generated-avatar fallback when identity or descriptor is absent', async () => {
        const listCommanders = vi.fn(async (): Promise<HappyHerdCommanderListResponse> => ({
            commanders: [],
            globalAgentsPath: null,
        }));
        const readFile = vi.fn();

        await expect(loadCommanderAvatar(null, 'athena', { listCommanders, readFile, sha256 })).resolves.toBeNull();
        await expect(loadCommanderAvatar('machine-one', null, { listCommanders, readFile, sha256 })).resolves.toBeNull();
        await expect(loadCommanderAvatar('machine-one', 'athena', { listCommanders, readFile, sha256 })).resolves.toBeNull();
        expect(readFile).not.toHaveBeenCalled();
    });
});
