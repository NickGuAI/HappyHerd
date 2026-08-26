import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
    afterRealpath: null as null | ((path: string) => void),
}));

vi.mock('fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs/promises')>();
    return {
        ...actual,
        realpath: async (...args: Parameters<typeof actual.realpath>) => {
            const resolved = await actual.realpath(...args);
            hooks.afterRealpath?.(String(args[0]));
            return resolved;
        },
    };
});

import { registerCommonHandlers } from './registerCommonHandlers';

describe('rooted file read race boundary', () => {
    const cleanup: string[] = [];

    afterEach(() => {
        hooks.afterRealpath = null;
        for (const path of cleanup.splice(0)) {
            rmSync(path, { recursive: true, force: true });
        }
    });

    it('returns no bytes when the canonical candidate is swapped to an outside symlink before open', async () => {
        const container = mkdtempSync(join(tmpdir(), 'happyherd-rooted-file-race-'));
        cleanup.push(container);
        const root = join(container, 'workspace');
        const candidate = join(root, 'image.png');
        const outside = join(container, 'outside.png');
        mkdirSync(root);
        writeFileSync(candidate, 'inside-image-bytes');
        writeFileSync(outside, 'outside-image-bytes');

        hooks.afterRealpath = (path) => {
            if (path !== candidate) return;
            hooks.afterRealpath = null;
            unlinkSync(candidate);
            symlinkSync(outside, candidate);
        };

        const handlers = new Map<string, (params: any) => Promise<any>>();
        registerCommonHandlers({
            registerHandler: (name: string, handler: (params: any) => Promise<any>) => handlers.set(name, handler),
        } as any, null);
        const response = await handlers.get('readFileWithinRoot')?.({
            path: candidate,
            rootPath: root,
        });

        expect(response?.success).toBe(false);
        expect(response).not.toHaveProperty('content');
    });
});
