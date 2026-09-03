import { describe, expect, it, vi } from 'vitest';

vi.mock('@/sync/apiSocket', () => ({ apiSocket: { machineRPC: vi.fn() } }));

import { workspaceLivePickFromMessage } from './LocalhostLiveView.web';

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
});
