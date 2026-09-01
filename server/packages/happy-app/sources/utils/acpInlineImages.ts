import type { Message } from '@/sync/typesMessage';
import {
    imageDataUri,
    imageMimeType,
    matchesRichPreviewContent,
} from './filePreview';

export type AcpInlineImageOverrides = Readonly<{
    sources: ReadonlyMap<string, string>;
    suppressed: ReadonlySet<string>;
}>;

const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INLINE_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_INLINE_IMAGE_BYTES / 3);

type GeneratedImage = {
    pseudoPath: string;
    providerPath: string;
    completedAt: number;
};

type ReadImage = {
    providerPath: string;
    dataUri: string;
    startedAt: number;
    completedAt: number;
};

type AttachedImage = { pseudoPath: string };

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function hasSafeRelativeSegments(value: unknown): value is string {
    if (
        typeof value !== 'string'
        || value.length === 0
        || value.length > 255
        || value.startsWith('/')
        || value.includes('\\')
        || value.includes('?')
        || value.includes('#')
    ) return false;
    const segments = value.split('/');
    return !segments.some((segment) => (
        segment.length === 0
        || segment === '.'
        || segment === '..'
        || !/^[a-zA-Z0-9._-]+$/.test(segment)
    ));
}

function safeRelativeImagePath(value: unknown, mimeType?: 'image/png' | 'image/jpeg'): string | null {
    if (!hasSafeRelativeSegments(value)) return null;
    const detectedMimeType = imageMimeType(value);
    if (detectedMimeType !== 'image/png' && detectedMimeType !== 'image/jpeg') return null;
    return mimeType === undefined || detectedMimeType === mimeType ? value : null;
}

function safePseudoPath(sessionFolder: unknown, filename: unknown): string | null {
    if (typeof sessionFolder !== 'string' || typeof filename !== 'string') return null;
    if (!hasSafeRelativeSegments(sessionFolder) || !/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
    if (filename === '.' || filename === '..') return null;
    return safeRelativeImagePath(`${sessionFolder}/${filename}`);
}

function decodeValidatedImage(pseudoPath: string, value: unknown): string | null {
    const imageContent = record(value);
    if (!imageContent || typeof imageContent.data !== 'string') return null;
    if (
        imageContent.mime_type !== undefined
        && imageContent.mimeType !== undefined
        && imageContent.mime_type !== imageContent.mimeType
    ) return null;
    const mimeType = imageContent.mime_type ?? imageContent.mimeType;
    if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return null;
    if (imageMimeType(pseudoPath) !== mimeType) return null;
    const base64 = imageContent.data;
    if (
        base64.length === 0
        || base64.length > MAX_INLINE_IMAGE_BASE64_LENGTH
        || base64.length % 4 !== 0
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    ) return null;

    let bytes: Uint8Array;
    try {
        bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
    if (bytes.length > MAX_INLINE_IMAGE_BYTES || !matchesRichPreviewContent(pseudoPath, bytes)) return null;
    return imageDataUri(pseudoPath, base64);
}

function generatedImage(message: Message): GeneratedImage | null {
    if (message.kind !== 'tool-call' || message.tool.state !== 'completed') return null;
    const input = record(message.tool.input);
    const result = record(message.tool.result);
    if (input?.variant !== 'ImageEdit' || result?.type !== 'ImageEdit') return null;
    if (typeof result.path !== 'string' || result.path.length === 0 || typeof message.tool.completedAt !== 'number') return null;
    const pseudoPath = safePseudoPath(result.session_folder, result.filename);
    return pseudoPath
        ? { pseudoPath, providerPath: result.path, completedAt: message.tool.completedAt }
        : null;
}

function readImage(message: Message, pseudoPathsByProviderPath: ReadonlyMap<string, ReadonlySet<string>>): ReadImage | null {
    if (message.kind !== 'tool-call' || message.tool.state !== 'completed') return null;
    const input = record(message.tool.input);
    const result = record(message.tool.result);
    if (input?.variant !== 'ReadFile' || result?.type !== 'ReadFile') return null;
    if (
        typeof input.target_file !== 'string'
        || typeof message.tool.startedAt !== 'number'
        || typeof message.tool.completedAt !== 'number'
    ) return null;
    const pseudoPaths = pseudoPathsByProviderPath.get(input.target_file);
    if (!pseudoPaths || pseudoPaths.size !== 1) return null;
    const [pseudoPath] = pseudoPaths;
    const dataUri = decodeValidatedImage(pseudoPath, result.ImageContent);
    return dataUri ? {
        providerPath: input.target_file,
        dataUri,
        startedAt: message.tool.startedAt,
        completedAt: message.tool.completedAt,
    } : null;
}

function attachedImage(message: Message): AttachedImage | null {
    if (message.kind !== 'tool-call' || message.tool.name !== 'file' || message.tool.state !== 'completed') return null;
    const input = record(message.tool.input);
    if (typeof input?.name !== 'string') return null;
    const mimeType = input.mimeType;
    if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') return null;
    const pseudoPath = safeRelativeImagePath(input.name, mimeType);
    return pseudoPath ? { pseudoPath } : null;
}

/**
 * Recover only Grok provider-session images whose same-turn tool lifecycle
 * proves the complete pseudo-path -> provider-path -> image-bytes chain.
 */
export function resolveAcpInlineImages(
    messages: readonly Message[],
    flavor: string | null | undefined,
): ReadonlyMap<string, AcpInlineImageOverrides> {
    if (flavor !== 'grok') return new Map();

    const byTurn = new Map<string, Message[]>();
    for (const message of messages) {
        if ((message.kind !== 'agent-text' && message.kind !== 'tool-call') || !message.turn) continue;
        const turnMessages = byTurn.get(message.turn) ?? [];
        turnMessages.push(message);
        byTurn.set(message.turn, turnMessages);
    }

    const resolved = new Map<string, AcpInlineImageOverrides>();
    for (const turnMessages of byTurn.values()) {
        const generated = turnMessages.map(generatedImage).filter((item): item is GeneratedImage => item !== null);
        const pseudoPathsByProviderPath = new Map<string, Set<string>>();
        for (const item of generated) {
            const pseudoPaths = pseudoPathsByProviderPath.get(item.providerPath) ?? new Set<string>();
            pseudoPaths.add(item.pseudoPath);
            pseudoPathsByProviderPath.set(item.providerPath, pseudoPaths);
        }
        const reads = turnMessages
            .map((message) => readImage(message, pseudoPathsByProviderPath))
            .filter((item): item is ReadImage => item !== null);
        const attachments = turnMessages
            .map(attachedImage)
            .filter((item): item is AttachedImage => item !== null);

        for (const textMessage of turnMessages) {
            if (textMessage.kind !== 'agent-text' || textMessage.isThinking) continue;
            const sources = new Map<string, string>();
            const suppressed = new Set<string>();
            const pseudoPaths = new Set([
                ...generated.map((item) => item.pseudoPath),
                ...attachments.map((item) => item.pseudoPath),
            ]);
            for (const pseudoPath of pseudoPaths) {
                if (attachments.some((item) => item.pseudoPath === pseudoPath)) {
                    suppressed.add(pseudoPath);
                    continue;
                }

                const edits = generated.filter((item) => (
                    item.pseudoPath === pseudoPath && item.completedAt <= textMessage.createdAt
                ));
                const providerPaths = new Set(edits.map((item) => item.providerPath));
                if (providerPaths.size !== 1) continue;
                const [providerPath] = providerPaths;
                const editCompletedAt = Math.max(...edits.map((item) => item.completedAt));
                const matchingReads = reads.filter((item) => (
                    item.providerPath === providerPath
                    && editCompletedAt <= item.startedAt
                    && item.completedAt <= textMessage.createdAt
                ));
                const dataUris = new Set(matchingReads.map((item) => item.dataUri));
                if (dataUris.size === 1) sources.set(pseudoPath, [...dataUris][0]);
            }
            if (sources.size > 0 || suppressed.size > 0) {
                resolved.set(textMessage.id, { sources, suppressed });
            }
        }
    }

    return resolved;
}
