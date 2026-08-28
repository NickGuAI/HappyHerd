import { describe, expect, it } from 'vitest';

import { HappyHerdAutomationRailSchema } from '@slopus/happy-wire';
import { automationUnattendedPermissionMode } from './unattendedPolicy';

describe('automation unattended permission policy', () => {
  it('defines one explicit headless policy for every automation rail', () => {
    expect(HappyHerdAutomationRailSchema.options.map((rail) => [
      rail,
      automationUnattendedPermissionMode(rail),
    ])).toEqual([
      ['claude', 'bypassPermissions'],
      ['codex', 'yolo'],
    ]);
  });
});
