import type { HappyHerdAutomation } from '@slopus/happy-wire';

export type HappyHerdAutomationCardPresentation = {
    name: string;
    active: boolean;
    statusKey: 'happyHerd.automations.statusActive' | 'happyHerd.automations.statusPaused';
    details: null | {
        schedule: string;
        timezone: string;
        kind: HappyHerdAutomation['kind'];
        instruction: string | null;
        executable: string | null;
        arguments: string[] | null;
        rail: HappyHerdAutomation['rail'];
        workspace: string;
        commanderId: string | null;
        tags: string[];
        targetSessionId: string | null;
    };
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
            schedule: automation.kind === 'heartbeat'
                ? `every ${automation.intervalSeconds}s`
                : automation.schedule,
            timezone: automation.timezone,
            kind: automation.kind,
            instruction: automation.rail === 'exec' ? null : automation.instruction,
            executable: automation.rail === 'exec' ? automation.executable : null,
            arguments: automation.rail === 'exec' ? automation.arguments : null,
            rail: automation.rail,
            workspace: automation.workspace,
            commanderId: automation.rail === 'exec' ? null : automation.commanderId,
            tags: automation.tags,
            targetSessionId: automation.kind === 'heartbeat' ? automation.targetSessionId : null,
        } : null,
    };
}
