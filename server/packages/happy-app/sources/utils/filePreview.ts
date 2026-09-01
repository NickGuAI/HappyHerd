export type FilePreviewKind = 'image' | 'pdf' | 'html' | 'text' | 'unsupported';

export type EditableText = {
    content: string;
    hasUtf8Bom: boolean;
};

/**
 * Keep this as a plain style object. Expo Image does not resolve the
 * react-native-unistyles proxy on web, which otherwise leaves the decoded
 * image at 0×0 even though its surrounding preview pane has space.
 */
export const imagePreviewLayout = {
    width: '100%',
    height: '100%',
    minHeight: 240,
    flex: 1,
} as const;

const IMAGE_MIME_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
};

function extension(filePath: string): string {
    return filePath.split('.').pop()?.toLowerCase() ?? '';
}

export function imageMimeType(filePath: string): string | null {
    return IMAGE_MIME_TYPES[extension(filePath)] ?? null;
}

export function classifyFilePreview(filePath: string): FilePreviewKind {
    const ext = extension(filePath);
    if (IMAGE_MIME_TYPES[ext]) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'html' || ext === 'htm') return 'html';
    return 'text';
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
    return bytes.length >= signature.length
        && signature.every((byte, index) => bytes[index] === byte);
}

export function isSvgDocument(content: string): boolean {
    return /<svg(?:\s|>)/iu.test(content);
}

/**
 * Confirm that a filename-selected rich preview matches the actual bytes.
 * This keeps misleading image/PDF extensions from bypassing text editing.
 */
export function matchesRichPreviewContent(filePath: string, bytes: Uint8Array): boolean {
    const kind = classifyFilePreview(filePath);
    if (kind === 'pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    if (kind !== 'image') return false;

    const mime = imageMimeType(filePath);
    if (mime === 'image/svg+xml') {
        const decoded = decodeEditableText(bytes);
        return decoded !== null && isSvgDocument(decoded.content);
    }
    // GIF, WebP, and BMP begin with printable ASCII. A signature alone must
    // not override content that already satisfies the editable-text policy.
    if (decodeEditableText(bytes) !== null) return false;

    switch (mime) {
        case 'image/png':
            return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        case 'image/jpeg':
            return startsWith(bytes, [0xff, 0xd8, 0xff]);
        case 'image/gif':
            return startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
                || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
        case 'image/webp':
            return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
                && bytes.length >= 12
                && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]);
        case 'image/bmp':
            return startsWith(bytes, [0x42, 0x4d]);
        case 'image/x-icon':
            return startsWith(bytes, [0x00, 0x00, 0x01, 0x00]);
        default:
            return false;
    }
}

const UTF8_BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);

/**
 * Decode a candidate text file without allowing replacement characters to
 * silently corrupt its bytes. File names only select richer previews; whether
 * every other regular file is editable is decided from its content.
 */
export function decodeEditableText(bytes: Uint8Array): EditableText | null {
    const hasUtf8Bom = bytes.length >= UTF8_BOM.length
        && UTF8_BOM.every((byte, index) => bytes[index] === byte);
    const contentBytes = hasUtf8Bom ? bytes.subarray(UTF8_BOM.length) : bytes;

    let content: string;
    try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(contentBytes);
    } catch {
        return null;
    }

    if (contentBytes.some((byte) => byte === 0)) return null;

    const nonPrintableCount = Array.from(content).filter((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13;
    }).length;
    if (content.length > 0 && nonPrintableCount / content.length > 0.1) return null;

    return { content, hasUtf8Bom };
}

/** Re-encode editor text while preserving whether the original file used a UTF-8 BOM. */
export function encodeEditableText(content: string, hasUtf8Bom: boolean): Uint8Array {
    const encoded = new TextEncoder().encode(content);
    if (!hasUtf8Bom) return encoded;

    const withBom = new Uint8Array(UTF8_BOM.length + encoded.length);
    withBom.set(UTF8_BOM);
    withBom.set(encoded, UTF8_BOM.length);
    return withBom;
}

export function imageDataUri(filePath: string, base64: string): string {
    const mime = imageMimeType(filePath);
    if (!mime) throw new Error(`Unsupported image type: ${filePath}`);
    return `data:${mime};base64,${base64}`;
}

export function pdfDataUri(base64: string): string {
    return `data:application/pdf;base64,${base64}`;
}

/**
 * HTML previews need an opaque, scriptless iframe. Chrome's built-in PDF
 * viewer is an extension-backed document viewer, however, and an empty iframe
 * sandbox prevents that viewer from loading. Keep the exception constrained
 * to PDFs so HTML never inherits the relaxed embed policy.
 */
export function documentPreviewWebSandbox(
    kind: 'html' | 'pdf',
    interactive = false,
): '' | 'allow-scripts' | undefined {
    if (kind === 'pdf') return undefined;
    return interactive ? 'allow-scripts' : '';
}

const HTML_PREVIEW_CSP = [
    "default-src 'none'",
    "script-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "style-src 'unsafe-inline'",
].join('; ');

const INTERACTIVE_HTML_PREVIEW_CSP = HTML_PREVIEW_CSP.replace(
    "script-src 'none'",
    "script-src 'unsafe-inline'",
);

function htmlPreviewDocument(source: string, csp: string): string {
    const withoutNavigation = source
        .replace(/<base\b[^>]*>/gi, '')
        .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
        .replace(/\s(?:href|action|formaction|target)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const guard = `<meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">`;
    if (/<head(?:\s[^>]*)?>/i.test(withoutNavigation)) {
        return withoutNavigation.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${guard}`);
    }
    return `<!doctype html><html><head>${guard}</head><body>${withoutNavigation}</body></html>`;
}

/**
 * Wrap local HTML for an unprivileged preview. The iframe/WebView supplies a
 * second sandbox boundary; this document-level policy blocks scripts, forms,
 * nested frames, remote subresources, and popup/navigation targets.
 */
export function safeHtmlPreviewDocument(source: string): string {
    return htmlPreviewDocument(source, HTML_PREVIEW_CSP);
}

/**
 * Build the explicitly selected interactive view. It keeps the same local
 * document boundary as Preview while allowing the file's inline scripts to
 * drive its own DOM.
 */
export function interactiveHtmlPreviewDocument(source: string): string {
    return htmlPreviewDocument(source, INTERACTIVE_HTML_PREVIEW_CSP);
}
