import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalEnvironment, migrateCliSettings, resolveCliHome } from './legacyCompatibility';
import { buildSessionChildEnvironment, sanitizeSessionEnvironment, sessionEnvironmentKeysToUnset } from './daemon/sessionEnvironment';
import { stripHappyHerdSystemBlocks } from './codex/codexPrompt';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function home() { const root = mkdtempSync(join(tmpdir(), 'cli-migration-')); roots.push(root); return root; }

describe('CLI naming migration', () => {
    it('prefers canonical variables, accepts old launch configuration and leaves values byte-faithful', () => {
        const env = { HAPPY_HOME_DIR: '/original/happy sessions', HAPPY_SERVER_URL: 'https://original.example', HAPPYHERD_SERVER_URL: 'https://selected.example' };
        expect(canonicalEnvironment(env)).toMatchObject({ HAPPYHERD_HOME_DIR: '/original/happy sessions', HAPPYHERD_SERVER_URL: 'https://selected.example' });
        expect(env).not.toHaveProperty('HAPPYHERD_HOME_DIR');
        expect(resolveCliHome({ HAPPY_HOME_DIR: '~/custom' }, '/home/test')).toBe('/home/test/custom');
    });

    it('reuses the original home without copying or rewriting credentials, sessions, provider homes or locks', async () => {
        const root = home();
        const original = join(root, '.happy');
        mkdirSync(original);
        const settings = JSON.stringify({ schemaVersion: 2, machineId: 'original-machine', daemonAutoStartWhenRunningHappy: false });
        const sessions = JSON.stringify([{ id: 'original-session', encryption: 'original-key', codexHome: '/original/provider/home', updatedAt: 1 }]);
        const files = { 'settings.json': settings, 'access.key': '{"token":"original-token","secret":"c2VjcmV0"}', 'sessions.json': sessions, 'daemon.state.json.lock': '12345' };
        for (const [name, content] of Object.entries(files)) writeFileSync(join(original, name), content);
        expect(resolveCliHome({}, root)).toBe(original);
        vi.stubEnv('HAPPYHERD_HOME_DIR', original);
        const { configuration } = await import('./configuration');
        const { readSettings } = await import('./persistence');
        expect(configuration.settingsFile).toBe(join(original, 'settings.json'));
        expect(configuration.sessionsFile).toBe(join(original, 'sessions.json'));
        expect(await readSettings()).toMatchObject({ machineId: 'original-machine', daemonAutoStartWhenRunningHappyHerd: false });
        for (const [name, content] of Object.entries(files)) expect(readFileSync(join(original, name), 'utf8')).toBe(content);
        expect(existsSync(join(root, '.happyherd'))).toBe(false);
        mkdirSync(join(root, '.happyherd'));
        expect(resolveCliHome({}, root)).toBe(join(root, '.happyherd'));
        expect(resolveCliHome({ HAPPYHERD_HOME_DIR: original }, root)).toBe(original);
    });

    it('keeps explicit daemon settings and removes both spellings of ambient session secrets', () => {
        expect(migrateCliSettings({ daemonAutoStartWhenRunningHappy: true, daemonAutoStartWhenRunningHappyHerd: false })).toMatchObject({ daemonAutoStartWhenRunningHappyHerd: false });
        const ambient = { HAPPY_RECONNECT_SESSION_ID: 'old', HAPPYHERD_RECONNECT_ENCRYPTION_KEY: 'secret', PATH: '/bin' };
        expect(sanitizeSessionEnvironment(ambient)).toEqual({ PATH: '/bin' });
        expect(buildSessionChildEnvironment(ambient, { HAPPY_RECONNECT_SESSION_ID: 'explicit' })).toMatchObject({ HAPPYHERD_RECONNECT_SESSION_ID: 'explicit' });
        expect(sessionEnvironmentKeysToUnset()).toContain('HAPPY_RECONNECT_SESSION_ID');
    });

    it('strips both historical and current instruction markers without changing Human text', () => {
        expect(stripHappyHerdSystemBlocks('Human happy text\n<happy-system>old</happy-system>\n<happyherd-system>new</happyherd-system>')).toBe('Human happy text');
    });
});
