import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { removeDirectory } = vi.hoisted(() => ({ removeDirectory: vi.fn() }));

vi.mock('fs/promises', async (importOriginal) => {
    const original = await importOriginal<typeof import('fs/promises')>();
    removeDirectory.mockImplementation(original.rm);
    return { ...original, rm: removeDirectory };
});

import { registerCommonHandlers } from './registerCommonHandlers';

describe('workspace file and directory deletion', () => {
    const cleanup: string[] = [];

    afterEach(async () => {
        const { rm } = await vi.importActual<typeof import('fs/promises')>('fs/promises');
        await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
        removeDirectory.mockReset();
        removeDirectory.mockImplementation(rm);
    });

    async function fixture() {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-workspace-delete-'));
        cleanup.push(root);
        return root;
    }

    function deleteHandler(workingDirectory: string | null) {
        const handlers = new Map<string, (params: any) => Promise<any>>();
        registerCommonHandlers({
            registerHandler: (name: string, handler: (params: any) => Promise<any>) => handlers.set(name, handler),
        } as any, workingDirectory);
        return handlers.get('deleteFile')!;
    }

    it.each([undefined, false, true])('retains regular-file deletion with recursive=%s', async (recursive) => {
        const root = await fixture();
        const file = join(root, 'note.txt');
        await writeFile(file, 'remove');

        expect(await deleteHandler(root)({ path: file, recursive })).toEqual({ success: true });
        await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(removeDirectory).not.toHaveBeenCalled();
    });

    it.each([undefined, false, 'true'])('retains directory contents without explicit recursive true (%s)', async (recursive) => {
        const root = await fixture();
        const folder = join(root, 'keep');
        await mkdir(folder);
        await writeFile(join(folder, 'note.txt'), 'keep');

        expect(await deleteHandler(root)({ path: folder, recursive })).toEqual({
            success: false, error: 'Path is not a file',
        });
        expect(await readFile(join(folder, 'note.txt'), 'utf8')).toBe('keep');
        expect(removeDirectory).not.toHaveBeenCalled();
    });

    it.each([false, true])('deletes an explicitly selected directory, populated=%s', async (populated) => {
        const root = await fixture();
        const folder = join(root, 'remove');
        await mkdir(folder);
        if (populated) {
            await mkdir(join(folder, 'nested'));
            await writeFile(join(folder, 'nested', 'note.txt'), 'remove');
        }
        await writeFile(join(root, 'keep.txt'), 'keep');

        expect(await deleteHandler(root)({ path: 'remove', recursive: true })).toEqual({ success: true });
        expect(removeDirectory).toHaveBeenCalledWith(folder, { recursive: true, force: false });
        await expect(lstat(folder)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('keep');
    });

    it.each(['file', 'directory'])('preserves direct %s symlink rejection even with recursive true', async (kind) => {
        const root = await fixture();
        const target = join(root, 'target');
        if (kind === 'directory') await mkdir(target);
        else await writeFile(target, 'keep');
        const link = join(root, 'link');
        await symlink(target, link, kind === 'directory' ? 'dir' : 'file');

        expect(await deleteHandler(root)({ path: link, recursive: true })).toEqual({
            success: false, error: 'Path is not a file',
        });
        expect((await lstat(link)).isSymbolicLink()).toBe(true);
        expect(await lstat(target)).toBeDefined();
        expect(removeDirectory).not.toHaveBeenCalled();
    });

    it('removes nested links without deleting their external targets', async () => {
        const root = await fixture();
        const folder = join(root, 'remove');
        const outside = join(root, 'outside');
        await mkdir(folder);
        await mkdir(outside);
        await writeFile(join(outside, 'keep.txt'), 'keep');
        await symlink(outside, join(folder, 'linked-folder'), 'dir');
        await symlink(join(outside, 'keep.txt'), join(folder, 'linked-file'), 'file');

        expect(await deleteHandler(root)({ path: folder, recursive: true })).toEqual({ success: true });
        await expect(lstat(folder)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    });

    it('retains native errors for a missing target', async () => {
        const root = await fixture();
        const path = join(root, 'missing');

        const response = await deleteHandler(root)({ path, recursive: true });

        expect(response.success).toBe(false);
        expect(response.error).toContain('ENOENT');
        expect(response.error).toContain(path);
        expect(removeDirectory).not.toHaveBeenCalled();
    });

    it('returns a recursive filesystem error without claiming success', async () => {
        const root = await fixture();
        const folder = join(root, 'keep');
        await mkdir(folder);
        removeDirectory.mockRejectedValueOnce(new Error('EACCES: permission denied'));

        expect(await deleteHandler(root)({ path: folder, recursive: true })).toEqual({
            success: false, error: 'EACCES: permission denied',
        });
        expect((await lstat(folder)).isDirectory()).toBe(true);
    });

    it('preserves session scope while allowing the same absolute target through machine RPC', async () => {
        const root = await fixture();
        const sessionRoot = join(root, 'session');
        const outside = join(root, 'outside');
        await mkdir(sessionRoot);
        await mkdir(outside);
        await writeFile(join(outside, 'note.txt'), 'remove');

        expect(await deleteHandler(sessionRoot)({ path: '../outside', recursive: true })).toEqual({
            success: false,
            error: "Access denied: Path '../outside' is outside the working directory",
        });
        expect(await readFile(join(outside, 'note.txt'), 'utf8')).toBe('remove');
        expect(removeDirectory).not.toHaveBeenCalled();

        expect(await deleteHandler(null)({ path: outside, recursive: true })).toEqual({ success: true });
        await expect(lstat(outside)).rejects.toMatchObject({ code: 'ENOENT' });
        expect((await lstat(sessionRoot)).isDirectory()).toBe(true);
    });
});
