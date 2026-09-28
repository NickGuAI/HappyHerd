import { resolveAbsolutePath } from './pathUtils';

/** New Session path identity: expand the selected machine's home and trim separators. */
export function normalizeMachinePath(path: string, homeDir?: string): string | null {
    const trimmed = path.trim();
    if (!trimmed) return null;
    const resolved = resolveAbsolutePath(trimmed, homeDir);
    if (resolved === '/' || /^[A-Za-z]:[\\/]?$/.test(resolved)) return resolved;
    return resolved.replace(/[\\/]+$/, '');
}
