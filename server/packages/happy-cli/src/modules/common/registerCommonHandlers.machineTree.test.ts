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
    });
});
