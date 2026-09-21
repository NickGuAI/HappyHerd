import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { projectPath } from '@/projectPath';

export const USER_SAFEGUARD_SKILL_NAME = 'happyherd-user-safeguard';

export type UserSafeguardPromptMode = 'enabled' | 'disabled' | 'automation' | undefined;

let cachedSkillDefinition: string | undefined;

export function bundledUserSafeguardSkillPath(packageRoot = projectPath()): string {
    return join(packageRoot, 'skills', USER_SAFEGUARD_SKILL_NAME, 'SKILL.md');
}

export function loadBundledUserSafeguardSkill(packageRoot?: string): string {
    if (packageRoot) {
        return readFileSync(bundledUserSafeguardSkillPath(packageRoot), 'utf8').trim();
    }
    cachedSkillDefinition ??= readFileSync(bundledUserSafeguardSkillPath(), 'utf8').trim();
    return cachedSkillDefinition;
}

export function resolveUserSafeguardPromptMode(
    enabled: boolean | undefined,
    automation: boolean,
): UserSafeguardPromptMode {
    if (automation) return 'automation';
    if (enabled === true) return 'enabled';
    if (enabled === false) return 'disabled';
    return undefined;
}

export function composeUserSafeguardPrompt(
    basePrompt: string | null | undefined,
    mode: UserSafeguardPromptMode,
): string | undefined {
    const parts = [basePrompt?.trim()].filter((part): part is string => Boolean(part));

    if (mode === 'enabled') {
        parts.push([
            '# HappyHerd User Safeguard',
            '',
            `Apply the bundled \`${USER_SAFEGUARD_SKILL_NAME}\` skill to this Human turn.`,
            'Its complete, reviewable definition follows:',
            '',
            `<skill name="${USER_SAFEGUARD_SKILL_NAME}">`,
            loadBundledUserSafeguardSkill(),
            '</skill>',
        ].join('\n'));
    } else if (mode === 'disabled') {
        parts.push([
            '# HappyHerd User Safeguard',
            '',
            `The account safeguard is disabled for this Human turn. Do not apply \`${USER_SAFEGUARD_SKILL_NAME}\` solely because it appeared in an earlier turn.`,
        ].join('\n'));
    } else if (mode === 'automation') {
        parts.push([
            '# HappyHerd automation boundary',
            '',
            `This is an automation turn. Do not invoke or apply \`${USER_SAFEGUARD_SKILL_NAME}\`, even if an earlier Human turn enabled it. Continue under the other applicable instructions without requesting the safeguard's artifact approval.`,
        ].join('\n'));
    }

    return parts.length > 0 ? parts.join('\n\n') : undefined;
}
