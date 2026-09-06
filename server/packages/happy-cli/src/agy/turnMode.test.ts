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
      effortLevel: null,
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

  it('keeps independent efforts in separate immutable FIFO batches', async () => {
    const queue = new MessageQueue2<AgyTurnMode>(hashAgyTurnMode);
    queue.push('low', { permissionMode: 'default', model: 'Gemini 3.8 Flash', effort: 'low' });
    queue.push('high', { permissionMode: 'default', model: 'Gemini 3.8 Flash', effort: 'high' });
    await expect(queue.waitForMessagesAndGetAsString()).resolves.toMatchObject({ message: 'low', mode: { effort: 'low' } });
    await expect(queue.waitForMessagesAndGetAsString()).resolves.toMatchObject({ message: 'high', mode: { effort: 'high' } });
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
