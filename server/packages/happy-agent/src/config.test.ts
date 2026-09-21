import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from './config';

describe('config', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.HAPPYHERD_SERVER_URL;
        delete process.env.HAPPYHERD_HOME_DIR;
        /* rename:preserve */
        delete process.env.HAPPY_SERVER_URL;
        delete process.env.HAPPY_HOME_DIR;
        /* /rename:preserve */
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('defaults', () => {
        it('uses default server URL', () => {
            const config = loadConfig();
            expect(config.serverUrl).toBe('https://api.cluster-fluster.com');
        });

        it('uses default home directory', () => {
            const config = loadConfig();
            expect(config.homeDir).toBe(join(homedir(), '.happy'));
        });

        it('derives credential path from home directory', () => {
            const config = loadConfig();
            expect(config.credentialPath).toBe(join(homedir(), '.happy', 'agent.key'));
        });
    });

    describe('generated development environment', () => {
        it.each([false, true])('keeps the control client on the selected dev server and home (legacy inputs: %s)', (withLegacyInputs) => {
            const root = mkdtempSync(join(tmpdir(), 'control-dev-env-'));
            try {
                const environmentModule = new URL('../../../environments/environments.ts', import.meta.url).href;
                const configModule = new URL('./config.ts', import.meta.url).href;
                const envScript = execFileSync(process.execPath, [
                    '--import', 'tsx', '--input-type=module', '--eval',
                    `const { buildEnvSh } = await import(${JSON.stringify(environmentModule)}); process.stdout.write(buildEnvSh('test', ${JSON.stringify(root)}, 32123, 32124));`,
                ], { encoding: 'utf8' });
                const envPath = join(root, 'env.sh');
                writeFileSync(envPath, envScript);
                const readConfig = `const { loadConfig } = await import(${JSON.stringify(configModule)}); process.stdout.write(JSON.stringify(loadConfig()));`;
                const env = { ...process.env };
                if (withLegacyInputs) {
                    /* rename:preserve */
                    env.HAPPY_SERVER_URL = 'https://legacy.example.com';
                    env.HAPPY_HOME_DIR = join(root, 'legacy');
                    /* /rename:preserve */
                }
                const actual = JSON.parse(execFileSync('bash', [
                    '--noprofile', '--norc', '-c',
                    'source "$1"; exec "$2" --import tsx --input-type=module --eval "$3"',
                    'control-dev-env', envPath, process.execPath, readConfig,
                ], { encoding: 'utf8', env }));
                expect(actual).toEqual({
                    serverUrl: 'http://localhost:32123',
                    homeDir: join(root, 'cli', 'home'),
                    credentialPath: join(root, 'cli', 'home', 'agent.key'),
                });
            } finally { rmSync(root, { recursive: true, force: true }); }
        });
    });

    describe('env var overrides', () => {
        it('reuses the historical credential file and gives canonical inputs precedence', () => {
            const home = mkdtempSync(join(tmpdir(), 'control-identity-'));
            const keyBytes = Buffer.from('retained-test-credential\n');
            try {
                writeFileSync(join(home, 'agent.key'), keyBytes);
                /* rename:preserve */
                process.env.HAPPY_HOME_DIR = home;
                process.env.HAPPY_SERVER_URL = 'https://legacy.example.com/';
                /* /rename:preserve */
                const old = loadConfig();
                expect(old.serverUrl).toBe('https://legacy.example.com');
                expect(old.credentialPath).toBe(join(home, 'agent.key'));
                expect(readFileSync(old.credentialPath)).toEqual(keyBytes);
                process.env.HAPPYHERD_HOME_DIR = `${home}/explicit`;
                process.env.HAPPYHERD_SERVER_URL = 'https://canonical.example.com/';
                expect(loadConfig()).toEqual({
                    homeDir: `${home}/explicit`, credentialPath: `${home}/explicit/agent.key`,
                    serverUrl: 'https://canonical.example.com',
                });
                expect(readFileSync(old.credentialPath)).toEqual(keyBytes);
            } finally { rmSync(home, { recursive: true, force: true }); }
        });
        it('overrides server URL with HAPPYHERD_SERVER_URL', () => {
            process.env.HAPPYHERD_SERVER_URL = 'https://custom-server.example.com';
            const config = loadConfig();
            expect(config.serverUrl).toBe('https://custom-server.example.com');
        });

        it('overrides home directory with HAPPYHERD_HOME_DIR', () => {
            process.env.HAPPYHERD_HOME_DIR = '/tmp/custom-happyherd';
            const config = loadConfig();
            expect(config.homeDir).toBe('/tmp/custom-happyherd');
        });

        it('derives credential path from overridden home directory', () => {
            process.env.HAPPYHERD_HOME_DIR = '/tmp/custom-happyherd';
            const config = loadConfig();
            expect(config.credentialPath).toBe('/tmp/custom-happyherd/agent.key');
        });

        it('allows both overrides simultaneously', () => {
            process.env.HAPPYHERD_SERVER_URL = 'https://other.example.com';
            process.env.HAPPYHERD_HOME_DIR = '/opt/happyherd';
            const config = loadConfig();
            expect(config.serverUrl).toBe('https://other.example.com');
            expect(config.homeDir).toBe('/opt/happyherd');
            expect(config.credentialPath).toBe('/opt/happyherd/agent.key');
        });
    });
});
