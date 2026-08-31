import { describe, expect, it } from 'vitest';
import type { HappyHerdAutomation } from '@slopus/happy-wire';

import { happyHerdAutomationCardPresentation } from './happyHerdAutomationCardPresentation';

const automation = {
    name: 'memory-reflector-weekly',
    status: 'active',
    schedule: '0 4 * * 0',
    timezone: 'America/New_York',
    kind: 'memory-maintenance',
    instruction: 'Private automation instruction',
    rail: 'codex',
    workspace: '/srv/workspace',
    commanderId: null,
    tags: ['Operations', 'Project Beacon'],
} as HappyHerdAutomation;

describe('happyHerdAutomationCardPresentation', () => {
    it('exposes only the automation name and status while collapsed', () => {
        expect(happyHerdAutomationCardPresentation(automation, false)).toEqual({
            name: 'memory-reflector-weekly',
            active: true,
            statusKey: 'happyHerd.automations.statusActive',
            details: null,
        });
    });

    it('exposes operational details only after expansion', () => {
        expect(happyHerdAutomationCardPresentation(automation, true).details).toEqual({
            schedule: '0 4 * * 0',
            timezone: 'America/New_York',
            kind: 'memory-maintenance',
            instruction: 'Private automation instruction',
            executable: null,
            arguments: null,
            rail: 'codex',
            workspace: '/srv/workspace',
            commanderId: null,
            tags: ['Operations', 'Project Beacon'],
            targetSessionId: null,
        });
    });
});
