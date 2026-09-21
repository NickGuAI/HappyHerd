import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { registerCommonHandlers } from './registerCommonHandlers';

describe('machine directory tree', () => {
    const cleanup: string[] = [];

    afterEach(async () => {
        await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    });

    it('browses absolute paths and follows host-visible directory symlinks', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-machine-tree-'));
        cleanup.push(root);
        const target = join(root, 'target');
        await mkdir(target);
        await writeFile(join(target, 'visible.txt'), 'visible');
        await symlink(target, join(root, 'linked-target'));

        const handlers = new Map<string, (params: any) => Promise<any>>();
        registerCommonHandlers({
            registerHandler: (name: string, handler: (params: any) => Promise<any>) => handlers.set(name, handler),
        } as any, null);

        const response = await handlers.get('getDirectoryTree')?.({ path: root, maxDepth: 1 });
        expect(response?.success).toBe(true);
        expect(response?.tree?.children?.find((entry: any) => entry.name === 'linked-target')).toMatchObject({
            path: join(root, 'linked-target'),
            type: 'directory',
        });

        const listing = await handlers.get('listDirectory')?.({ path: root });
        expect(listing?.success).toBe(true);
        expect(listing?.entries?.find((entry: any) => entry.name === 'linked-target')).toMatchObject({
            type: 'other',
        });
    });

    it('lists dotfiles and hidden directories without filtering their names', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-machine-tree-hidden-'));
        cleanup.push(root);
        const hiddenDirectory = join(root, '.config');
        await mkdir(hiddenDirectory);
        await writeFile(join(root, '.xxenv'), 'HIDDEN=value\n');
        await writeFile(join(root, '.mcp.json'), '{"mcpServers":{}}\n');
        await writeFile(join(hiddenDirectory, '.nested-config'), 'nested\n');

        const handlers = new Map<string, (params: any) => Promise<any>>();
        registerCommonHandlers({
            registerHandler: (name: string, handler: (params: any) => Promise<any>) => handlers.set(name, handler),
        } as any, null);

        const response = await handlers.get('getDirectoryTree')?.({ path: root, maxDepth: 2 });
        expect(response?.success).toBe(true);
        expect(response?.tree?.children?.map((entry: any) => entry.name)).toEqual(
            expect.arrayContaining(['.config', '.mcp.json', '.xxenv']),
        );
        expect(response?.tree?.children?.find((entry: any) => entry.name === '.config')).toMatchObject({
            path: hiddenDirectory,
            type: 'directory',
            children: [expect.objectContaining({ name: '.nested-config', type: 'file' })],
        });

        const listing = await handlers.get('listDirectory')?.({ path: root });
        expect(listing?.success).toBe(true);
        expect(listing?.entries?.map((entry: any) => entry.name)).toEqual(
            expect.arrayContaining(['.config', '.mcp.json', '.xxenv']),
        );
    });

    it('preserves the root filesystem error for a missing absolute path', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-machine-tree-missing-'));
        cleanup.push(root);
        const missingPath = join(root, 'does-not-exist');

        const handlers = new Map<string, (params: any) => Promise<any>>();
        registerCommonHandlers({
            registerHandler: (name: string, handler: (params: any) => Promise<any>) => handlers.set(name, handler),
        } as any, null);

        const response = await handlers.get('getDirectoryTree')?.({ path: missingPath, maxDepth: 1 });
        expect(response?.success).toBe(false);
        expect(response?.error).toMatch(/ENOENT|no such file/i);
    });
});
