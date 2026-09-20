import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readNativeConfig(variant: string, overrides: Record<string, string> = {}) {
    const env = { ...process.env };
    for (const key of ['HAPPY_APP_BUNDLE_ID', 'HAPPY_EAS_PROJECT_ID', 'HAPPY_EAS_OWNER', 'HAPPY_APP_LINK_HOST', 'HAPPY_IOS_BUILD_NUMBER', 'APPLE_TEAM_ID']) {
        delete env[key];
    }
    return JSON.parse(execFileSync(process.execPath, ['-e', `
        const { exp } = require('@expo/config').getConfig(process.cwd());
        console.log(JSON.stringify({
            ios: exp.ios, updates: exp.updates, owner: exp.owner,
            eas: exp.extra.eas, version: exp.version,
        }));
    `], {
        cwd: resolve(import.meta.dirname, '..'),
        env: { ...env, APP_ENV: variant, ...overrides },
        encoding: 'utf8',
    }));
}

describe('native distribution ownership', () => {
    it.each([
        ['production', 'app.happyherd.client'],
        ['preview', 'app.happyherd.client.preview'],
        ['development', 'app.happyherd.client.dev'],
    ])('uses the owned %s identity without upstream update or account ownership', (variant, bundleId) => {
        const config = readNativeConfig(variant);
        expect(config.ios.bundleIdentifier).toBe(bundleId);
        expect(config.ios.buildNumber).toBe('1');
        expect(config.ios.associatedDomains).toBeUndefined();
        expect(config.owner).toBeUndefined();
        expect(config.eas).toBeUndefined();
        expect(config.updates).toEqual({ enabled: false });
    });

    it('uses the configured distribution account, build number, links, and matching OTA channel', () => {
        const config = readNativeConfig('preview', {
            HAPPY_APP_BUNDLE_ID: 'com.example.app',
            HAPPY_EAS_PROJECT_ID: '00000000-0000-4000-8000-000000000000',
            HAPPY_EAS_OWNER: 'example-owner',
            HAPPY_IOS_BUILD_NUMBER: '42',
            APPLE_TEAM_ID: 'EXAMPLETEAM',
        });
        expect(config.ios.bundleIdentifier).toBe('com.example.app.preview');
        expect(config.ios.buildNumber).toBe('42');
        expect(config.ios.appleTeamId).toBe('EXAMPLETEAM');
        expect(config.owner).toBe('example-owner');
        expect(config.eas.projectId).toBe('00000000-0000-4000-8000-000000000000');
        expect(config.updates.url).toBe('https://u.expo.dev/00000000-0000-4000-8000-000000000000');
        expect(config.updates.requestHeaders['expo-channel-name']).toBe('preview');
        expect(readNativeConfig('production', { HAPPY_APP_LINK_HOST: 'app.example.com' }).ios.associatedDomains)
            .toEqual(['applinks:app.example.com']);
    });

    it('leaves Apple submission and desktop signing identities to the release account', () => {
        const root = resolve(import.meta.dirname, '..');
        const eas = JSON.parse(readFileSync(resolve(root, 'eas.json'), 'utf8'));
        for (const profile of Object.values(eas.submit) as Array<{ ios: object }>) {
            expect(profile.ios).toEqual({});
        }
        const tauri = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
        expect(tauri.identifier).toBe('app.happyherd.client');
        expect(tauri.bundle.macOS.signingIdentity).toBeUndefined();
        const version = JSON.parse(readFileSync(resolve(root, 'src-tauri', tauri.version), 'utf8')).version;
        expect(version).toBe(readNativeConfig('production').version);
    });
});
