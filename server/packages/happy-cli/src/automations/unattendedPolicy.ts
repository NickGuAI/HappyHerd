import type { HappyHerdAutomation } from '@slopus/happy-wire';

type AutomationRail = Exclude<HappyHerdAutomation['rail'], 'exec'>;

const AUTOMATION_UNATTENDED_PERMISSION_MODES = {
  claude: 'bypassPermissions',
  codex: 'yolo',
} as const satisfies Record<AutomationRail, string>;

/**
 * Agent automations have no human approval channel, so every provider rail must
 * select its provider-native unattended mode explicitly. The exhaustive
 * record makes a newly added automation rail fail type-check until it owns a
 * policy instead of inheriting a provider default.
 */
export function automationUnattendedPermissionMode(rail: AutomationRail): string {
  return AUTOMATION_UNATTENDED_PERMISSION_MODES[rail];
}
