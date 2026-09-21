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
    root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-version-test-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('top-level happyherd --version', () => {
    function runVersion() {
        const happyherdHome = path.join(root, '.happyherd');
        const emptyBin = path.join(root, 'empty-bin');
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            CI: '1',
            HAPPYHERD_HOME_DIR: happyherdHome,
            HAPPYHERD_SERVER_URL: 'http://127.0.0.1:9',
            HAPPYHERD_VARIANT: 'stable',
            HOME: path.join(root, 'home'),
            PATH: emptyBin,
        };
        return { happyherdHome, result: spawnSync(
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
        const { happyherdHome, result } = runVersion();

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe(`happyherd version: ${packageJson.version}`);
        expect(result.stderr).toBe('');
        expect(existsSync(happyherdHome)).toBe(false);
        expect(existsSync(path.join(happyherdHome, 'settings.json'))).toBe(false);
        expect(existsSync(path.join(happyherdHome, 'access.key'))).toBe(false);
        expect(existsSync(path.join(happyherdHome, 'daemon.state.json'))).toBe(false);
    }, 15_000);

    it('runs through the server workspace shortcut', async () => {
        const happyherdHome = path.join(root, '.happyherd');
        const serverRoot = fileURLToPath(new URL('../../..', import.meta.url));
        const result = spawnSync('pnpm', ['cli', '--version'], {
            cwd: serverRoot,
            encoding: 'utf8',
            env: {
                ...process.env,
                CI: '1',
                HAPPYHERD_HOME_DIR: happyherdHome,
                HAPPYHERD_SERVER_URL: 'http://127.0.0.1:9',
                HAPPYHERD_VARIANT: 'stable',
            },
            timeout: 10_000,
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`happyherd version: ${packageJson.version}`);
        expect(existsSync(happyherdHome)).toBe(false);
    }, 15_000);

});
