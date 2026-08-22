import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_WORKSPACE_UPLOAD_BYTES } from '@slopus/happy-wire';
import { registerCommonHandlers } from './registerCommonHandlers';

describe('machine workspace upload', () => {
    const cleanup: string[] = [];

    afterEach(async () => {
        await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    });

    function machineHandlers() {
        const handlers = new Map<string, (params: any) => Promise<any>>();
        registerCommonHandlers({
            registerHandler: (name: string, handler: (params: any) => Promise<any>) => handlers.set(name, handler),
        } as any, null);
        return handlers;
    }

    async function uploadFile(
        handlers: Map<string, (params: any) => Promise<any>>,
        request: { directory: string; fileName: string; content: Buffer; expectedHash?: string },
        chunkBytes = 96 * 1024,
    ) {
        const started = await handlers.get('uploadFileStart')!({
            directory: request.directory,
            fileName: request.fileName,
            size: request.content.byteLength,
            ...(request.expectedHash ? { expectedHash: request.expectedHash } : {}),
        });
        if (!started.success) return started;

        let offset = 0;
        for (let index = 0; index < request.content.byteLength; index += chunkBytes) {
            const content = request.content.subarray(index, index + chunkBytes).toString('base64');
            const chunk = await handlers.get('uploadFileChunk')!({ uploadId: started.uploadId, offset, content });
            if (!chunk.success) return chunk;
            offset = chunk.received;
        }
        return handlers.get('uploadFileFinish')!({ uploadId: started.uploadId });
    }

    it('publishes byte-exact content without overwriting another file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-'));
        cleanup.push(root);
        const content = Buffer.from([0, 1, 2, 3, 255]);
        const handlers = machineHandlers();

        const created = await uploadFile(handlers, {
            directory: root,
            fileName: 'asset.bin',
            content,
        });
        expect(created).toMatchObject({ success: true, path: join(root, 'asset.bin'), size: content.length });
        expect(await readFile(join(root, 'asset.bin'))).toEqual(content);

        const conflict = await uploadFile(handlers, {
            directory: root,
            fileName: 'asset.bin',
            content: Buffer.from('replacement'),
        });
        expect(conflict).toMatchObject({ success: false, code: 'conflict' });
        expect(await readFile(join(root, 'asset.bin'))).toEqual(content);
    });

    it('rejects path-bearing names, oversized files, and non-directory destinations', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-'));
        cleanup.push(root);
        const filePath = join(root, 'not-a-directory');
        await writeFile(filePath, 'x');
        const handler = machineHandlers().get('uploadFileStart')!;

        await expect(handler({ directory: root, fileName: '../escape', size: 0 }))
            .resolves.toMatchObject({ success: false, code: 'invalid-name' });
        await expect(handler({
            directory: root,
            fileName: 'huge.bin',
            size: MAX_WORKSPACE_UPLOAD_BYTES + 1,
        })).resolves.toMatchObject({ success: false, code: 'too-large' });
        await expect(handler({ directory: filePath, fileName: 'child.txt', size: 0 }))
            .resolves.toMatchObject({ success: false, code: 'not-directory' });
    });

    it('leaves no temporary file after a destination conflict', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-'));
        cleanup.push(root);
        await mkdir(join(root, 'folder'));
        await writeFile(join(root, 'folder', 'same.txt'), 'existing');
        const handlers = machineHandlers();
        await uploadFile(handlers, { directory: join(root, 'folder'), fileName: 'same.txt', content: Buffer.from('new') });
        expect((await readdir(join(root, 'folder'))).filter((name) => name.includes('happyherd-upload'))).toEqual([]);
    });

    it('returns only bounded regular-file identity and never follows a symbolic link', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-hash-file-'));
        cleanup.push(root);
        const content = Buffer.from('avatar bytes');
        const target = join(root, 'avatar.png');
        const linkPath = join(root, 'linked-avatar.png');
        await writeFile(target, content);
        await symlink(target, linkPath);
        const hashFile = machineHandlers().get('hashFile')!;

        const response = await hashFile({ path: target, maxBytes: content.byteLength });
        expect(response).toEqual({
            success: true,
            exists: true,
            size: content.byteLength,
            hash: createHash('sha256').update(content).digest('hex'),
        });
        expect(response).not.toHaveProperty('content');
        await expect(hashFile({ path: join(root, 'missing.png'), maxBytes: 32 }))
            .resolves.toEqual({ success: true, exists: false });
        await expect(hashFile({ path: target, maxBytes: content.byteLength - 1 }))
            .resolves.toMatchObject({ success: false, code: 'too-large' });
        await expect(hashFile({ path: linkPath, maxBytes: content.byteLength }))
            .resolves.toMatchObject({ success: false, code: 'not-regular' });
    });

    it('atomically replaces only the exact regular file version requested', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-replace-'));
        cleanup.push(root);
        const target = join(root, 'avatar.png');
        const original = Buffer.from('original avatar');
        const replacement = Buffer.from('replacement avatar');
        await writeFile(target, original);
        const handlers = machineHandlers();

        const replaced = await uploadFile(handlers, {
            directory: root,
            fileName: 'avatar.png',
            content: replacement,
            expectedHash: createHash('sha256').update(original).digest('hex'),
        });
        expect(replaced).toMatchObject({
            success: true,
            path: target,
            hash: createHash('sha256').update(replacement).digest('hex'),
        });
        expect(await readFile(target)).toEqual(replacement);

        const stale = await uploadFile(handlers, {
            directory: root,
            fileName: 'avatar.png',
            content: Buffer.from('must not publish'),
            expectedHash: createHash('sha256').update(original).digest('hex'),
        });
        expect(stale).toMatchObject({ success: false, code: 'conflict' });
        expect(await readFile(target)).toEqual(replacement);
        expect((await readdir(root)).filter((name) => name.includes('happyherd-upload'))).toEqual([]);
    });

    it('serializes concurrent uploads by exact target path', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-serialize-'));
        cleanup.push(root);
        const target = join(root, 'avatar.png');
        const original = Buffer.from('original avatar');
        const replacement = Buffer.from('first replacement');
        const expectedHash = createHash('sha256').update(original).digest('hex');
        await writeFile(target, original);
        const handlers = machineHandlers();
        const start = handlers.get('uploadFileStart')!;

        const [first, second] = await Promise.all([
            start({ directory: root, fileName: 'avatar.png', size: replacement.byteLength, expectedHash }),
            start({ directory: root, fileName: 'avatar.png', size: replacement.byteLength, expectedHash }),
        ]);
        expect(first).toMatchObject({ success: true });
        expect(second).toMatchObject({ success: false, code: 'conflict' });

        const chunk = await handlers.get('uploadFileChunk')!({
            uploadId: first.uploadId,
            offset: 0,
            content: replacement.toString('base64'),
        });
        expect(chunk).toEqual({ success: true, received: replacement.byteLength });
        await expect(handlers.get('uploadFileFinish')!({ uploadId: first.uploadId }))
            .resolves.toMatchObject({ success: true });
        expect(await readFile(target)).toEqual(replacement);

        await expect(start({
            directory: root,
            fileName: 'avatar.png',
            size: 1,
            expectedHash,
        })).resolves.toMatchObject({ success: false, code: 'conflict' });
    });

    it('refuses optimistic replacement through a symbolic link', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-replace-link-'));
        cleanup.push(root);
        const outside = join(root, 'outside.png');
        const target = join(root, 'avatar.png');
        const original = Buffer.from('outside avatar');
        await writeFile(outside, original);
        await symlink(outside, target);

        const response = await uploadFile(machineHandlers(), {
            directory: root,
            fileName: 'avatar.png',
            content: Buffer.from('replacement'),
            expectedHash: createHash('sha256').update(original).digest('hex'),
        });
        expect(response).toMatchObject({ success: false, code: 'conflict' });
        expect(await readFile(outside)).toEqual(original);
    });

    it('preserves literal special-character names without creating a plus directory', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-names-'));
        cleanup.push(root);
        const handlers = machineHandlers();
        const names = ['a+b.txt', 'a b.txt', '100%.txt', '#notes.txt', '你好.txt'];

        for (const name of names) {
            const content = Buffer.from(`content:${name}`);
            const response = await uploadFile(handlers, { directory: root, fileName: name, content });
            expect(response).toMatchObject({
                success: true,
                path: join(root, name),
                size: content.length,
                hash: createHash('sha256').update(content).digest('hex'),
            });
            expect(await readFile(join(root, name))).toEqual(content);
        }

        expect(await readdir(root)).toEqual(expect.arrayContaining(names));
        expect((await readdir(root)).includes('+')).toBe(false);
    });

    it('preserves leading and trailing spaces in parent paths, file names, and folder names', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-spaces-'));
        cleanup.push(root);
        const spacedParent = join(root, 'target ');
        await mkdir(spacedParent);
        await mkdir(join(root, 'target'));
        const handlers = machineHandlers();
        const content = Buffer.from('exact path');

        await expect(uploadFile(handlers, {
            directory: spacedParent,
            fileName: ' report.txt ',
            content,
        })).resolves.toMatchObject({
            success: true,
            path: join(spacedParent, ' report.txt '),
        });
        expect(await readFile(join(spacedParent, ' report.txt '))).toEqual(content);
        expect(await readdir(join(root, 'target'))).toEqual([]);

        await expect(handlers.get('createDirectory')!({
            directory: spacedParent,
            directoryName: ' child ',
        })).resolves.toEqual({ success: true, path: join(spacedParent, ' child ') });
        expect((await stat(join(spacedParent, ' child '))).isDirectory()).toBe(true);
    });

    it('creates exactly one safe child folder without overwriting', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-create-folder-'));
        cleanup.push(root);
        const handler = machineHandlers().get('createDirectory')!;

        await expect(handler({ directory: root, directoryName: 'new + folder' }))
            .resolves.toEqual({ success: true, path: join(root, 'new + folder') });
        expect((await stat(join(root, 'new + folder'))).isDirectory()).toBe(true);
        await expect(handler({ directory: root, directoryName: 'new + folder' }))
            .resolves.toMatchObject({ success: false, code: 'conflict' });
        expect(await readdir(root)).toEqual(['new + folder']);
    });

    it('rejects unsafe folder names and reports invalid parents explicitly', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-create-folder-errors-'));
        cleanup.push(root);
        const parentFile = join(root, 'file.txt');
        await writeFile(parentFile, 'not a directory');
        const handler = machineHandlers().get('createDirectory')!;

        for (const directoryName of ['.', '..', '../escape', 'nested/child', 'nested\\child', 'bad\0name']) {
            await expect(handler({ directory: root, directoryName }))
                .resolves.toMatchObject({ success: false, code: 'invalid-name' });
        }
        await expect(handler({ directory: join(root, 'missing'), directoryName: 'child' }))
            .resolves.toMatchObject({ success: false, code: 'not-found' });
        await expect(handler({ directory: parentFile, directoryName: 'child' }))
            .resolves.toMatchObject({ success: false, code: 'not-directory' });
        expect(await readdir(root)).toEqual(['file.txt']);
    });

    it.runIf(typeof process.getuid === 'function' && process.getuid() !== 0)(
        'reports permission failure without leaving a child artifact',
        async () => {
            const root = await mkdtemp(join(tmpdir(), 'happyherd-create-folder-permission-'));
            cleanup.push(root);
            const handler = machineHandlers().get('createDirectory')!;
            await chmod(root, 0o500);
            try {
                await expect(handler({ directory: root, directoryName: 'blocked' }))
                    .resolves.toMatchObject({ success: false, code: 'permission-denied' });
            } finally {
                await chmod(root, 0o700);
            }
            expect(await readdir(root)).toEqual([]);
        },
    );
});
