import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

    it('publishes byte-exact content without overwriting another file', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-'));
        cleanup.push(root);
        const content = Buffer.from([0, 1, 2, 3, 255]);
        const handler = machineHandlers().get('uploadFile')!;

        const created = await handler({
            directory: root,
            fileName: 'asset.bin',
            content: content.toString('base64'),
        });
        expect(created).toMatchObject({ success: true, path: join(root, 'asset.bin'), size: content.length });
        expect(await readFile(join(root, 'asset.bin'))).toEqual(content);

        const conflict = await handler({
            directory: root,
            fileName: 'asset.bin',
            content: Buffer.from('replacement').toString('base64'),
        });
        expect(conflict).toMatchObject({ success: false, code: 'conflict' });
        expect(await readFile(join(root, 'asset.bin'))).toEqual(content);
    });

    it('rejects path-bearing names, oversized files, and non-directory destinations', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-'));
        cleanup.push(root);
        const filePath = join(root, 'not-a-directory');
        await writeFile(filePath, 'x');
        const handler = machineHandlers().get('uploadFile')!;

        await expect(handler({ directory: root, fileName: '../escape', content: '' }))
            .resolves.toMatchObject({ success: false, code: 'invalid-name' });
        await expect(handler({
            directory: root,
            fileName: 'huge.bin',
            content: Buffer.alloc(MAX_WORKSPACE_UPLOAD_BYTES + 1).toString('base64'),
        })).resolves.toMatchObject({ success: false, code: 'too-large' });
        await expect(handler({ directory: filePath, fileName: 'child.txt', content: '' }))
            .resolves.toMatchObject({ success: false, code: 'not-directory' });
    });

    it('leaves no temporary file after a destination conflict', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-upload-'));
        cleanup.push(root);
        await mkdir(join(root, 'folder'));
        await writeFile(join(root, 'folder', 'same.txt'), 'existing');
        const handler = machineHandlers().get('uploadFile')!;
        await handler({ directory: join(root, 'folder'), fileName: 'same.txt', content: Buffer.from('new').toString('base64') });
        const { readdir } = await import('node:fs/promises');
        expect((await readdir(join(root, 'folder'))).filter((name) => name.includes('happyherd-upload'))).toEqual([]);
    });
});
