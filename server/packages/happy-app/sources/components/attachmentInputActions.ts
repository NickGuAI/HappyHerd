export type AttachmentInputAction = 'photos' | 'device-files';

export function availableAttachmentInputActions(options: {
    photos: boolean;
    deviceFiles: boolean;
}): AttachmentInputAction[] {
    return [
        ...(options.photos ? ['photos' as const] : []),
        ...(options.deviceFiles ? ['device-files' as const] : []),
    ];
}
