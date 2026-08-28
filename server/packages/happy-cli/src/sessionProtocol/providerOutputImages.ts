import type { RawJSONLines } from '@/claude/types';

export type ProviderOutputImage = {
    data: Uint8Array;
    mimeType: 'image/png' | 'image/jpeg';
    name: string;
};

type SupportedImage = Omit<ProviderOutputImage, 'name'> & { extension: 'png' | 'jpg' };

function decodeBase64Image(value: unknown): SupportedImage | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    const raw = value.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/s)?.[2] ?? value;
    let bytes: Buffer;
    try {
        bytes = Buffer.from(raw, 'base64');
    } catch {
        return null;
    }
    if (bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a) {
        return { data: new Uint8Array(bytes), mimeType: 'image/png', extension: 'png' };
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return { data: new Uint8Array(bytes), mimeType: 'image/jpeg', extension: 'jpg' };
    }
    return null;
}

function safeNamePart(value: unknown): string {
    return typeof value === 'string'
        ? value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'output'
        : 'output';
}

function imageFromMcpBlock(block: unknown): SupportedImage | null {
    if (!block || typeof block !== 'object') return null;
    const record = block as Record<string, unknown>;
    if (record.type === 'image') {
        return decodeBase64Image(record.data);
    }
    if (record.type === 'inputImage') {
        return decodeBase64Image(record.imageUrl);
    }
    return null;
}

function extractClaudeAgentOutputImagesFromBlock(block: unknown): ProviderOutputImage[] {
    if (!block || typeof block !== 'object') return [];
    const record = block as Record<string, unknown>;
    const candidates: unknown[] = [];
    if (record.type === 'image') {
        candidates.push((record.source as Record<string, unknown> | undefined)?.data);
    }
    if (record.type === 'tool_result' && Array.isArray(record.content)) {
        for (const content of record.content) {
            if (!content || typeof content !== 'object') continue;
            const contentRecord = content as Record<string, unknown>;
            if (contentRecord.type === 'image') {
                candidates.push((contentRecord.source as Record<string, unknown> | undefined)?.data);
            }
        }
    }

    return candidates.flatMap((candidate, index) => {
        const image = decodeBase64Image(candidate);
        return image ? [{
            data: image.data,
            mimeType: image.mimeType,
            name: `claude-image-${index + 1}.${image.extension}`,
        }] : [];
    });
}

export function extractClaudeAgentOutputImages(message: RawJSONLines): ProviderOutputImage[] {
    const content = (message as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) return [];
    const images = content.flatMap((block) => {
        if (!block || typeof block !== 'object') return [];
        const blockType = (block as { type?: unknown }).type;
        const isAgentOutput = message.type === 'assistant'
            ? blockType === 'image'
            : message.type === 'user' && blockType === 'tool_result';
        return isAgentOutput ? extractClaudeAgentOutputImagesFromBlock(block) : [];
    });
    return images.map((image, index) => ({
        ...image,
        name: `claude-image-${index + 1}.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`,
    }));
}

export function extractCodexAgentOutputImages(item: unknown): ProviderOutputImage[] {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const candidates: SupportedImage[] = [];

    if (record.type === 'imageGeneration') {
        const decoded = decodeBase64Image(record.result);
        if (decoded) candidates.push(decoded);
    }

    if (record.type === 'mcpToolCall') {
        const result = record.result as Record<string, unknown> | undefined;
        if (Array.isArray(result?.content)) {
            for (const block of result.content) {
                const decoded = imageFromMcpBlock(block);
                if (decoded) candidates.push(decoded);
            }
        }
    }

    if (record.type === 'dynamicToolCall' && Array.isArray(record.contentItems)) {
        for (const block of record.contentItems) {
            const decoded = imageFromMcpBlock(block);
            if (decoded) candidates.push(decoded);
        }
    }

    const itemName = safeNamePart(record.id);
    return candidates.map((image, index) => ({
        data: image.data,
        mimeType: image.mimeType,
        name: `codex-image-${itemName}${candidates.length > 1 ? `-${index + 1}` : ''}.${image.extension}`,
    }));
}
