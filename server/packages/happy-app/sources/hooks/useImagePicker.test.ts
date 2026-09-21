import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    platform: { OS: 'ios' },
    requestMediaLibraryPermissionsAsync: vi.fn(),
    launchImageLibraryAsync: vi.fn(),
    manipulateAsync: vi.fn(),
    getInfoAsync: vi.fn(),
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
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: mocks.getInfoAsync }));

vi.mock('@/modal', () => ({
    Modal: { alert: mocks.alert },
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/utils/thumbhash', () => ({
    generateThumbhash: mocks.generateThumbhash,
}));

import { MAX_FILE_SIZE, normalizePickedAssetForUpload, useImagePicker } from './useImagePicker';

const photo = { uri: 'file:///test/photo.heic', width: 6048, height: 8064,
    fileName: 'photo.heic', mimeType: 'image/heic', fileSize: 2_701_533 };
beforeEach(() => {
    vi.resetAllMocks();
    mocks.platform.OS = 'ios';
    mocks.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocks.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [photo] });
    mocks.manipulateAsync.mockResolvedValue({ uri: 'file:///test/normalized.jpg', width: 2304, height: 3072 });
    mocks.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 3_000_000 });
    mocks.generateThumbhash.mockResolvedValue('thumbhash');
});

type ImagePickerController = ReturnType<typeof useImagePicker>;

describe('normalizePickedAssetForUpload', () => {
    it('normalizes iOS image picker assets to JPEG before upload', async () => {
        mocks.manipulateAsync.mockResolvedValue({
            uri: 'file:///tmp/ImageManipulator/IMG_9824.jpg',
            width: 3072,
            height: 2304,
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
            [{ resize: { width: 3072 } }],
            { compress: 0.92, format: 'jpeg' },
        );
        expect(normalized).toEqual({
            uri: 'file:///tmp/ImageManipulator/IMG_9824.jpg',
            mimeType: 'image/jpeg',
            name: 'IMG_9824.jpg',
            width: 3072,
            height: 2304,
            size: 3_000_000,
        });
    });

    it.each([
        [6048, 8064, { height: 3072 }],
        [8064, 6048, { width: 3072 }],
        [8064, 8064, { width: 3072 }],
        [12000, 2000, { width: 3072 }],
    ])('bounds %ix%i images using one dimension to preserve framing', async (width, height, resize) => {
        await normalizePickedAssetForUpload({ ...photo, width, height });
        expect(mocks.manipulateAsync).toHaveBeenCalledExactlyOnceWith(
            photo.uri, [{ resize }], { compress: 0.92, format: 'jpeg' },
        );
    });

    it.each([[1024, 768], [3072, 2304]])('does not upscale or crop an already-small %ix%i image', async (width, height) => {
        mocks.manipulateAsync.mockResolvedValue({ uri: 'file:///test/small.jpg', width, height });
        const normalized = await normalizePickedAssetForUpload({ ...photo, width, height, fileName: 'small.jpg', mimeType: 'image/jpeg' });
        expect(mocks.manipulateAsync).toHaveBeenCalledExactlyOnceWith(
            photo.uri, [], { compress: 0.92, format: 'jpeg' },
        );
        expect(normalized).toMatchObject({ width, height, name: 'small.jpg' });
    });

    it('measures the converted URI even when source filesize is unavailable', async () => {
        const normalized = await normalizePickedAssetForUpload({ ...photo, fileSize: undefined });
        expect(mocks.getInfoAsync).toHaveBeenCalledExactlyOnceWith('file:///test/normalized.jpg');
        expect(normalized).toMatchObject({ size: 3_000_000, width: 2304, height: 3072 });
    });

    it.each([
        { exists: false },
        { exists: true, isDirectory: true, size: 100 },
        { exists: true, size: undefined },
        { exists: true, size: 0 },
        { exists: true, size: -1 },
        { exists: true, size: NaN },
        { exists: true, size: Infinity },
    ])('rejects unreadable/unknown transformed filesize: %j', async (info) => {
        mocks.getInfoAsync.mockResolvedValue(info);
        await expect(normalizePickedAssetForUpload(photo)).rejects.toThrow();
    });

    it.each(['android', 'web'])('preserves the existing %s path', async (platform) => {
        mocks.platform.OS = platform;
        const normalized = await normalizePickedAssetForUpload(photo);
        expect(normalized).toEqual({
            uri: photo.uri, width: photo.width, height: photo.height,
            mimeType: photo.mimeType, name: photo.fileName, size: photo.fileSize,
        });
        expect(mocks.manipulateAsync).not.toHaveBeenCalled();
        expect(mocks.getInfoAsync).not.toHaveBeenCalled();
    });
});

describe('useImagePicker transformed upload validation', () => {
    let renderer: ReactTestRenderer;
    let current: ImagePickerController;
    function Harness() { current = useImagePicker(); return null; }
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        act(() => { renderer = create(React.createElement(Harness)); });
    });
    afterEach(() => { act(() => renderer.unmount()); });
    const addedImages = () => current.selectedImages;
    const pick = async () => { await act(async () => { await current.pickImages(); }); };

    it('adds the converted bytes/size, not the original oversized HEIC', async () => {
        mocks.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ ...photo, fileSize: MAX_FILE_SIZE + 1 }] });
        await pick();
        expect(addedImages()).toEqual([expect.objectContaining({
            uri: 'file:///test/normalized.jpg', size: 3_000_000,
            width: 2304, height: 3072, name: 'photo.jpg', mimeType: 'image/jpeg', thumbhash: 'thumbhash',
        })]);
        expect(mocks.generateThumbhash).toHaveBeenCalledExactlyOnceWith('file:///test/normalized.jpg', 2304, 3072);
        expect(mocks.alert).not.toHaveBeenCalled();
    });

    it.each([MAX_FILE_SIZE + 1, MAX_FILE_SIZE, MAX_FILE_SIZE - 39])('rejects transformed size %i including encryption overhead', async (size) => {
        mocks.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size });
        await pick();
        expect(mocks.alert).toHaveBeenCalledWith('imageUpload.fileTooLargeTitle', 'imageUpload.fileTooLargeMessage', expect.any(Array));
        expect(mocks.generateThumbhash).not.toHaveBeenCalled();
        expect(addedImages()).toEqual([]);
    });

    it('accepts the exact encrypted upload boundary and reports plaintext bytes', async () => {
        mocks.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: MAX_FILE_SIZE - 40 });
        await pick();
        expect(addedImages()[0].size).toBe(MAX_FILE_SIZE - 40);
    });

    it('accepts unknown original filesize after measuring the JPEG', async () => {
        mocks.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ ...photo, fileSize: undefined }] });
        await pick();
        expect(addedImages()[0].size).toBe(3_000_000);
    });

    it.each(['manipulateAsync', 'getInfoAsync'] as const)('isolates %s failure without dropping valid sibling images', async (operation) => {
        mocks.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [photo, photo] });
        mocks[operation].mockRejectedValueOnce(new Error('native failure'));
        await pick();
        expect(addedImages()).toHaveLength(1);
        expect(mocks.alert).toHaveBeenCalledWith('imageUpload.uploadFailedTitle', 'imageUpload.uploadFailedMessage', expect.any(Array));
    });

    it('does not add an image whose converted size is unavailable', async () => {
        mocks.getInfoAsync.mockResolvedValue({ exists: false });
        await pick();
        expect(addedImages()).toEqual([]);
        expect(mocks.alert).toHaveBeenCalledTimes(1);
    });

    it.each([{ canceled: true, assets: null }, { canceled: false, assets: [] }])('does nothing on canceled/empty selection', async (result) => {
        mocks.launchImageLibraryAsync.mockResolvedValue(result);
        await pick();
        expect(mocks.manipulateAsync).not.toHaveBeenCalled();
        expect(mocks.getInfoAsync).not.toHaveBeenCalled();
        expect(addedImages()).toEqual([]);
        expect(mocks.alert).not.toHaveBeenCalled();
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
