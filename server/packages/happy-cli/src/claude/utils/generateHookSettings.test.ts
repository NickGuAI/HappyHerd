import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn() },
}));

vi.mock('@/projectPath', () => ({
    projectPath: () => '/workspace/happyherd',
}));

import { cleanupHookSettingsFile, generateHookSettingsFile } from './generateHookSettings';

const roots: string[] = [];

afterEach(() => {
    while (roots.length > 0) {
        rmSync(roots.pop()!, { recursive: true, force: true });
    }
});

describe('Claude hook settings', () => {
    it('uses an isolated OS-temporary directory and removes it after use', () => {
        const root = mkdtempSync(join(tmpdir(), 'happyherd-hook-settings-test-'));
        roots.push(root);

        const settingsPath = generateHookSettingsFile(43210, root);
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
            hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
        };

        expect(dirname(settingsPath).startsWith(`${root}/happyherd-hooks-`)).toBe(true);
        expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('43210');

        const settingsDir = dirname(settingsPath);
        cleanupHookSettingsFile(settingsPath);
        expect(existsSync(settingsDir)).toBe(false);
    });
});
