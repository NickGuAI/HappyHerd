import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCodexHomeForResume } from './codexHome';

const testRoots: string[] = [];

afterEach(async () => {
    await Promise.all(testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('resolveCodexHomeForResume', () => {
    it('locates a legacy thread in its registered local Codex home', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happy-codex-home-'));
        testRoots.push(homeDir);
        const currentCodexHome = join(homeDir, '.codex');
        const originalCodexHome = join(homeDir, '.herd', 'credential-pools', 'codex', 'legacy-account');
        const rolloutDir = join(originalCodexHome, 'sessions', '2026', '08', '20');
        const threadId = '019ccca5-726b-7c61-b914-16de27dfab6e';
        await mkdir(currentCodexHome, { recursive: true });
        await mkdir(rolloutDir, { recursive: true });
        await writeFile(join(rolloutDir, `rollout-2026-08-20T10-00-00-${threadId}.jsonl`), '');

        await expect(resolveCodexHomeForResume({
            homeDir,
            codexThreadId: threadId,
        }, {
            HOME: homeDir,
            CODEX_HOME: currentCodexHome,
        })).resolves.toBe(originalCodexHome);
    });

    it('resolves a persisted runtime home to the provider state it links', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happy-codex-home-'));
        testRoots.push(homeDir);
        const runtimeCodexHome = join(homeDir, 'runtime-codex-home');
        const originalCodexHome = join(homeDir, 'original-codex-home');
        await mkdir(join(originalCodexHome, 'sessions'), { recursive: true });
        await mkdir(runtimeCodexHome);
        await symlink(join(originalCodexHome, 'sessions'), join(runtimeCodexHome, 'sessions'));

        await expect(resolveCodexHomeForResume({
            homeDir,
            codexHome: runtimeCodexHome,
            codexThreadId: 'thread-1',
        }, {
            HOME: homeDir,
            CODEX_HOME: join(homeDir, 'current-codex-home'),
        })).resolves.toBe(originalCodexHome);
    });
});
