import { Image } from 'expo-image';
import {
    detectHappyHerdCommanderAvatarMimeType,
    MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES,
    MAX_WORKSPACE_UPLOAD_BYTES,
    type HappyHerdCommanderAvatarMimeType,
    type HappyHerdCommanderSummary,
    type WorkspaceFileHashResponse,
    type WorkspaceUploadRequest,
    type WorkspaceUploadResponse,
} from '@slopus/happy-wire';

import { encodeBase64 } from '@/encryption/base64';
import { invalidateCommanderAvatarCache } from '@/hooks/useCommanderAvatar';
import { machineHashFile, machineUploadFile } from '@/sync/ops';

export type CommanderAvatarUploadErrorCode =
    | 'empty'
    | 'too-large'
    | 'invalid-format'
    | 'invalid-target'
    | 'stale'
    | 'runtime-unsupported'
    | 'upload-failed';

export class CommanderAvatarUploadError extends Error {
    constructor(
        readonly code: CommanderAvatarUploadErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'CommanderAvatarUploadError';
    }
}

type CommanderAvatarUploadDependencies = {
    hashFile: (machineId: string, path: string, maxBytes: number) => Promise<WorkspaceFileHashResponse>;
    decodeImage: (content: Uint8Array, mimeType: HappyHerdCommanderAvatarMimeType) => Promise<void>;
    uploadFile: (machineId: string, request: WorkspaceUploadRequest) => Promise<WorkspaceUploadResponse>;
    invalidate: (machineId: string, commanderId: string) => void;
};

const defaultDependencies: CommanderAvatarUploadDependencies = {
    hashFile: machineHashFile,
    decodeImage: async (content, mimeType) => {
        const decoded = await Image.loadAsync({
            uri: `data:${mimeType};base64,${encodeBase64(content)}`,
        });
        try {
            if (!(decoded.width > 0) || !(decoded.height > 0)) {
                throw new Error('Decoded image has no pixels');
            }
        } finally {
            decoded.release();
        }
    },
    uploadFile: machineUploadFile,
    invalidate: invalidateCommanderAvatarCache,
};

export function commanderAvatarDirectory(commander: HappyHerdCommanderSummary): string {
    const ownerPath = commander.avatar?.path ?? commander.commanderPath;
    const separatorIndex = Math.max(ownerPath.lastIndexOf('/'), ownerPath.lastIndexOf('\\'));
    if (separatorIndex <= 0) {
        throw new CommanderAvatarUploadError('invalid-target', 'Commander profile path is invalid');
    }
    return ownerPath.slice(0, separatorIndex);
}

export function commanderAvatarPath(commander: HappyHerdCommanderSummary): string {
    const directory = commanderAvatarDirectory(commander);
    const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/';
    return `${directory}${separator}avatar.png`;
}

export async function uploadCommanderAvatar(
    machineId: string,
    commander: HappyHerdCommanderSummary,
    content: Uint8Array,
    dependencies: CommanderAvatarUploadDependencies = defaultDependencies,
): Promise<HappyHerdCommanderSummary> {
    if (content.byteLength === 0) {
        throw new CommanderAvatarUploadError('empty', 'Commander profile picture is empty');
    }
    if (content.byteLength > MAX_HAPPYHERD_COMMANDER_AVATAR_BYTES) {
        throw new CommanderAvatarUploadError('too-large', 'Commander profile picture exceeds 2 MiB');
    }
    const mimeType = detectHappyHerdCommanderAvatarMimeType(content);
    if (!mimeType) {
        throw new CommanderAvatarUploadError('invalid-format', 'Commander profile picture must be PNG, JPEG, or WebP');
    }
    try {
        await dependencies.decodeImage(content, mimeType);
    } catch {
        throw new CommanderAvatarUploadError('invalid-format', 'Commander profile picture could not be decoded');
    }

    const targetPath = commanderAvatarPath(commander);
    const current = await dependencies.hashFile(machineId, targetPath, MAX_WORKSPACE_UPLOAD_BYTES);
    if (!current.success) {
        const code: CommanderAvatarUploadErrorCode = current.code === 'unavailable'
            ? 'runtime-unsupported'
            : current.code === 'not-regular' || current.code === 'invalid-path' || current.code === 'too-large'
                ? 'invalid-target'
                : 'upload-failed';
        throw new CommanderAvatarUploadError(code, current.error ?? 'Failed to inspect Commander profile picture');
    }
    const currentHash = current.exists ? current.hash : undefined;
    if (commander.avatar?.sha256 && currentHash !== commander.avatar.sha256) {
        throw new CommanderAvatarUploadError('stale', 'Commander profile picture changed before replacement');
    }
    const expectedHash = currentHash;

    const response = await dependencies.uploadFile(machineId, {
        directory: commanderAvatarDirectory(commander),
        fileName: 'avatar.png',
        content: encodeBase64(content),
        ...(expectedHash ? { expectedHash } : {}),
    });
    if (
        !response.success
        || response.path !== targetPath
        || response.size !== content.byteLength
        || !response.hash?.match(/^[a-f0-9]{64}$/)
    ) {
        const code: CommanderAvatarUploadErrorCode = response.code === 'conflict'
            ? 'stale'
            : response.code === 'too-large'
                ? 'too-large'
                : 'upload-failed';
        throw new CommanderAvatarUploadError(code, response.error ?? 'Failed to update Commander profile picture');
    }

    dependencies.invalidate(machineId, commander.id);
    return {
        ...commander,
        avatar: {
            path: response.path,
            mimeType,
            byteLength: content.byteLength,
            sha256: response.hash,
        },
    };
}
