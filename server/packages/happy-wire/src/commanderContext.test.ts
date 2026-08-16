import { describe, expect, it } from 'vitest';
import { HappyHerdCommanderSummarySchema } from './commanderContext';

describe('HappyHerd Commander wire contracts', () => {
  it('accepts a Commander summary without exposing instruction contents', () => {
    const parsed = HappyHerdCommanderSummarySchema.parse({
      id: 'athena',
      name: 'Athena',
      role: 'Engineering commander',
      workspace: '/srv/app',
      commanderPath: '/home/me/.herd/commanders/athena/COMMANDER.md',
      agentContextPath: '/home/me/.herd/commanders/athena/agentcontext',
    });
    expect(parsed.name).toBe('Athena');
    expect(parsed).not.toHaveProperty('content');
  });
});
