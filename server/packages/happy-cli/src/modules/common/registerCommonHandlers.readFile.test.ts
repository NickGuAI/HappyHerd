import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_FILE_PREVIEW_BYTES, registerCommonHandlers } from './registerCommonHandlers';

describe('workspace file preview boundary', () => {
    const cleanup: string[] = [];

    afterEach(async () => {
        await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
    });

    function handlersFor(root: string) {
        const handlers = new Map<string, (params: any) => Promise<any>>();
        registerCommonHandlers({
            registerHandler: (name: string, handler: (params: any) => Promise<any>) => handlers.set(name, handler),
        } as any, root);
        return handlers;
    }

    function machineHandlers() {
        const handlers = new Map<string, (params: any) => Promise<any>>();
        registerCommonHandlers({
            registerHandler: (name: string, handler: (params: any) => Promise<any>) => handlers.set(name, handler),
        } as any, null);
        return handlers;
    }

    it('reads an in-workspace file as base64', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-file-preview-'));
        cleanup.push(root);
        const file = join(root, 'note.md');
        await writeFile(file, '# Hello');

        const response = await handlersFor(root).get('readFile')?.({ path: file });
        expect(response).toEqual({ success: true, content: Buffer.from('# Hello').toString('base64') });
    });

    it('reads a genuine in-root file through the constrained machine RPC', async () => {
        const container = await mkdtemp(join(tmpdir(), 'happyherd-rooted-file-preview-'));
        cleanup.push(container);
        const root = join(container, 'workspace');
        const file = join(root, 'image.png');
        const content = Buffer.from('in-root-image');
        await mkdir(root);
        await writeFile(file, content);

        const response = await machineHandlers().get('readFileWithinRoot')?.({
            path: file,
            rootPath: root,
        });

        expect(response).toEqual({ success: true, content: content.toString('base64') });
    });

    it('requires both rooted-read paths and never exposes that handler to a session', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-rooted-file-preview-'));
        cleanup.push(root);
        const file = join(root, 'image.png');
        await writeFile(file, 'image');

        expect(handlersFor(root).has('readFileWithinRoot')).toBe(false);
        await expect(machineHandlers().get('readFileWithinRoot')?.({ path: file })).resolves.toEqual({
            success: false,
            error: 'path and rootPath are required',
        });
    });

    it('rejects an in-root symlink to an outside file before returning bytes', async () => {
        const container = await mkdtemp(join(tmpdir(), 'happyherd-rooted-file-preview-'));
        cleanup.push(container);
        const root = join(container, 'workspace');
        const outside = join(container, 'outside.png');
        const linked = join(root, 'linked.png');
        await mkdir(root);
        await writeFile(outside, 'outside-image-bytes');
        await symlink(outside, linked);

        const response = await machineHandlers().get('readFileWithinRoot')?.({
            path: linked,
            rootPath: root,
        });

        expect(response).toEqual({
            success: false,
            error: 'Access denied: Path is outside the requested root',
        });
        expect(response).not.toHaveProperty('content');
    });

    it('rejects oversized files before loading them into daemon memory', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-file-preview-'));
        cleanup.push(root);
        const file = join(root, 'large.pdf');
        await writeFile(file, '');
        await truncate(file, MAX_FILE_PREVIEW_BYTES + 1);

        const response = await handlersFor(root).get('readFile')?.({ path: file });
        expect(response).toEqual({ success: false, error: 'File is too large to preview (limit 20 MiB)' });
    });

    it('saves against the expected hash and returns the hash that read-back observes', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-file-preview-'));
        cleanup.push(root);
        const file = join(root, 'note.md');
        const original = Buffer.from('# Before');
        const updated = Buffer.from('# After');
        await writeFile(file, original);

        const response = await handlersFor(root).get('writeFile')?.({
            path: file,
            content: updated.toString('base64'),
            expectedHash: createHash('sha256').update(original).digest('hex'),
        });
        const expectedHash = createHash('sha256').update(updated).digest('hex');
        expect(response).toEqual({ success: true, hash: expectedHash });
        expect(await readFile(file, 'utf8')).toBe('# After');
    });

    it('does not overwrite a file when its hash changed externally', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-file-preview-'));
        cleanup.push(root);
        const file = join(root, 'note.md');
        await writeFile(file, '# Host changed');

        const response = await handlersFor(root).get('writeFile')?.({
            path: file,
            content: Buffer.from('# Stale editor').toString('base64'),
            expectedHash: createHash('sha256').update('# Old version').digest('hex'),
        });
        expect(response?.success).toBe(false);
        expect(response?.error).toContain('hash mismatch');
        expect(await readFile(file, 'utf8')).toBe('# Host changed');
    });

    it('reads and hash-safely writes absolute files through machine-scoped handlers', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happyherd-machine-file-preview-'));
        cleanup.push(root);
        const envFile = join(root, '.xxenv');
        const mcpFile = join(root, '.mcp.json');
        const original = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('TOKEN=before\n')]);
        const updated = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('TOKEN=after\n')]);
        const mcpContent = Buffer.from('{"mcpServers":{"local":{"command":"λ"}}}\n');
        await writeFile(envFile, original);
        await writeFile(mcpFile, mcpContent);

        const handlers = machineHandlers();
        const envReadResponse = await handlers.get('readFile')?.({ path: envFile });
        expect(envReadResponse).toEqual({ success: true, content: original.toString('base64') });
        const mcpReadResponse = await handlers.get('readFile')?.({ path: mcpFile });
        expect(mcpReadResponse).toEqual({ success: true, content: mcpContent.toString('base64') });

        const writeResponse = await handlers.get('writeFile')?.({
            path: envFile,
            content: updated.toString('base64'),
            expectedHash: createHash('sha256').update(original).digest('hex'),
        });
        expect(writeResponse).toEqual({
            success: true,
            hash: createHash('sha256').update(updated).digest('hex'),
        });
        expect(await readFile(envFile)).toEqual(updated);

        await writeFile(mcpFile, '{"changedExternally":true}\n');
        const conflictResponse = await handlers.get('writeFile')?.({
            path: mcpFile,
            content: Buffer.from('{"staleEditor":true}\n').toString('base64'),
            expectedHash: createHash('sha256').update(mcpContent).digest('hex'),
        });
        expect(conflictResponse?.success).toBe(false);
        expect(conflictResponse?.error).toContain('hash mismatch');
        expect(await readFile(mcpFile, 'utf8')).toBe('{"changedExternally":true}\n');
    });
});
