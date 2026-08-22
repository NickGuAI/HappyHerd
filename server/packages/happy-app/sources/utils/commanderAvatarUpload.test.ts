import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
    MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES,
    MAX_WORKSPACE_UPLOAD_BYTES,
    type HappyHerdCommanderSummary,
} from '@slopus/happy-wire';

vi.mock('expo-image', () => ({
    Image: { loadAsync: vi.fn() },
}));
vi.mock('@/hooks/useCommanderAvatar', () => ({ invalidateCommanderAvatarCache: vi.fn() }));
vi.mock('@/sync/ops', () => ({ machineHashFile: vi.fn(), machineUploadFile: vi.fn() }));

import {
    CommanderAvatarUploadError,
    commanderAvatarDirectory,
    commanderAvatarPath,
    uploadCommanderAvatar,
} from './commanderAvatarUpload';

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

function commander(machine = 'one'): HappyHerdCommanderSummary {
    return {
        id: 'athena',
        name: 'Athena',
        workspace: '/srv/workspace',
        commanderPath: `/home/me/.happyherd/commanders/${machine}/COMMANDER.md`,
        agentContextPath: `/home/me/.happyherd/commanders/${machine}/agentcontext`,
    };
}

function successfulUpload() {
    return {
        success: true as const,
        path: '/home/me/.happyherd/commanders/one/avatar.png',
        size: png.byteLength,
        hash: createHash('sha256').update(png).digest('hex'),
    };
}

describe('Commander avatar upload', () => {
    it('derives the canonical Commander directory on POSIX and Windows hosts', () => {
        expect(commanderAvatarDirectory(commander())).toBe('/home/me/.happyherd/commanders/one');
        expect(commanderAvatarDirectory({
            ...commander(),
            commanderPath: 'C:\\Users\\me\\.happyherd\\commanders\\athena\\COMMANDER.md',
        })).toBe('C:\\Users\\me\\.happyherd\\commanders\\athena');
        expect(commanderAvatarPath(commander())).toBe('/home/me/.happyherd/commanders/one/avatar.png');
        expect(commanderAvatarPath({
            ...commander(),
            commanderPath: 'C:\\Users\\me\\.happyherd\\commanders\\athena\\COMMANDER.md',
        })).toBe('C:\\Users\\me\\.happyherd\\commanders\\athena\\avatar.png');
    });

    it('decodes, preflights, and creates or optimistically replaces canonical avatar.png', async () => {
        const hashFile = vi.fn()
            .mockResolvedValueOnce({ success: true, exists: false })
            .mockResolvedValueOnce({ success: true, exists: true, size: 20, hash: 'b'.repeat(64) });
        const decodeImage = vi.fn(async () => undefined);
        const uploadFile = vi.fn(async (_machineId: string, _request: unknown) => successfulUpload());
        const invalidate = vi.fn();

        const created = await uploadCommanderAvatar('machine-one', commander(), png, {
            hashFile,
            decodeImage,
            uploadFile,
            invalidate,
        });
        expect(decodeImage).toHaveBeenCalledWith(png, 'image/png');
        expect(hashFile).toHaveBeenCalledWith(
            'machine-one',
            '/home/me/.happyherd/commanders/one/avatar.png',
            MAX_WORKSPACE_UPLOAD_BYTES,
        );
        expect(uploadFile).toHaveBeenLastCalledWith('machine-one', expect.objectContaining({
            directory: '/home/me/.happyherd/commanders/one',
            fileName: 'avatar.png',
            content: png.toString('base64'),
        }));
        expect(uploadFile.mock.calls[0][1]).not.toHaveProperty('expectedHash');
        expect(created.avatar?.mimeType).toBe('image/png');
        expect(invalidate).toHaveBeenCalledWith('machine-one', 'athena');

        const expectedHash = 'b'.repeat(64);
        await uploadCommanderAvatar('machine-one', {
            ...commander(),
            avatar: {
                path: '/home/me/.happyherd/commanders/one/avatar.png',
                mimeType: 'image/png',
                byteLength: 20,
                sha256: expectedHash,
            },
        }, png, { hashFile, decodeImage, uploadFile, invalidate });
        expect(uploadFile).toHaveBeenLastCalledWith('machine-one', expect.objectContaining({ expectedHash }));
    });

    it('repairs an invalid regular avatar without transferring its bytes to the app', async () => {
        const currentHash = 'c'.repeat(64);
        const hashFile = vi.fn(async () => ({
            success: true as const,
            exists: true as const,
            size: 8192,
            hash: currentHash,
        }));
        const decodeImage = vi.fn(async () => undefined);
        const uploadFile = vi.fn(async (_machineId: string, _request: unknown) => successfulUpload());
        const invalidate = vi.fn();

        await uploadCommanderAvatar('machine-one', commander(), png, {
            hashFile,
            decodeImage,
            uploadFile,
            invalidate,
        });

        expect(hashFile).toHaveBeenCalledTimes(1);
        expect(await hashFile.mock.results[0].value).not.toHaveProperty('content');
        expect(uploadFile).toHaveBeenCalledWith('machine-one', expect.objectContaining({
            expectedHash: currentHash,
        }));
    });

    it('rejects empty, oversized, malformed, and undecodable content before touching the machine', async () => {
        const hashFile = vi.fn();
        const decodeImage = vi.fn(async () => undefined);
        const uploadFile = vi.fn();
        const invalidate = vi.fn();
        for (const [content, code] of [
            [Buffer.alloc(0), 'empty'],
            [Buffer.alloc(MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES + 1), 'too-large'],
            [Buffer.from('not an image'), 'invalid-format'],
        ] as const) {
            await expect(uploadCommanderAvatar('machine-one', commander(), content, {
                hashFile,
                decodeImage,
                uploadFile,
                invalidate,
            })).rejects.toMatchObject({ code } satisfies Partial<CommanderAvatarUploadError>);
        }
        decodeImage.mockRejectedValueOnce(new Error('decoder rejected pixels'));
        await expect(uploadCommanderAvatar('machine-one', commander(), png, {
            hashFile,
            decodeImage,
            uploadFile,
            invalidate,
        })).rejects.toMatchObject({ code: 'invalid-format' });
        expect(hashFile).not.toHaveBeenCalled();
        expect(uploadFile).not.toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('fails safely before upload on an older daemon or a non-regular canonical target', async () => {
        const decodeImage = vi.fn(async () => undefined);
        const uploadFile = vi.fn();
        const invalidate = vi.fn();

        await expect(uploadCommanderAvatar('machine-one', commander(), png, {
            hashFile: vi.fn(async () => ({ success: false as const, code: 'unavailable' as const })),
            decodeImage,
            uploadFile,
            invalidate,
        })).rejects.toMatchObject({ code: 'runtime-unsupported' });
        await expect(uploadCommanderAvatar('machine-one', commander(), png, {
            hashFile: vi.fn(async () => ({ success: false as const, code: 'not-regular' as const })),
            decodeImage,
            uploadFile,
            invalidate,
        })).rejects.toMatchObject({ code: 'invalid-target' });

        expect(uploadFile).not.toHaveBeenCalled();
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('preserves the cache and reports stale state when the descriptor or upload loses its race', async () => {
        const expectedHash = 'b'.repeat(64);
        const decodeImage = vi.fn(async () => undefined);
        const uploadFile = vi.fn(async (_machineId: string, _request: unknown) => ({
            success: false,
            code: 'conflict' as const,
            error: 'stale',
        }));
        const invalidate = vi.fn();
        const describedCommander: HappyHerdCommanderSummary = {
            ...commander(),
            avatar: {
                path: '/home/me/.happyherd/commanders/one/avatar.png',
                mimeType: 'image/png',
                byteLength: png.byteLength,
                sha256: expectedHash,
            },
        };

        await expect(uploadCommanderAvatar('machine-one', describedCommander, png, {
            hashFile: vi.fn(async () => ({
                success: true as const,
                exists: true as const,
                size: png.byteLength,
                hash: 'd'.repeat(64),
            })),
            decodeImage,
            uploadFile,
            invalidate,
        })).rejects.toMatchObject({ code: 'stale' });
        expect(uploadFile).not.toHaveBeenCalled();

        await expect(uploadCommanderAvatar('machine-one', describedCommander, png, {
            hashFile: vi.fn(async () => ({
                success: true as const,
                exists: true as const,
                size: png.byteLength,
                hash: expectedHash,
            })),
            decodeImage,
            uploadFile,
            invalidate,
        })).rejects.toMatchObject({ code: 'stale' });
        expect(invalidate).not.toHaveBeenCalled();
    });
});
