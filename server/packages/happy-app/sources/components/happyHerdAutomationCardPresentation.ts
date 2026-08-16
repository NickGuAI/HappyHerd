import type { HappyHerdAutomation } from '@slopus/happy-wire';

export type HappyHerdAutomationCardPresentation = {
    name: string;
    active: boolean;
    statusKey: 'happyHerd.automations.statusActive' | 'happyHerd.automations.statusPaused';
    details: null | Pick<
        HappyHerdAutomation,
        'schedule' | 'timezone' | 'kind' | 'instruction' | 'rail' | 'workspace' | 'commanderId'
    >;
};

export function happyHerdAutomationCardPresentation(
    automation: HappyHerdAutomation,
    expanded: boolean,
): HappyHerdAutomationCardPresentation {
    const active = automation.status === 'active';
    return {
        name: automation.name,
        active,
        statusKey: active
            ? 'happyHerd.automations.statusActive'
            : 'happyHerd.automations.statusPaused',
        details: expanded ? {
            schedule: automation.schedule,
            timezone: automation.timezone,
            kind: automation.kind,
            instruction: automation.instruction,
            rail: automation.rail,
            workspace: automation.workspace,
            commanderId: automation.commanderId,
        } : null,
    };
}
