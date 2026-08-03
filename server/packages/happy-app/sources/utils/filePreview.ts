export type FilePreviewKind = 'image' | 'text' | 'unsupported';

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
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
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
    if (UNSUPPORTED_BINARY_EXTENSIONS.has(ext)) return 'unsupported';
    return 'text';
}

export function imageDataUri(filePath: string, base64: string): string {
    const mime = imageMimeType(filePath);
    if (!mime) throw new Error(`Unsupported image type: ${filePath}`);
    return `data:${mime};base64,${base64}`;
}
