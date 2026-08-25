import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

    it('preserves the exact persisted Codex home even when it is currently unavailable', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happy-codex-home-'));
        testRoots.push(homeDir);
        const runtimeCodexHome = join(homeDir, 'runtime-codex-home');

        await expect(resolveCodexHomeForResume({
            homeDir,
            codexHome: runtimeCodexHome,
            codexThreadId: 'thread-1',
        }, {
            HOME: homeDir,
            CODEX_HOME: join(homeDir, 'current-codex-home'),
        })).resolves.toBe(runtimeCodexHome);
    });

    it('locates an old token-spawned thread only in a marked direct tmp package directory', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happy-codex-home-'));
        const temporaryRoot = await mkdtemp(join(tmpdir(), 'happy-codex-tmp-root-'));
        testRoots.push(homeDir, temporaryRoot);
        const threadId = '019ccca5-726b-7c61-b914-16de27dfab6e';
        const invalidHome = join(temporaryRoot, 'tmp-invalid-name');
        const originalCodexHome = join(temporaryRoot, 'tmp-12345-A1b2C3d4E5f6');
        for (const candidate of [invalidHome, originalCodexHome]) {
            const rolloutDir = join(candidate, 'sessions', '2026', '08', '20');
            await mkdir(rolloutDir, { recursive: true });
            await writeFile(join(rolloutDir, `rollout-${threadId}.jsonl`), '');
        }
        await writeFile(join(invalidHome, 'auth.json'), '');

        const metadata = { homeDir, codexThreadId: threadId };
        await expect(resolveCodexHomeForResume(metadata, {}, temporaryRoot)).resolves.toBeUndefined();

        await writeFile(join(originalCodexHome, 'auth.json'), '');
        await expect(resolveCodexHomeForResume(metadata, {}, temporaryRoot)).resolves.toBe(originalCodexHome);
    });
});
