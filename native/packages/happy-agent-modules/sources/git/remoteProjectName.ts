export function remoteProjectName(remote: string): string | undefined {
    const trimmed = remote.trim();
    if (trimmed.length === 0 || trimmed.startsWith("/") || trimmed.startsWith("./")) {
        return undefined;
    }
    try {
        let path: string;
        if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
            const url = new URL(trimmed);
            if (url.protocol !== "https:" && url.protocol !== "ssh:") return undefined;
            path = url.pathname;
        } else {
            const scp = /^(?:[^@/\s]+@)?[^:/\s]+:(.+)$/u.exec(trimmed);
            if (scp === null) return undefined;
            path = scp[1] ?? "";
        }
        const encoded = path.split("/").filter(Boolean).at(-1);
        if (encoded === undefined) return undefined;
        const decoded = decodeURIComponent(encoded)
            .replace(/\.git$/iu, "")
            .trim();
        return decoded.length === 0 ? undefined : decoded;
    } catch {
        return undefined;
    }
}
