import { describe, expect, it } from 'vitest';
import { MessageMetaSchema } from './messageMeta';
import { RigBotSchema, RigMetadataV1Schema } from './rigMetadata';

const bot = {
  id: 'bot-1', name: 'Build assistant', username: 'build-assistant',
  workspaceId: 'workspace-1', orderKey: 'a0',
};

describe('Rig wire contract', () => {
  it('accepts bounded bot identity and retains future bot fields', () => {
    expect(RigBotSchema.parse({ ...bot, futureField: true })).toEqual({ ...bot, futureField: true });
    for (const [field, limit] of Object.entries({ id: 128, name: 512, username: 64, workspaceId: 128, orderKey: 64 })) {
      expect(RigBotSchema.safeParse({ ...bot, [field]: '' }).success).toBe(false);
      expect(RigBotSchema.safeParse({ ...bot, [field]: 'x'.repeat(limit + 1) }).success).toBe(false);
    }
  });
  it('accepts native Rig message selection codes and provider qualification', () => {
    expect(MessageMetaSchema.parse({
      expectsAcceptance: true,
      queuedWhileBusy: true,
      permissionMode: 'workspace_write',
      model: 'shared-model',
      modelProviderId: 'codex',
      effort: 'high',
    })).toEqual({
      expectsAcceptance: true,
      queuedWhileBusy: true,
      permissionMode: 'workspace_write',
      model: 'shared-model',
      modelProviderId: 'codex',
      effort: 'high',
    });
  });

  it('retains the encrypted queue delivery override and rejects parallel routing values', () => {
    expect(MessageMetaSchema.parse({ deliveryMode: 'queue' }).deliveryMode).toBe('queue');
    expect(MessageMetaSchema.safeParse({ deliveryMode: 'steer' }).success).toBe(false);
  });

  it('retains the typed provider-continuation handoff marker', () => {
    expect(MessageMetaSchema.parse({ providerContinuationHandoff: true }))
      .toEqual({ providerContinuationHandoff: true });
    expect(MessageMetaSchema.safeParse({ providerContinuationHandoff: 'yes' }).success).toBe(false);
  });

  it('retains only a boolean Human safeguard selection', () => {
    expect(MessageMetaSchema.parse({ userSafeguardEnabled: true }))
      .toEqual({ userSafeguardEnabled: true });
    expect(MessageMetaSchema.safeParse({ userSafeguardEnabled: 'yes' }).success).toBe(false);
  });

  it('parses a Rig v1 payload and retains unknown future fields', () => {
    const parsed = RigMetadataV1Schema.parse({
      rigMetadataVersion: 1,
      client: { id: 'rig', name: 'Rig', version: '0.0.30' },
      provider: { id: 'codex', kind: 'codex', name: 'OpenAI Codex' },
      providers: [{ id: 'codex', kind: 'codex', name: 'OpenAI Codex' }],
      model: { providerId: 'codex', id: 'm' },
      models: [{
        id: 'm', code: 'm', name: 'Model', value: 'Model',
        providerId: 'codex', providerKind: 'codex', providerName: 'OpenAI Codex',
        provider: { id: 'codex', kind: 'codex', name: 'OpenAI Codex' },
        serviceTiers: [], thinkingLevels: ['high'], defaultThinkingLevel: 'high',
      }],
      currentModelProviderId: 'codex',
      currentModelCode: 'm',
      permissionMode: 'auto',
      currentOperatingModeCode: 'auto',
      operatingModes: [{ code: 'auto', value: 'Auto', description: 'Sandboxed review.', kind: 'safe-yolo' }],
      reasoning: { current: 'high', levels: ['high'] },
      thoughtLevels: [{ code: 'high', value: 'high' }],
      session: { status: 'running', permissionMode: 'auto', modelLocked: false },
      capabilities: {
        abort: true,
        attachments: { enabled: true, maxBytes: 10, mediaTypes: ['image/*'] },
        files: { browse: true, read: true, search: true, write: true },
        modelSelection: true,
        reasoningSelection: true,
        permissionModeSelection: true,
        resume: false,
        rpcMethods: ['abort', 'bash', 'readFile', 'writeFile', 'ripgrep'],
        shell: true,
        steering: true,
      },
      activity: {
        subagents: { running: 0, queued: 0, total: 0 },
        workflows: { running: 0, total: 0 },
        processes: { running: 0 },
        tasks: { pending: 0, inProgress: 0, completed: 0, total: 0 },
      },
      mcpServers: [], tools: [], skills: [], futureField: true,
    });
    expect((parsed as any).futureField).toBe(true);
    expect(RigMetadataV1Schema.parse({ ...parsed, bot }).bot).toEqual(bot);
    expect(RigMetadataV1Schema.safeParse({ ...parsed, bot: { ...bot, id: '' } }).success).toBe(false);
    expect(RigMetadataV1Schema.safeParse({
      ...parsed,
      operatingModes: [{ code: 'future', value: 'Future', description: 'Future mode', kind: 'future-kind' }],
    }).success).toBe(true);
  });

  it('parses composer drafts and timestamped clears without obsolete selection fields', () => {
    const lastMode = {
      effort: 'high', modelId: 'm', permissionMode: 'auto', providerId: 'codex', serviceTier: null,
    };
    const payload = {
      capabilities: {
        abort: true,
        attachments: { enabled: true, maxBytes: 10485760, mediaTypes: ['image/*'] },
        files: { browse: false, read: false, search: false, write: false },
        modelSelection: true,
        permissionModeSelection: true,
        reasoningSelection: true,
        resume: false,
        rpcMethods: ['abort'],
        shell: false,
        steering: true,
      },
      client: { id: 'rig', name: 'HappyHerd Agent', version: '0.0.40' },
      draft: { ...lastMode, text: 'Finish this on the phone' },
      draftUpdatedAt: 1_758_262_000_000,
      lastMode,
      models: [],
      operatingModes: [],
      providers: [],
      rigMetadataVersion: 1,
      session: { modelLocked: false, status: 'idle' },
      tools: [],
    };
    const parsed = RigMetadataV1Schema.parse(payload);
    expect(parsed.draft).toMatchObject({ text: 'Finish this on the phone', serviceTier: null });
    expect(parsed.lastMode).toMatchObject(lastMode);

    // A cleared draft keeps its timestamp.
    const cleared = RigMetadataV1Schema.parse({
      ...payload, draft: null, draftUpdatedAt: 1_758_262_000_001, lastMode: null,
    });
    expect(cleared.draft).toBeNull();
    expect(cleared.draftUpdatedAt).toBe(1_758_262_000_001);

  });
});
