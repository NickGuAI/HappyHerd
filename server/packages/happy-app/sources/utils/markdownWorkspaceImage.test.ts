import { describe, expect, it, vi } from 'vitest';

vi.mock('@/sync/ops', () => ({ machineReadFileWithinRoot: vi.fn() }));

import type { MarkdownWorkspaceImageReference } from './markdownWorkspaceLink';
import { loadMarkdownWorkspaceImage } from './markdownWorkspaceImage';

const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);
const onePixelJpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AZb//2Q==',
    'base64',
);

function reference(absolutePath: string): MarkdownWorkspaceImageReference {
    return {
        rootPath: '/srv/project',
        workspaceRoute: {
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'machine-origin',
                absolutePath,
            },
        },
    };
}

describe('Markdown workspace image loading', () => {
    it.each([
        ['PNG', '/srv/project/images/chart.png', onePixelPng, 'image/png'],
        ['JPEG', '/srv/project/images/chart.jpeg', onePixelJpeg, 'image/jpeg'],
        ['SVG', '/srv/project/images/chart.svg', new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>'), 'image/svg+xml'],
    ])('reads validated %s bytes from the pinned machine', async (_name, absolutePath, bytes, mime) => {
        const base64 = Buffer.from(bytes).toString('base64');
        const readFile = vi.fn(async () => ({ success: true, content: base64 }));

        await expect(loadMarkdownWorkspaceImage(reference(absolutePath), readFile)).resolves.toBe(
            `data:${mime};base64,${base64}`,
        );
        expect(readFile).toHaveBeenCalledOnce();
        expect(readFile).toHaveBeenCalledWith('machine-origin', absolutePath, '/srv/project');
    });

    it('rejects a non-image path without crossing the machine boundary', async () => {
        const readFile = vi.fn();

        await expect(loadMarkdownWorkspaceImage(reference('/srv/project/notes.txt'), readFile)).resolves.toBeNull();
        expect(readFile).not.toHaveBeenCalled();
    });

    it.each([
        ['offline', async () => ({ success: false, error: 'Machine offline' })],
        ['old daemon without the RPC', async () => { throw new Error('RPC method not available'); }],
        ['missing daemon', async () => { throw new Error('The computer did not respond'); }],
        ['oversize', async () => ({ success: false, error: 'File is too large to preview (limit 20 MiB)' })],
        ['missing content', async () => ({ success: true })],
        ['malformed base64', async () => ({ success: true, content: 'not base64' })],
        ['mismatched bytes', async () => ({ success: true, content: Buffer.from('plain text').toString('base64') })],
        ['read exception', async () => { throw new Error('disconnected'); }],
    ])('fails closed on %s', async (_name, implementation) => {
        await expect(loadMarkdownWorkspaceImage(
            reference('/srv/project/images/chart.png'),
            vi.fn(implementation),
        )).resolves.toBeNull();
    });
});
