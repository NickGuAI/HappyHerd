import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiSocket } from './apiSocket';
import {
    buildWorkspaceLiveIframeUrl,
    fetchWorkspaceLiveOnMachine,
    workspaceLiveScreenshotAttachment,
} from './workspaceLive';

vi.mock('./apiSocket', () => ({
    apiSocket: { machineRPC: vi.fn() },
}));

describe('Workspace live browser bridge', () => {
    beforeEach(() => {
        vi.mocked(apiSocket.machineRPC).mockReset();
    });

    it('mirrors the target path, query, and fragment without exposing its loopback authority', () => {
        const result = new URL(buildWorkspaceLiveIframeUrl(
            'http://localhost:5173/dashboard/item?q=one#details',
            'view-123',
            'https://app.example.test',
        ));

        expect(result.origin).toBe('https://app.example.test');
        expect(result.pathname).toBe('/dashboard/item');
        expect(result.searchParams.get('q')).toBe('one');
        expect(result.searchParams.get('__happyherd_workspace_live_view')).toBe('view-123');
        expect(result.hash).toBe('#details');
    });

    it('builds an upload-ready PNG attachment with its decoded byte size', () => {
        expect(workspaceLiveScreenshotAttachment({
            pickId: 'pick-7',
            dataUrl: 'data:image/png;base64,AQIDBA==',
            width: 120.4,
            height: 35.6,
        })).toEqual({
            id: 'pick-7',
            uri: 'data:image/png;base64,AQIDBA==',
            width: 120,
            height: 36,
            mimeType: 'image/png',
            size: 4,
            name: 'localhost-element-pick-7.png',
        });
    });

    it('forwards the request to the exact selected machine and validates its response', async () => {
        const response = {
            success: true as const,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/html' },
            body: 'PGgxPkxpdmU8L2gxPg==',
            finalUrl: 'http://localhost:5173/',
        };
        vi.mocked(apiSocket.machineRPC).mockResolvedValue(response);

        await expect(fetchWorkspaceLiveOnMachine('machine-ec2', {
            url: 'http://localhost:5173/',
            method: 'GET',
            headers: { accept: 'text/html' },
        })).resolves.toEqual(response);
        expect(apiSocket.machineRPC).toHaveBeenCalledOnce();
        expect(apiSocket.machineRPC).toHaveBeenCalledWith(
            'machine-ec2',
            'workspace-live-fetch',
            { url: 'http://localhost:5173/', method: 'GET', headers: { accept: 'text/html' } },
        );
    });

    it('rejects canonical loopback aliases before selecting a machine', async () => {
        await expect(fetchWorkspaceLiveOnMachine('machine-ec2', {
            url: 'http://127.1:5173/',
            method: 'GET',
            headers: {},
        })).resolves.toMatchObject({ success: false, code: 'invalid-url' });
        expect(apiSocket.machineRPC).not.toHaveBeenCalled();
    });
});
