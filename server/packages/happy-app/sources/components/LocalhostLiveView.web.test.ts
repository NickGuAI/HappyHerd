import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    registerWorkspaceLiveView: vi.fn(),
}));

vi.mock('@/sync/apiSocket', () => ({ apiSocket: { machineRPC: vi.fn() } }));
vi.mock('@/sync/workspaceLive', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/workspaceLive')>(),
    registerWorkspaceLiveView: mocks.registerWorkspaceLiveView,
}));

import { LocalhostLiveView, workspaceLivePickFromMessage } from './LocalhostLiveView.web';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
        if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => vi.clearAllMocks());

describe('LocalhostLiveView picker messages', () => {
    it('creates one bounded comment payload with an upload-ready screenshot', () => {
        const result = workspaceLivePickFromMessage({
            type: 'happyherd-workspace-live',
            action: 'pick',
            viewId: 'view-1',
            pickId: 'pick-1',
            selector: '#save',
            outerHTML: '<button id="save">Save</button>',
            computedCss: 'display: inline-flex;',
            bounds: { x: 10, y: 20, width: 120, height: 36 },
            screenshot: { dataUrl: 'data:image/png;base64,AQID', width: 120, height: 36 },
        });

        expect(result).toEqual({
            pickId: 'pick-1',
            selector: '#save',
            outerHTML: '<button id="save">Save</button>',
            computedCss: 'display: inline-flex;',
            bounds: { x: 10, y: 20, width: 120, height: 36 },
            screenshot: {
                id: 'pick-1',
                uri: 'data:image/png;base64,AQID',
                width: 120,
                height: 36,
                mimeType: 'image/png',
                size: 3,
                name: 'localhost-element-pick-1.png',
            },
        });
    });

    it('rejects malformed and non-PNG messages', () => {
        expect(workspaceLivePickFromMessage(null)).toBeNull();
        expect(workspaceLivePickFromMessage({
            type: 'happyherd-workspace-live',
            action: 'pick',
            pickId: 'pick-1',
            selector: '#save',
            outerHTML: '<button />',
            computedCss: '',
            bounds: { x: 0, y: 0, width: 0, height: 10 },
            screenshot: { dataUrl: 'data:text/plain;base64,AQID', width: 1, height: 1 },
        })).toBeNull();
        expect(workspaceLivePickFromMessage({
            type: 'happyherd-workspace-live',
            action: 'pick',
            pickId: 'oversized-crop',
            selector: '#save',
            outerHTML: '<button />',
            computedCss: '',
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            screenshot: { dataUrl: 'data:image/png;base64,AQID', width: 1201, height: 1 },
        })).toBeNull();
    });

    it('reports iframe picker errors as capture failures instead of page load failures', async () => {
        const messageListeners = new Set<(event: MessageEvent) => void>();
        const iframeWindow = { postMessage: vi.fn() };
        const dispose = vi.fn();
        const previousWindow = globalThis.window;
        const windowMock = {
            location: { origin: 'https://happy.test' },
            addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
                if (type === 'message') messageListeners.add(listener);
            }),
            removeEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
                if (type === 'message') messageListeners.delete(listener);
            }),
        };
        Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
        mocks.registerWorkspaceLiveView.mockResolvedValue({
            viewId: 'registered-view',
            iframeUrl: 'https://happy.test/live',
            dispose,
        });
        const onError = vi.fn();
        const onCaptureError = vi.fn();
        let renderer: any;

        try {
            await act(async () => {
                renderer = create(React.createElement(LocalhostLiveView, {
                    machineId: 'machine-ec2',
                    url: 'http://localhost:5173/dashboard',
                    pickerEnabled: true,
                    onPick: vi.fn(),
                    onError,
                    onCaptureError,
                }), {
                    createNodeMock: (element: { type: string }) => (
                        element.type === 'iframe' ? { contentWindow: iframeWindow } : null
                    ),
                });
                await Promise.resolve();
            });

            const iframe = renderer.root.findByType('iframe' as any);
            act(() => iframe.props.onLoad());
            const pickerMessage = iframeWindow.postMessage.mock.calls.at(-1)?.[0];
            expect(pickerMessage).toMatchObject({
                type: 'happyherd-workspace-live',
                action: 'picker',
                enabled: true,
            });

            act(() => {
                for (const listener of messageListeners) {
                    listener({
                        origin: 'https://happy.test',
                        source: iframeWindow,
                        data: {
                            type: 'happyherd-workspace-live',
                            action: 'error',
                            viewId: pickerMessage.viewId,
                            error: 'Element screenshot failed',
                        },
                    } as unknown as MessageEvent);
                }
            });

            expect(onCaptureError).toHaveBeenCalledOnce();
            expect(onCaptureError.mock.calls[0][0]).toMatchObject({ message: 'Element screenshot failed' });
            expect(onError).not.toHaveBeenCalled();
        } finally {
            if (renderer) act(() => renderer.unmount());
            if (previousWindow === undefined) {
                Reflect.deleteProperty(globalThis, 'window');
            } else {
                Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
            }
        }
        expect(dispose).toHaveBeenCalledOnce();
    });
});
