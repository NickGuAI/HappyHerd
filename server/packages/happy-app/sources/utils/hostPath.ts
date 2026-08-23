export function hostRoot(homeDir: string | undefined, platform: string | undefined): string {
    if (platform === 'win32') {
        const drive = homeDir?.match(/^([a-zA-Z]:)[\\/]/)?.[1];
        return drive ? `${drive}\\` : '\\';
    }
    return '/';
}

export function parentHostPath(path: string, platform: string | undefined): string {
    if (platform === 'win32') {
        const normalized = path.replace(/\//g, '\\').replace(/\\+$/, '');
        const driveRoot = normalized.match(/^([a-zA-Z]:)$/)?.[1];
        if (driveRoot) return `${driveRoot}\\`;
        if (normalized.startsWith('\\\\')) {
            const uncParts = normalized.slice(2).split('\\').filter(Boolean);
            if (uncParts.length <= 2) return normalized;
        }
        const index = normalized.lastIndexOf('\\');
        if (index <= 2) return normalized.slice(0, 2) + '\\';
        return normalized.slice(0, index);
    }
    const normalized = path.replace(/\/+$/, '') || '/';
    if (normalized === '/') return '/';
    const index = normalized.lastIndexOf('/');
    return index <= 0 ? '/' : normalized.slice(0, index);
}

export function joinHostPath(base: string, name: string, platform: string | undefined): string {
    if (platform === 'win32') {
        const normalizedBase = base.replace(/\//g, '\\').replace(/\\+$/, '');
        return `${normalizedBase}\\${name}`;
    }
    const normalizedBase = base.replace(/\/+$/, '') || '/';
    return normalizedBase === '/' ? `/${name}` : `${normalizedBase}/${name}`;
}
