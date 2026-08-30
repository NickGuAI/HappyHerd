import { describe, expect, it } from 'vitest';

import { MessageQueue2 } from '@/utils/MessageQueue2';
import {
  buildAgyLaunchMetadata,
  hashAgyTurnMode,
  resolveAgyIncomingPermissionMode,
  type AgyTurnMode,
} from './turnMode';

describe('Antigravity turn modes', () => {
  it('records the direct launch mode and model for daemon receipts and app display', () => {
    expect(buildAgyLaunchMetadata('bypassPermissions', 'Gemini 3.1 Pro (High)')).toEqual({
      spawnSettings: {
        provider: 'agy',
        model: 'Gemini 3.1 Pro (High)',
        effort: null,
        permission: 'bypassPermissions',
      },
      permissionMode: 'bypassPermissions',
      modelMode: 'Gemini 3.1 Pro (High)',
    });
  });

  it('keeps FIFO prompts separated when their permission or model changes', async () => {
    const queue = new MessageQueue2<AgyTurnMode>(hashAgyTurnMode);
    queue.push('sandboxed first', { permissionMode: 'default', model: 'model-a' });
    queue.push('bypass second', { permissionMode: 'bypassPermissions', model: 'model-b' });

    await expect(queue.waitForMessagesAndGetAsString()).resolves.toMatchObject({
      message: 'sandboxed first',
      mode: { permissionMode: 'default', model: 'model-a' },
    });
    await expect(queue.waitForMessagesAndGetAsString()).resolves.toMatchObject({
      message: 'bypass second',
      mode: { permissionMode: 'bypassPermissions', model: 'model-b' },
    });
  });

  it('still batches consecutive prompts with identical child settings', async () => {
    const queue = new MessageQueue2<AgyTurnMode>(hashAgyTurnMode);
    const mode: AgyTurnMode = { permissionMode: 'default', model: 'model-a' };
    queue.push('first', mode);
    queue.push('second', mode);

    await expect(queue.waitForMessagesAndGetAsString()).resolves.toMatchObject({
      message: 'first\nsecond',
      mode,
    });
  });

  it('keeps the current mode when a message has no permission override', () => {
    expect(resolveAgyIncomingPermissionMode('bypassPermissions', undefined)).toEqual({
      ok: true,
      permissionMode: 'bypassPermissions',
    });
  });

  it('refuses an unsupported mode instead of executing under the previous one', () => {
    expect(resolveAgyIncomingPermissionMode('bypassPermissions', 'safe-yolo')).toEqual({
      ok: false,
      error: 'Unsupported Antigravity permission mode: safe-yolo',
    });
  });
});
