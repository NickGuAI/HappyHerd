/**
 * Image picker hook for attaching images to messages.
 *
 * Wraps expo-image-picker with permission handling and thumbhash generation.
 * Enforces limits: max 20 images per message, 10MB per file.
 *
 * iOS images are downscaled and measured after JPEG conversion. Other
 * platforms retain the picker's optional fileSize (0 when unavailable).
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getInfoAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { MAX_WORKSPACE_UPLOAD_BYTES } from '@slopus/happy-wire';
import { Modal } from '@/modal';
import { generateThumbhash } from '@/utils/thumbhash';
import { t } from '@/text';
import type { AttachmentPreview } from '@/sync/attachmentTypes';

export const MAX_IMAGES_PER_MESSAGE = 20;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const IOS_ATTACHMENT_JPEG_QUALITY = 0.92;
const IOS_ATTACHMENT_MAX_DIMENSION = 3072;

export type { AttachmentPreview };

type UseImagePickerResult = {
    selectedImages: AttachmentPreview[];
    pickImages: () => Promise<AttachmentPreview[]>;
    pickImagesForUpload: (maxImages?: number) => Promise<AttachmentPreview[]>;
    removeImage: (id: string) => void;
    clearImages: () => void;
    addImages: (images: AttachmentPreview[]) => void;
};

type UseImagePickerOptions = {
    /**
     * Optional controlled attachment list. New Session uses this to keep the
     * same in-memory draft across navigation without creating a second picker
     * state that can drift from the visible preview strip.
     */
    images?: AttachmentPreview[];
    onChange?: (images: AttachmentPreview[]) => void;
};

function withJpegExtension(fileName: string | null | undefined): string {
    const fallback = `image_${Date.now()}.jpg`;
    const name = fileName?.trim() || fallback;
    const extensionIndex = name.lastIndexOf('.');
    const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
    return `${stem}.jpg`;
}

export async function normalizePickedAssetForUpload(asset: ImagePicker.ImagePickerAsset): Promise<{
    uri: string;
    width: number;
    height: number;
    mimeType: string;
    name: string;
    size: number;
}> {
    if (Platform.OS !== 'ios') {
        return {
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            mimeType: asset.mimeType ?? 'image/jpeg',
            name: asset.fileName ?? `image_${Date.now()}.jpg`,
            size: asset.fileSize ?? 0,
        };
    }

    // Supply only the long edge: Expo preserves aspect ratio without cropping.
    const resize = asset.width >= asset.height
        ? { width: IOS_ATTACHMENT_MAX_DIMENSION }
        : { height: IOS_ATTACHMENT_MAX_DIMENSION };
    const actions = Math.max(asset.width, asset.height) > IOS_ATTACHMENT_MAX_DIMENSION
        ? [{ resize }]
        : [];
    const converted = await manipulateAsync(asset.uri, actions, {
        compress: IOS_ATTACHMENT_JPEG_QUALITY,
        format: SaveFormat.JPEG,
    });

    const info = await getInfoAsync(converted.uri);
    if (!info.exists || info.isDirectory || !Number.isFinite(info.size) || info.size <= 0) {
        throw new Error('Could not determine normalized image size');
    }

    return {
        uri: converted.uri,
        width: converted.width || asset.width,
        height: converted.height || asset.height,
        mimeType: 'image/jpeg',
        name: withJpegExtension(asset.fileName),
        size: info.size,
    };
}

export function useImagePicker(options: UseImagePickerOptions = {}): UseImagePickerResult {
    const [uncontrolledImages, setUncontrolledImages] = useState<AttachmentPreview[]>([]);
    const controlled = options.images !== undefined;
    const selectedImages = controlled ? options.images! : uncontrolledImages;
    const imagesRef = useRef(selectedImages);
    const onChangeRef = useRef(options.onChange);
    useEffect(() => {
        imagesRef.current = selectedImages;
        onChangeRef.current = options.onChange;
    }, [options.onChange, selectedImages]);

    const updateImages = useCallback((update: (current: AttachmentPreview[]) => AttachmentPreview[]) => {
        const next = update(imagesRef.current);
        imagesRef.current = next;
        if (controlled) {
            onChangeRef.current?.(next);
        } else {
            setUncontrolledImages(next);
        }
    }, [controlled]);
    const requestPermission = useCallback(async (): Promise<boolean> => {
        if (Platform.OS === 'web') return true;

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Modal.alert(
                t('imageUpload.permissionTitle'),
                t('imageUpload.permissionMessage'),
                [{ text: t('common.ok') }],
            );
            return false;
        }
        return true;
    }, []);

    const selectImages = useCallback(async (maximumImages: number, maximumBytes: number) => {
        const hasPermission = await requestPermission();
        if (!hasPermission) return [];

        const remaining = Math.min(MAX_IMAGES_PER_MESSAGE, Math.max(0, maximumImages));
        if (remaining <= 0) {
            Modal.alert(
                t('imageUpload.limitTitle'),
                t('imageUpload.limitMessage', { max: MAX_IMAGES_PER_MESSAGE }),
                [{ text: t('common.ok') }],
            );
            return [];
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'], // expo-image-picker ~55: MediaTypeOptions deprecated
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            quality: 1, // request full-resolution source; iOS upload is normalized below
            exif: false,
        });

        if (result.canceled || !result.assets.length) return [];

        // On web, selectionLimit is not enforced by the browser — clamp here.
        const assets = result.assets.slice(0, remaining);
        const previews: AttachmentPreview[] = [];

        for (const asset of assets) {
            let normalized: Awaited<ReturnType<typeof normalizePickedAssetForUpload>>;
            try {
                normalized = await normalizePickedAssetForUpload(asset);
            } catch {
                Modal.alert(
                    t('imageUpload.uploadFailedTitle'),
                    t('imageUpload.uploadFailedMessage', { count: 1 }),
                    [{ text: t('common.ok') }],
                );
                continue;
            }
            const size = normalized.size;
            // Inline blobs add a nonce/tag; machine Workspace uploads are raw.
            const maxSize = maximumBytes - (Platform.OS === 'ios' && maximumBytes === MAX_FILE_SIZE ? 40 : 0);

            if (size > maxSize) {
                Modal.alert(
                    t('imageUpload.fileTooLargeTitle'),
                    t('imageUpload.fileTooLargeMessage', {
                        name: asset.fileName ?? 'image',
                        maxMb: Math.floor(maximumBytes / (1024 * 1024)),
                    }),
                    [{ text: t('common.ok') }],
                );
                continue;
            }

            // Skip thumbhash if dimensions are unavailable (prevents divide-by-zero).
            const thumbhash = (normalized.width > 0 && normalized.height > 0)
                ? await generateThumbhash(normalized.uri, normalized.width, normalized.height)
                : undefined;

            previews.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                uri: normalized.uri,
                width: normalized.width,
                height: normalized.height,
                mimeType: normalized.mimeType,
                size,
                name: normalized.name,
                thumbhash,
            });
        }

        return previews;
    }, [requestPermission]);

    const pickImages = useCallback(async () => {
        const previews = await selectImages(
            MAX_IMAGES_PER_MESSAGE - imagesRef.current.length,
            MAX_FILE_SIZE,
        );
        if (previews.length > 0) {
            updateImages(prev => [...prev, ...previews].slice(0, MAX_IMAGES_PER_MESSAGE));
        }
        return previews;
    }, [selectImages, updateImages]);

    const pickImagesForUpload = useCallback(
        (maxImages = MAX_IMAGES_PER_MESSAGE) => selectImages(maxImages, MAX_WORKSPACE_UPLOAD_BYTES),
        [selectImages],
    );

    const removeImage = useCallback((id: string) => {
        updateImages(prev => prev.filter(img => img.id !== id));
    }, [updateImages]);

    const clearImages = useCallback(() => {
        updateImages(() => []);
    }, [updateImages]);

    const addImages = useCallback((images: AttachmentPreview[]) => {
        updateImages(prev => {
            const remaining = MAX_IMAGES_PER_MESSAGE - prev.length;
            if (remaining <= 0) return prev;
            return [...prev, ...images.slice(0, remaining)];
        });
    }, [updateImages]);

    return { selectedImages, pickImages, pickImagesForUpload, removeImage, clearImages, addImages };
}
