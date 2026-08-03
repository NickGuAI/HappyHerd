export type FilePreviewKind = 'image' | 'pdf' | 'html' | 'text' | 'unsupported';

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

const UNSUPPORTED_BINARY_EXTENSIONS = new Set([
    'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm',
    'mp3', 'wav', 'flac', 'aac', 'ogg',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'tar', 'gz', 'rar', '7z',
    'exe', 'dmg', 'deb', 'rpm',
    'woff', 'woff2', 'ttf', 'otf',
    'db', 'sqlite', 'sqlite3',
]);

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
    if (UNSUPPORTED_BINARY_EXTENSIONS.has(ext)) return 'unsupported';
    return 'text';
}

export function imageDataUri(filePath: string, base64: string): string {
    const mime = imageMimeType(filePath);
    if (!mime) throw new Error(`Unsupported image type: ${filePath}`);
    return `data:${mime};base64,${base64}`;
}

export function pdfDataUri(base64: string): string {
    return `data:application/pdf;base64,${base64}`;
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

/**
 * Wrap local HTML for an unprivileged preview. The iframe/WebView supplies a
 * second sandbox boundary; this document-level policy blocks scripts, forms,
 * nested frames, remote subresources, and popup/navigation targets.
 */
export function safeHtmlPreviewDocument(source: string): string {
    const withoutNavigation = source
        .replace(/<base\b[^>]*>/gi, '')
        .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
        .replace(/\s(?:href|action|formaction|target)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const guard = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><base target="_blank">`;
    if (/<head(?:\s[^>]*)?>/i.test(withoutNavigation)) {
        return withoutNavigation.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${guard}`);
    }
    return `<!doctype html><html><head>${guard}</head><body>${withoutNavigation}</body></html>`;
}
