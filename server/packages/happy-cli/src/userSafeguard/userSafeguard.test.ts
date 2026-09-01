import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    USER_SAFEGUARD_SKILL_NAME,
    bundledUserSafeguardSkillPath,
    composeUserSafeguardPrompt,
    loadBundledUserSafeguardSkill,
    resolveUserSafeguardPromptMode,
} from './userSafeguard';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('bundled User Safeguard', () => {
    it('ships one valid named skill definition from the package root', () => {
        const path = bundledUserSafeguardSkillPath(packageRoot);
        const definition = loadBundledUserSafeguardSkill(packageRoot);

        expect(readFileSync(path, 'utf8').trim()).toBe(definition);
        expect(definition).toContain(`name: ${USER_SAFEGUARD_SKILL_NAME}`);
        expect(definition).toContain('Apply the gate only when both conditions hold');
        expect(definition).toContain('use the runtime goal mechanism to create a goal');
        expect(definition).toContain('autonomously pursue it to verified completion');
        expect(definition).toContain('existing tracking task or report');
        expect(definition).toContain('never authorizes code changes, production actions');
        expect(definition).toContain('Never apply or inherit this gate in a heartbeat');
        expect(definition).not.toContain('review or reporting');
    });

    it('composes enabled, disabled, automation, and absent prompt states distinctly', () => {
        const enabled = composeUserSafeguardPrompt('base instructions', 'enabled');
        const disabled = composeUserSafeguardPrompt('base instructions', 'disabled');
        const automation = composeUserSafeguardPrompt('base instructions', 'automation');

        expect(enabled).toContain('Apply the bundled `happyherd-user-safeguard` skill');
        expect(enabled).toContain('Apply the gate only when both conditions hold');
        expect(disabled).toContain('disabled for this Human turn');
        expect(disabled).not.toContain('Apply the gate only when both conditions hold');
        expect(automation).toContain('This is an automation turn');
        expect(automation).not.toContain('Apply the gate only when both conditions hold');
        expect(composeUserSafeguardPrompt(undefined, undefined)).toBeUndefined();
    });

    it('gives trusted automation provenance precedence over a retained Human setting', () => {
        expect(resolveUserSafeguardPromptMode(true, true)).toBe('automation');
        expect(resolveUserSafeguardPromptMode(true, false)).toBe('enabled');
        expect(resolveUserSafeguardPromptMode(false, false)).toBe('disabled');
        expect(resolveUserSafeguardPromptMode(undefined, false)).toBeUndefined();
    });
});
