import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testCliEnvironment } from './cliEnvironment';

describe('control CLI test environment', () => {
    it('routes child config and credential writes to the selected fixtures despite inherited canonical inputs', () => {
        const root = mkdtempSync(join(tmpdir(), 'control-child-env-'));
        const credential = join(root, 'agent.key');
        const sentinel = 'synthetic-parent-credential';
        writeFileSync(credential, sentinel);
        vi.stubEnv('HAPPYHERD_HOME_DIR', root);
        vi.stubEnv('HAPPYHERD_SERVER_URL', 'http://127.0.0.1:1');
        /* rename:preserve */
        vi.stubEnv('HAPPY_HOME_DIR', root);
        vi.stubEnv('HAPPY_SERVER_URL', 'http://127.0.0.1:2');
        /* /rename:preserve */
        try {
            const home = join(root, 'selected-home');
            const serverUrl = 'http://127.0.0.1:3';
            const configModule = new URL('../config.ts', import.meta.url).href;
            const credentialsModule = new URL('../credentials.ts', import.meta.url).href;
            const script = `
                const { loadConfig } = await import(${JSON.stringify(configModule)});
                const { writeCredentials } = await import(${JSON.stringify(credentialsModule)});
                const config = loadConfig();
                writeCredentials(config, 'synthetic-child-token', new Uint8Array(32));
                process.stdout.write(JSON.stringify(config));
            `;
            const actual = JSON.parse(execFileSync(process.execPath, [
                '--import', 'tsx', '--input-type=module', '--eval', script,
            ], { encoding: 'utf8', env: testCliEnvironment(home, serverUrl) }));
            expect(actual).toEqual({ homeDir: home, serverUrl, credentialPath: join(home, 'agent.key') });
            expect(readFileSync(credential, 'utf8')).toBe(sentinel);
            expect(JSON.parse(readFileSync(join(home, 'agent.key'), 'utf8')).token).toBe('synthetic-child-token');
        } finally {
            vi.unstubAllEnvs();
            rmSync(root, { recursive: true, force: true });
        }
    });
});
