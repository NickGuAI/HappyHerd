import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Metadata } from '@/api/types';

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

async function daemonTokenCodexHomes(temporaryRoot: string): Promise<string[]> {
    try {
        const entries = await readdir(temporaryRoot, { withFileTypes: true });
        const candidates: string[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || !/^tmp-\d+-[0-9A-Za-z]{12}$/.test(entry.name)) continue;
            const candidate = join(temporaryRoot, entry.name);
            try {
                if ((await stat(join(candidate, 'auth.json'))).isFile()) {
                    candidates.push(candidate);
                }
            } catch {
                // Token-spawned Codex homes always contain the daemon-written auth marker.
            }
        }
        return candidates;
    } catch {
        return [];
    }
}

export async function resolveCodexHomeForResume(
    metadata: Pick<Metadata, 'codexHome' | 'codexThreadId' | 'homeDir'>,
    env: NodeJS.ProcessEnv = process.env,
    temporaryRoot: string = tmpdir(),
): Promise<string | undefined> {
    const savedCodexHome = metadata.codexHome?.trim();
    if (savedCodexHome) {
        return resolve(savedCodexHome);
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
    for (const candidate of await daemonTokenCodexHomes(temporaryRoot)) {
        if (await codexHomeContainsThread(candidate, threadId)) {
            return candidate;
        }
    }
    return undefined;
}
