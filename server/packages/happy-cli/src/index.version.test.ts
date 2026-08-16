import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import packageJson from '../package.json';

const require = createRequire(import.meta.url);
let root: string;

beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'happy-version-test-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('top-level happy --version', () => {
    function runVersion(environmentSha?: string) {
        const happyHome = path.join(root, '.happyherd');
        const emptyBin = path.join(root, 'empty-bin');
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            CI: '1',
            HAPPY_HOME_DIR: happyHome,
            HAPPY_SERVER_URL: 'http://127.0.0.1:9',
            HAPPY_VARIANT: 'stable',
            HOME: path.join(root, 'home'),
            PATH: emptyBin,
        };
        if (environmentSha) env.HAPPYHERD_RELEASE_SHA = environmentSha;
        else delete env.HAPPYHERD_RELEASE_SHA;

        return { happyHome, result: spawnSync(
            process.execPath,
            [
                '--import',
                require.resolve('tsx'),
                fileURLToPath(new URL('./index.ts', import.meta.url)),
                '--version',
            ],
            {
                cwd: fileURLToPath(new URL('..', import.meta.url)),
                encoding: 'utf8',
                env,
                timeout: 10_000,
            },
        ) };
    }

    it('exits successfully before auth, daemon startup, or provider launch', async () => {
        await mkdir(path.join(root, 'empty-bin'));
        const { happyHome, result } = runVersion();

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe(`happy version: ${packageJson.version}`);
        expect(result.stderr).toBe('');
        expect(existsSync(happyHome)).toBe(false);
        expect(existsSync(path.join(happyHome, 'settings.json'))).toBe(false);
        expect(existsSync(path.join(happyHome, 'access.key'))).toBe(false);
        expect(existsSync(path.join(happyHome, 'daemon.state.json'))).toBe(false);
    });

    it('reports the exact baked release identity without creating runtime state', async () => {
        await mkdir(path.join(root, 'empty-bin'));
        const releaseSha = 'a'.repeat(40);
        const { happyHome, result } = runVersion(releaseSha);

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe(
            `happy version: ${packageJson.version}+happyherd.${releaseSha}`,
        );
        expect(result.stderr).toBe('');
        expect(existsSync(happyHome)).toBe(false);
    });
});
