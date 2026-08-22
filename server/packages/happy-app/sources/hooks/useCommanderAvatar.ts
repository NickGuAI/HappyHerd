import * as React from 'react';
import * as Crypto from 'expo-crypto';
import {
    detectHappyHerdCommanderAvatarMimeType,
    type HappyHerdCommanderListResponse,
} from '@slopus/happy-wire';

import { machineListCommanders, machineReadFile } from '@/sync/ops';

type CommanderAvatarDependencies = {
    listCommanders: (machineId: string) => Promise<HappyHerdCommanderListResponse>;
    readFile: (machineId: string, path: string) => Promise<{
        success: boolean;
        content?: string;
        error?: string;
    }>;
    sha256: (content: Uint8Array) => Promise<string>;
};

const defaultDependencies: CommanderAvatarDependencies = {
    listCommanders: machineListCommanders,
    readFile: machineReadFile,
    sha256: async (content) => {
        // TS models an arbitrary Uint8Array view as potentially backed by a
        // SharedArrayBuffer, while Expo's native/web digest contract accepts
        // only a transferable BufferSource. Copy into an owned ArrayBuffer so
        // both the type and byte range are exact on every platform.
        const digestInput = new Uint8Array(content.byteLength);
        digestInput.set(content);
        const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, digestInput.buffer);
        return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
};

const commanderLists = new Map<string, Promise<HappyHerdCommanderListResponse>>();
const avatarImages = new Map<string, Promise<string | null>>();
const avatarCacheVersions = new Map<string, number>();
const avatarCacheListeners = new Set<() => void>();

function avatarIdentity(machineId: string, commanderId: string): string {
    return `${machineId}\u0000${commanderId}`;
}

export function invalidateCommanderAvatarCache(machineId: string, commanderId: string): void {
    commanderLists.delete(machineId);
    const identity = avatarIdentity(machineId, commanderId);
    const imagePrefix = `${identity}\u0000`;
    for (const cacheKey of avatarImages.keys()) {
        if (cacheKey.startsWith(imagePrefix)) avatarImages.delete(cacheKey);
    }
    avatarCacheVersions.set(identity, (avatarCacheVersions.get(identity) ?? 0) + 1);
    avatarCacheListeners.forEach((listener) => listener());
}

function commanderList(
    machineId: string,
    dependencies: CommanderAvatarDependencies,
): Promise<HappyHerdCommanderListResponse> {
    const existing = commanderLists.get(machineId);
    if (existing) return existing;
    const pending = dependencies.listCommanders(machineId).catch((error) => {
        commanderLists.delete(machineId);
        throw error;
    });
    commanderLists.set(machineId, pending);
    return pending;
}

function decodeBase64(base64: string): Uint8Array | null {
    if (
        base64.length === 0
        || base64.length % 4 !== 0
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    ) {
        return null;
    }
    try {
        return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

export async function loadCommanderAvatar(
    machineId: string | null,
    commanderId: string | null,
    dependencies: CommanderAvatarDependencies = defaultDependencies,
): Promise<string | null> {
    if (!machineId || !commanderId) return null;
    let commanderResponse: HappyHerdCommanderListResponse;
    try {
        commanderResponse = await commanderList(machineId, dependencies);
    } catch {
        return null;
    }
    const summary = commanderResponse.commanders.find((candidate) => candidate.id === commanderId);
    if (!summary?.avatar) return null;

    const { avatar } = summary;
    const cacheKey = `${machineId}\u0000${commanderId}\u0000${avatar.sha256}`;
    const existing = avatarImages.get(cacheKey);
    if (existing) return existing;

    let descriptorInvalid = false;
    const pending = dependencies.readFile(machineId, avatar.path)
        .then(async (result) => {
            if (!result.success || !result.content) return null;
            const content = decodeBase64(result.content);
            if (
                !content
                || content.byteLength !== avatar.byteLength
                || detectHappyHerdCommanderAvatarMimeType(content) !== avatar.mimeType
                || (await dependencies.sha256(content)) !== avatar.sha256
            ) {
                descriptorInvalid = true;
                return null;
            }
            return `data:${avatar.mimeType};base64,${result.content}`;
        })
        .catch(() => null);
    avatarImages.set(cacheKey, pending);
    void pending.then((result) => {
        if (result === null && avatarImages.get(cacheKey) === pending) {
            avatarImages.delete(cacheKey);
        }
        if (descriptorInvalid) commanderLists.delete(machineId);
    });
    return pending;
}

export function resetCommanderAvatarCacheForTests(): void {
    commanderLists.clear();
    avatarImages.clear();
    avatarCacheVersions.clear();
    avatarCacheListeners.forEach((listener) => listener());
}

export function useCommanderAvatar(
    machineId: string | null,
    commanderId: string | null,
): string | null {
    const [imageUrl, setImageUrl] = React.useState<string | null>(null);
    const identity = machineId && commanderId ? avatarIdentity(machineId, commanderId) : null;
    const subscribe = React.useCallback((listener: () => void) => {
        avatarCacheListeners.add(listener);
        return () => avatarCacheListeners.delete(listener);
    }, []);
    const getSnapshot = React.useCallback(
        () => identity ? (avatarCacheVersions.get(identity) ?? 0) : 0,
        [identity],
    );
    const cacheVersion = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    React.useEffect(() => {
        let active = true;
        setImageUrl(null);
        void loadCommanderAvatar(machineId, commanderId).then(
            (nextImageUrl) => {
                if (active) setImageUrl(nextImageUrl);
            },
            () => {
                if (active) setImageUrl(null);
            },
        );
        return () => {
            active = false;
        };
    }, [cacheVersion, commanderId, machineId]);

    return imageUrl;
}
