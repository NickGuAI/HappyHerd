import { access, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Metadata } from '@/api/types';

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function codexHomeContainsThread(codexHome: string, threadId: string): Promise<boolean> {
    const rolloutSuffix = `-${threadId}.jsonl`;
    for (const directory of ['sessions', 'archived_sessions']) {
        try {
            const entries = await readdir(join(codexHome, directory), { recursive: true });
            if (entries.some((entry) => entry.endsWith(rolloutSuffix))) {
                return true;
            }
        } catch {
            // This optional Codex storage directory is absent or unreadable.
        }
    }
    return false;
}

async function legacyCodexHomes(homeDir: string): Promise<string[]> {
    const root = join(homeDir, '.herd', 'credential-pools', 'codex');
    try {
        const entries = await readdir(root, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(root, entry.name));
    } catch {
        return [];
    }
}

export async function resolveCodexHomeForResume(
    metadata: Pick<Metadata, 'codexHome' | 'codexThreadId' | 'homeDir'>,
    env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
    const savedCodexHome = metadata.codexHome?.trim();
    if (savedCodexHome) {
        const resolved = resolve(savedCodexHome);
        if (await pathExists(resolved)) {
            return resolved;
        }
    }

    const threadId = metadata.codexThreadId?.trim();
    if (!threadId) {
        return undefined;
    }

    const configuredCodexHome = env.CODEX_HOME?.trim();
    const currentCodexHome = resolve(configuredCodexHome || join(metadata.homeDir, '.codex'));
    const candidates = [currentCodexHome, ...await legacyCodexHomes(metadata.homeDir)];
    for (const candidate of candidates) {
        if (await codexHomeContainsThread(candidate, threadId)) {
            return candidate;
        }
    }
    return undefined;
}
