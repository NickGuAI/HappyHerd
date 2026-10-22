import { describe, expect, it } from 'vitest';

import { sessionTaskSettings } from './sessionTaskSettings';

describe('sessionTaskSettings', () => {
  it('forwards selected modes and explicit model and effort resets', () => {
    expect(sessionTaskSettings({
      modelMode: 'gpt-6-astra',
      effortLevel: null,
      permissionMode: 'yolo',
      projectId: 'project-1',
    })).toEqual({
      model: 'gpt-6-astra',
      effort: null,
      permissionMode: 'yolo',
    });
  });

  it('normalizes only the product default sentinel to a null provider model', () => {
    expect(sessionTaskSettings({
      modelMode: 'default',
      effortLevel: 'high',
      permissionMode: 'yolo',
    })).toEqual({
      model: null,
      effort: 'high',
      permissionMode: 'yolo',
    });
    expect(sessionTaskSettings({ modelMode: 'claude-sonnet-4-5' })).toEqual({
      model: 'claude-sonnet-4-5',
    });
  });

  it('leaves absent or invalid picks out so the provider retains its current mode', () => {
    expect(sessionTaskSettings({
      modelMode: undefined,
      effortLevel: 5,
      permissionMode: null,
    })).toEqual({});
    expect(sessionTaskSettings(null)).toEqual({});
  });

  it('does not forward launch-only Grok or DSH permission picks as runtime settings', () => {
    expect(sessionTaskSettings({ flavor: 'grok', permissionMode: 'allow' })).toEqual({});
    expect(sessionTaskSettings({ flavor: 'dsh', permissionMode: 'default' })).toEqual({});
  });
});
