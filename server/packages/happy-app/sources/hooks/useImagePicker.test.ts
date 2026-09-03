import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    platform: { OS: 'ios' },
    requestMediaLibraryPermissionsAsync: vi.fn(),
    launchImageLibraryAsync: vi.fn(),
    manipulateAsync: vi.fn(),
    generateThumbhash: vi.fn(),
    alert: vi.fn(),
}));

vi.mock('react-native', () => ({
    Platform: mocks.platform,
}));

vi.mock('expo-image-picker', () => ({
    requestMediaLibraryPermissionsAsync: mocks.requestMediaLibraryPermissionsAsync,
    launchImageLibraryAsync: mocks.launchImageLibraryAsync,
}));

vi.mock('expo-image-manipulator', () => ({
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: mocks.manipulateAsync,
}));

vi.mock('@/modal', () => ({
    Modal: { alert: mocks.alert },
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/utils/thumbhash', () => ({
    generateThumbhash: mocks.generateThumbhash,
}));

import { normalizePickedAssetForUpload, useImagePicker } from './useImagePicker';

type ImagePickerController = ReturnType<typeof useImagePicker>;

describe('normalizePickedAssetForUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.platform.OS = 'ios';
    });

    it('normalizes iOS image picker assets to JPEG before upload', async () => {
        mocks.manipulateAsync.mockResolvedValue({
            uri: 'file:///tmp/ImageManipulator/IMG_9824.jpg',
            width: 4032,
            height: 3024,
        });

        const normalized = await normalizePickedAssetForUpload({
            uri: 'file:///tmp/IMG_9824.HEIC',
            width: 4032,
            height: 3024,
            fileName: 'IMG_9824.HEIC',
            fileSize: 2_701_533,
        });

        expect(mocks.manipulateAsync).toHaveBeenCalledWith(
            'file:///tmp/IMG_9824.HEIC',
            [],
            { compress: expect.any(Number), format: 'jpeg' },
        );
        expect(normalized).toEqual({
            uri: 'file:///tmp/ImageManipulator/IMG_9824.jpg',
            mimeType: 'image/jpeg',
            name: 'IMG_9824.jpg',
            width: 4032,
            height: 3024,
        });
    });
});

describe('useImagePicker workspace uploads', () => {
    const originalConsoleError = console.error;
    let renderer: ReactTestRenderer;
    let current: ImagePickerController;

    function Harness() {
        current = useImagePicker();
        return null;
    }

    beforeAll(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        console.error = (...args: unknown[]) => {
            if (typeof args[0] === 'string' && args[0].startsWith('react-test-renderer is deprecated')) return;
            originalConsoleError(...args);
        };
    });

    afterAll(() => {
        console.error = originalConsoleError;
        delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.platform.OS = 'web';
        mocks.generateThumbhash.mockResolvedValue('thumbhash');
        act(() => {
            renderer = create(React.createElement(Harness));
        });
    });

    it('returns picked photos for workspace upload without adding inline attachments', async () => {
        mocks.launchImageLibraryAsync.mockResolvedValue({
            canceled: false,
            assets: [
                {
                    uri: 'file:///one.png', width: 120, height: 80, fileName: 'one.png',
                    fileSize: 12, mimeType: 'image/png',
                },
                {
                    uri: 'file:///two.jpg', width: 90, height: 60, fileName: 'two.jpg',
                    fileSize: 34, mimeType: 'image/jpeg',
                },
            ],
        });

        let picked = [] as Awaited<ReturnType<ImagePickerController['pickImagesForUpload']>>;
        await act(async () => {
            picked = await current.pickImagesForUpload(1);
        });

        expect(mocks.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
            mediaTypes: ['images'],
            selectionLimit: 1,
        }));
        expect(picked).toEqual([
            expect.objectContaining({
                uri: 'file:///one.png',
                name: 'one.png',
                mimeType: 'image/png',
                size: 12,
            }),
        ]);
        expect(current.selectedImages).toEqual([]);
        expect(mocks.manipulateAsync).not.toHaveBeenCalled();

        act(() => renderer.unmount());
    });

    it('preserves the existing inline attachment behavior', async () => {
        mocks.launchImageLibraryAsync.mockResolvedValue({
            canceled: false,
            assets: [{
                uri: 'file:///inline.jpg', width: 40, height: 30, fileName: 'inline.jpg',
                fileSize: 56, mimeType: 'image/jpeg',
            }],
        });

        await act(async () => {
            await current.pickImages();
        });

        expect(current.selectedImages).toEqual([
            expect.objectContaining({ uri: 'file:///inline.jpg', name: 'inline.jpg' }),
        ]);

        act(() => renderer.unmount());
    });

    it('uses the workspace uploader 20 MiB limit without relaxing the inline 10 MiB limit', async () => {
        mocks.launchImageLibraryAsync.mockResolvedValue({
            canceled: false,
            assets: [{
                uri: 'file:///fifteen-meg.jpg', width: 40, height: 30, fileName: 'fifteen-meg.jpg',
                fileSize: 15 * 1024 * 1024, mimeType: 'image/jpeg',
            }],
        });

        let workspacePhotos = [] as Awaited<ReturnType<ImagePickerController['pickImagesForUpload']>>;
        await act(async () => {
            workspacePhotos = await current.pickImagesForUpload();
        });
        expect(workspacePhotos).toHaveLength(1);
        expect(current.selectedImages).toEqual([]);

        await act(async () => {
            await current.pickImages();
        });
        expect(current.selectedImages).toEqual([]);
        expect(mocks.alert).toHaveBeenCalledWith(
            'imageUpload.fileTooLargeTitle',
            'imageUpload.fileTooLargeMessage',
            [{ text: 'common.ok' }],
        );

        mocks.launchImageLibraryAsync.mockResolvedValueOnce({
            canceled: false,
            assets: [{
                uri: 'file:///twenty-one-meg.jpg', width: 40, height: 30, fileName: 'twenty-one-meg.jpg',
                fileSize: 21 * 1024 * 1024, mimeType: 'image/jpeg',
            }],
        });
        await act(async () => {
            workspacePhotos = await current.pickImagesForUpload();
        });
        expect(workspacePhotos).toEqual([]);

        act(() => renderer.unmount());
    });
});
