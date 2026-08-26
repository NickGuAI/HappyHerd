import { normalizeMarkdownLinkDestination } from './markdownLinkDestination';

export type SessionFileLink = {
    path: string;
    absolutePath: string;
    relativePath: string | null;
    withinSessionRoot: boolean;
    line: number | null;
    column: number | null;
};

export type SessionFileTextSegment = {
    text: string;
    link: SessionFileLink | null;
};

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const POSIX_ABSOLUTE_PATH = /^\//;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const HTTP_URL_WITH_AUTHORITY = /^https?:\/\//i;
const FILE_URL_PREFIX = /^file:\/\//i;
const RELATIVE_PREFIX = /^(?:\.{1,2}[\\/]|~[\\/])/;
const HAS_PATH_SEPARATOR = /[\\/]/;
const BARE_FILE_NAME = /^[^\\/\s]+\.[^\\/\s]+$/;
const NUMERIC_EXTENSION = /^\d+$/;
const FILE_EXTENSION = /^[A-Za-z0-9_-]{1,16}$/;
const EXTENSIONLESS_FILE_NAMES = new Set([
    'README',
    'LICENSE',
    'Makefile',
    'Dockerfile',
    '.gitignore',
    '.gitattributes',
    '.env',
    '.npmrc',
    '.yarnrc',
]);
const LEADING_WRAP = /^[([{<"'`]+/;
const TRAILING_WRAP = /[)\]}>",;!?`]+$/;
const APP_ROUTE_PREFIXES = ['/session/', '/text-selection', '/settings', '/auth'];
const SAFE_GIT_DIFF_PATH = /^[A-Za-z0-9._/ -]+$/u;

/**
 * Build the legacy shell-backed diff command only for a conservative path
 * alphabet that is inert in both POSIX and Windows double-quoted shells.
 * Files with other valid names remain editable; they simply skip the
 * best-effort diff until the RPC provides a structured argv operation.
 */
export function buildSessionFileGitDiffCommand(relativePath: string): string | null {
    if (
        relativePath === '.'
        || !SAFE_GIT_DIFF_PATH.test(relativePath)
        || relativePath.split('/').some((segment) => segment === '..')
    ) {
        return null;
    }
    return `git diff --no-ext-diff -- "${relativePath}"`;
}

function parseLineAndColumn(value: string): { path: string; line: number | null; column: number | null } {
    const trimmed = value.trim();
    const lineColumnMatch = trimmed.match(/^(.*):(\d+):(\d+)$/);
    if (lineColumnMatch) {
        return {
            path: lineColumnMatch[1],
            line: Number.parseInt(lineColumnMatch[2], 10),
            column: Number.parseInt(lineColumnMatch[3], 10),
        };
    }

    const lineMatch = trimmed.match(/^(.*):(\d+)$/);
    if (!lineMatch) {
        return {
            path: trimmed,
            line: null,
            column: null,
        };
    }

    return {
        path: lineMatch[1],
        line: Number.parseInt(lineMatch[2], 10),
        column: null,
    };
}

function pushTextSegment(segments: SessionFileTextSegment[], text: string) {
    if (!text) {
        return;
    }
    const last = segments[segments.length - 1];
    if (last && last.link === null) {
        last.text += text;
        return;
    }
    segments.push({ text, link: null });
}

function stripToken(value: string): { leading: string; core: string; trailing: string } {
    const leading = value.match(LEADING_WRAP)?.[0] ?? '';
    const withoutLeading = leading ? value.slice(leading.length) : value;
    const trailing = withoutLeading.match(TRAILING_WRAP)?.[0] ?? '';
    const core = trailing ? withoutLeading.slice(0, withoutLeading.length - trailing.length) : withoutLeading;
    return { leading, core, trailing };
}

function decodeFileUrl(value: string): string {
    if (!FILE_URL_PREFIX.test(value)) {
        return value;
    }
    const stripped = value.replace(FILE_URL_PREFIX, '');
    const normalized = stripped.startsWith('/') ? stripped : `/${stripped}`;
    try {
        return decodeURIComponent(normalized);
    } catch {
        return normalized;
    }
}

function decodeMarkdownPath(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function stripMarkdownUrlSuffix(value: string): string {
    const query = value.indexOf('?');
    const fragment = value.indexOf('#');
    const suffix = [query, fragment]
        .filter((index) => index >= 0)
        .reduce((first, index) => Math.min(first, index), value.length);
    return value.slice(0, suffix);
}

function usesWindowsPathSyntax(platform: string | null | undefined): boolean {
    return platform == null || platform === 'win32';
}

function isWindowsAbsolutePath(value: string, platform?: string | null): boolean {
    return usesWindowsPathSyntax(platform) && WINDOWS_ABSOLUTE_PATH.test(value);
}

function inferHomeDirectory(
    sessionRoot: string | null | undefined,
    platform?: string | null,
): string | null {
    if (!sessionRoot) {
        return null;
    }
    const normalizedRoot = normalizePath(sessionRoot, platform);
    const match = normalizedRoot.match(/^([A-Za-z]:\/Users\/[^/]+|\/Users\/[^/]+|\/home\/[^/]+)/);
    return match?.[1] ?? null;
}

function expandHomePath(
    value: string,
    sessionRoot: string | null | undefined,
    platform?: string | null,
    homeDir?: string | null,
): string {
    const hasPosixHomePrefix = value.startsWith('~/');
    const hasWindowsHomePrefix = platform === 'win32' && value.startsWith('~\\');
    if (!hasPosixHomePrefix && !hasWindowsHomePrefix) {
        return value;
    }
    const home = homeDir?.trim()
        ? normalizePath(homeDir, platform)
        : inferHomeDirectory(sessionRoot, platform);
    if (!home) {
        return value;
    }
    return `${home}/${value.slice(2)}`;
}

function normalizePath(value: string, platform?: string | null): string {
    const windowsPathSyntax = usesWindowsPathSyntax(platform);
    const withForwardSlashes = windowsPathSyntax
        ? value.replace(/\\/g, '/')
        : value;
    const isWindowsAbsolute = windowsPathSyntax && /^[A-Za-z]:\//.test(withForwardSlashes);
    const isWindowsUncAbsolute = windowsPathSyntax && withForwardSlashes.startsWith('//');
    const isPosixAbsolute = !isWindowsUncAbsolute && withForwardSlashes.startsWith('/');
    const prefix = isWindowsAbsolute
        ? `${withForwardSlashes.slice(0, 2)}/`
        : isWindowsUncAbsolute ? '//' : isPosixAbsolute ? '/' : '';
    const protectedRootDepth = isWindowsUncAbsolute ? 2 : 0;
    const rawRemainder = isWindowsAbsolute ? withForwardSlashes.slice(3) : isPosixAbsolute ? withForwardSlashes.replace(/^\/+/, '') : withForwardSlashes;

    const parts = rawRemainder.split('/');
    const normalizedParts: string[] = [];

    for (const part of parts) {
        if (!part || part === '.') {
            continue;
        }
        if (part === '..') {
            if (
                normalizedParts.length > protectedRootDepth
                && normalizedParts[normalizedParts.length - 1] !== '..'
            ) {
                normalizedParts.pop();
            } else if (!prefix) {
                normalizedParts.push(part);
            }
            continue;
        }
        normalizedParts.push(part);
    }

    if (!prefix) {
        return normalizedParts.join('/');
    }
    if (normalizedParts.length === 0) {
        return prefix;
    }
    return `${prefix}${normalizedParts.join('/')}`;
}

function resolvePath(
    path: string,
    sessionRoot: string | null | undefined,
    platform?: string | null,
    homeDir?: string | null,
): string | null {
    const expandedPath = expandHomePath(decodeFileUrl(path), sessionRoot, platform, homeDir);
    if (!expandedPath) {
        return null;
    }
    if (isWindowsAbsolutePath(expandedPath, platform) || POSIX_ABSOLUTE_PATH.test(expandedPath)) {
        return normalizePath(expandedPath, platform);
    }
    if (!sessionRoot) {
        return null;
    }
    return normalizePath(`${normalizePath(sessionRoot, platform)}/${expandedPath}`, platform);
}

function isWithinRoot(
    path: string,
    root: string | null | undefined,
    platform?: string | null,
): boolean {
    if (!root) {
        return false;
    }
    const normalizedPath = normalizePath(path, platform);
    const normalizedRoot = normalizePath(root, platform);
    const childPrefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(childPrefix);
}

function getRelativePath(
    path: string,
    root: string | null | undefined,
    platform?: string | null,
): string | null {
    if (!isWithinRoot(path, root, platform) || !root) {
        return null;
    }
    const normalizedPath = normalizePath(path, platform);
    const normalizedRoot = normalizePath(root, platform);
    if (normalizedPath === normalizedRoot) {
        return '.';
    }
    const childPrefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
    return normalizedPath.slice(childPrefix.length);
}

function looksLikeBareFileName(value: string): boolean {
    if (!BARE_FILE_NAME.test(value)) {
        return false;
    }
    const extension = value.split('.').pop() ?? '';
    return !NUMERIC_EXTENSION.test(extension);
}

function hasFileLikeEnding(value: string): boolean {
    const normalized = normalizePath(value);
    const basename = normalized.split('/').pop() ?? normalized;
    if (!basename) {
        return false;
    }
    if (EXTENSIONLESS_FILE_NAMES.has(basename)) {
        return true;
    }
    if (basename.startsWith('.')) {
        return basename.length > 1;
    }
    const lastDotIndex = basename.lastIndexOf('.');
    if (lastDotIndex <= 0 || lastDotIndex === basename.length - 1) {
        return false;
    }
    const extension = basename.slice(lastDotIndex + 1);
    if (!FILE_EXTENSION.test(extension)) {
        return false;
    }
    return !NUMERIC_EXTENSION.test(extension);
}

function isAppRoute(value: string): boolean {
    return APP_ROUTE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function looksLikePath(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    if (WINDOWS_ABSOLUTE_PATH.test(trimmed)) {
        return true;
    }
    if (POSIX_ABSOLUTE_PATH.test(trimmed)) {
        return !isAppRoute(trimmed);
    }
    if (RELATIVE_PREFIX.test(trimmed)) {
        return true;
    }
    if (HAS_PATH_SEPARATOR.test(trimmed)) {
        return true;
    }
    return looksLikeBareFileName(trimmed);
}

function buildLink(
    path: string,
    line: number | null,
    column: number | null,
    sessionRoot: string | null | undefined,
    platform?: string | null,
    homeDir?: string | null,
): SessionFileLink | null {
    const absolutePath = resolvePath(path, sessionRoot, platform, homeDir);
    if (!absolutePath) {
        return null;
    }
    return {
        path: normalizePath(path, platform),
        absolutePath,
        relativePath: getRelativePath(absolutePath, sessionRoot, platform),
        withinSessionRoot: isWithinRoot(absolutePath, sessionRoot, platform),
        line,
        column,
    };
}

export function resolveSessionFilePath(path: string, sessionRoot?: string | null): SessionFileLink | null {
    const parsed = parseLineAndColumn(path);
    return buildLink(parsed.path, parsed.line, parsed.column, sessionRoot);
}

/**
 * Resolve an explicit Markdown link target as a path on the originating
 * session's machine.
 *
 * Explicit links do not need the file-looking heuristics used when scanning
 * prose. This intentionally allows directory names such as `[docs](docs)`
 * while continuing to reject URL schemes and page-local navigation.
 */
export function parseExplicitSessionFileLink(
    url: string,
    options?: {
        label?: string | null;
        sessionRoot?: string | null;
        platform?: string | null;
        homeDir?: string | null;
    },
): SessionFileLink | null {
    const trimmedUrl = stripMarkdownUrlSuffix(
        normalizeMarkdownLinkDestination(url),
    );
    if (
        !trimmedUrl
        || trimmedUrl.startsWith('#')
        || trimmedUrl.startsWith('?')
    ) {
        return null;
    }

    const parsedUrl = parseLineAndColumn(trimmedUrl);
    const decodedPath = decodeMarkdownPath(parsedUrl.path);
    if (
        !isWindowsAbsolutePath(decodedPath, options?.platform)
        && (
            URL_SCHEME.test(parsedUrl.path)
            || HTTP_URL_WITH_AUTHORITY.test(decodedPath)
        )
    ) {
        return null;
    }
    const parsedLabel = options?.label ? parseLineAndColumn(options.label) : null;

    return buildLink(
        decodedPath,
        parsedUrl.line ?? parsedLabel?.line ?? null,
        parsedUrl.column ?? parsedLabel?.column ?? null,
        options?.sessionRoot,
        options?.platform,
        options?.homeDir,
    );
}

export function parseSessionFileLink(
    url: string,
    options?: { label?: string | null; sessionRoot?: string | null; bareText?: boolean }
): SessionFileLink | null {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
        return null;
    }

    if (!WINDOWS_ABSOLUTE_PATH.test(trimmedUrl) && URL_SCHEME.test(trimmedUrl)) {
        return null;
    }

    const parsedUrl = parseLineAndColumn(trimmedUrl);
    const parsedLabel = options?.label ? parseLineAndColumn(options.label) : null;

    if (!looksLikePath(parsedUrl.path) && !looksLikePath(parsedLabel?.path ?? '')) {
        return null;
    }

    if (options?.bareText) {
        const hasStrongSignal =
            parsedUrl.line !== null ||
            parsedUrl.column !== null ||
            hasFileLikeEnding(parsedUrl.path);
        if (!hasStrongSignal) {
            return null;
        }
    }

    return buildLink(
        parsedUrl.path,
        parsedUrl.line ?? parsedLabel?.line ?? null,
        parsedUrl.column ?? parsedLabel?.column ?? null,
        options?.sessionRoot,
    );
}

type TokenMatch = {
    start: number;
    end: number;
};

function looksLikePathStart(text: string): boolean {
    if (!text) {
        return false;
    }
    if (WINDOWS_ABSOLUTE_PATH.test(text)) {
        return true;
    }
    if (text.startsWith('/') || text.startsWith('~/') || text.startsWith('./') || text.startsWith('../')) {
        return true;
    }
    return HAS_PATH_SEPARATOR.test(text);
}

export function splitSessionFileText(text: string, sessionRoot?: string | null): SessionFileTextSegment[] {
    const segments: SessionFileTextSegment[] = [];
    const tokenPattern = /\S+/g;
    const tokens: TokenMatch[] = [];
    let match: RegExpExecArray | null;

    while ((match = tokenPattern.exec(text)) !== null) {
        tokens.push({ start: match.index, end: match.index + match[0].length });
    }

    let cursor = 0;
    let tokenIndex = 0;

    while (tokenIndex < tokens.length) {
        const token = tokens[tokenIndex];
        const tokenText = text.slice(token.start, token.end);
        const strippedStart = stripToken(tokenText).core;

        if (!looksLikePathStart(strippedStart)) {
            tokenIndex += 1;
            continue;
        }

        let bestEnd = -1;
        let bestLink: SessionFileLink | null = null;
        let bestLeading = '';
        let bestCore = '';
        let bestTrailing = '';

        for (let candidateIndex = tokenIndex; candidateIndex < tokens.length; candidateIndex += 1) {
            const candidate = text.slice(token.start, tokens[candidateIndex].end);
            const stripped = stripToken(candidate);
            if (!stripped.core) {
                continue;
            }

            const link = parseSessionFileLink(stripped.core, {
                sessionRoot,
                bareText: true,
            });

            if (link) {
                bestEnd = candidateIndex;
                bestLink = link;
                bestLeading = stripped.leading;
                bestCore = stripped.core;
                bestTrailing = stripped.trailing;
            }
        }

        if (bestEnd === -1 || !bestLink) {
            tokenIndex += 1;
            continue;
        }

        const end = tokens[bestEnd].end;
        pushTextSegment(segments, text.slice(cursor, token.start));
        pushTextSegment(segments, bestLeading);
        segments.push({ text: bestCore, link: bestLink });
        pushTextSegment(segments, bestTrailing);
        cursor = end;
        tokenIndex = bestEnd + 1;
    }

    if (cursor < text.length) {
        pushTextSegment(segments, text.slice(cursor));
    }

    return segments;
}
