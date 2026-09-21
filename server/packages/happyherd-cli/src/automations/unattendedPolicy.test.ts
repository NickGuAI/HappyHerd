import { describe, expect, it } from 'vitest';

import { HappyHerdAutomationAgentRailSchema } from '@slopus/happy-wire';
import { automationUnattendedPermissionMode } from './unattendedPolicy';

describe('automation unattended permission policy', () => {
  it('defines one explicit headless policy for every provider-agent rail', () => {
    expect(HappyHerdAutomationAgentRailSchema.options.map((rail) => [
      rail,
      automationUnattendedPermissionMode(rail),
    ])).toEqual([
      ['claude', 'bypassPermissions'],
      ['codex', 'yolo'],
    ]);
  });
});
