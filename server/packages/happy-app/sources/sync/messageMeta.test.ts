import { describe, expect, it } from 'vitest';
import { resolveMessageModeMeta } from './messageMeta';
import { rigMetadataFixture } from './__testdata__/rigMetadata';
import { resolveAgentDefaultEffortLevel } from './agentDefaults';

describe('resolveMessageModeMeta', () => {
    it('omits agent mode metadata when nothing was explicitly overridden', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'codex' },
        } as any);

        expect(meta).toEqual({});
    });

    // The composer resolves a saved `dontAsk` to Auto because the key is gone
    // from the catalog. Without retiring it at the read path the wire kept
    // sending `dontAsk`, which the CLI's message schema rejects outright.
    it('retires a dontAsk left on an existing session instead of sending it', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: 'dontAsk',
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'claude' },
        } as any);

        expect(meta.permissionMode).toBe('acceptEdits');
    });

    it('retires a saved dontAsk default instead of sending it', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'claude' },
        } as any, {
            agentDefaultOverrides: { claude: { permissionMode: 'dontAsk' } },
        } as any);

        expect(meta.permissionMode).toBe('acceptEdits');
    });

    it('sends explicit per-session overrides', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: 'read-only',
            modelMode: 'gpt-5.6-terra',
            effortLevel: 'high',
            metadata: { flavor: 'codex' },
        } as any);

        expect(meta).toEqual({
            permissionMode: 'read-only',
            model: 'gpt-5.6-terra',
            effort: 'high',
        });
    });

    it('omits Claude default permission but forwards Codex default permission', () => {
        expect(resolveMessageModeMeta({
            permissionMode: 'default',
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'claude' },
        } as any)).toEqual({});

        expect(resolveMessageModeMeta({
            permissionMode: 'default',
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'codex' },
        } as any)).toEqual({ permissionMode: 'default' });
    });

    it('sends settings-level overrides when session has no override', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'claude' },
        } as any, {
            agentDefaultOverrides: {
                claude: {
                    permissionMode: 'bypassPermissions',
                    modelMode: 'opus',
                    effortLevel: 'medium',
                },
            },
        } as any);

        expect(meta).toEqual({
            permissionMode: 'bypassPermissions',
            model: 'opus',
            effort: 'medium',
        });
    });

    it('lets session overrides beat settings-level overrides', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: 'default',
            modelMode: 'gpt-5.6-terra',
            effortLevel: 'xhigh',
            metadata: { flavor: 'codex' },
        } as any, {
            agentDefaultOverrides: {
                codex: {
                    permissionMode: 'yolo',
                    modelMode: 'gpt-5.6-luna',
                    effortLevel: 'medium',
                },
            },
        } as any);

        expect(meta).toEqual({
            permissionMode: 'default',
            model: 'gpt-5.6-terra',
            effort: 'xhigh',
        });
    });

    it('never re-emits an unsupported saved Codex effort after model-aware launch fallback', () => {
        const availableEfforts = [
            { key: 'low' },
            { key: 'medium' },
            { key: 'high' },
            { key: 'xhigh' },
        ];
        const settings = {
            agentDefaultOverrides: {
                codex: {
                    effortLevel: 'ultra',
                },
            },
        } as any;

        // This is the concrete value the new-session launcher gives Codex.
        expect(resolveAgentDefaultEffortLevel(
            settings.agentDefaultOverrides,
            'codex',
            availableEfforts,
        )).toBe('xhigh');

        // Matching the effective default leaves no per-session override. The
        // outbound path must still resolve against the same model catalog,
        // rather than leaking the raw synchronized `ultra` preference.
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: 'gpt-5.6-sol',
            effortLevel: null,
            metadata: { flavor: 'codex' },
        } as any, settings, { availableEfforts });

        expect(meta).toEqual({
            model: 'gpt-5.6-sol',
            effort: 'xhigh',
        });
        expect(settings.agentDefaultOverrides.codex.effortLevel).toBe('ultra');
    });

    it('omits effort when the authoritative selected model advertises none', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: 'no-reasoning',
            effortLevel: null,
            metadata: { flavor: 'codex' },
        } as any, {
            agentDefaultOverrides: {
                codex: { effortLevel: 'xhigh' },
            },
        } as any, { availableEfforts: [] });

        expect(meta).toEqual({ model: 'no-reasoning' });
    });

    it('passes a custom codex model through unchanged', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: 'my-workspace-model',
            effortLevel: null,
            metadata: { flavor: 'codex' },
        } as any);

        expect(meta).toEqual({ model: 'my-workspace-model' });
    });

    it('uses a custom codex model saved in agent settings', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'codex' },
        } as any, {
            agentDefaultOverrides: {
                codex: { modelMode: 'my-workspace-model' },
            },
        } as any);

        expect(meta).toEqual({ model: 'my-workspace-model' });
    });

    it('omits an explicit default model sentinel', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: 'default',
            effortLevel: null,
            metadata: { flavor: 'claude' },
        } as any);

        expect(meta).toEqual({});
    });

    it('keeps GrokBuild permission launch-only while retaining runtime model and effort controls', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: 'dontAsk',
            modelMode: null,
            effortLevel: null,
            metadata: { flavor: 'grok' },
        } as any, {
            agentDefaultOverrides: {
                grok: {
                    permissionMode: 'auto',
                    modelMode: 'grok-runtime-model',
                    effortLevel: 'thorough',
                },
            },
        } as any, { availableEfforts: [{ key: 'thorough' }] });

        expect(meta).toEqual({
            model: 'grok-runtime-model',
            effort: 'thorough',
        });
    });

    it('sends canonical Rig selection metadata using mode code rather than semantic kind', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: 'auto',
            modelMode: 'claude:shared-model',
            effortLevel: 'max',
            metadata: rigMetadataFixture,
        } as any);

        expect(meta).toEqual({
            permissionMode: 'auto',
            model: 'shared-model',
            modelProviderId: 'claude',
            effort: 'max',
        });
        expect(meta.permissionMode).not.toBe('safe-yolo');
    });

    it('does not carry an unsupported reasoning value across a Rig model change', () => {
        const meta = resolveMessageModeMeta({
            permissionMode: null,
            modelMode: 'claude:shared-model',
            effortLevel: 'medium',
            metadata: rigMetadataFixture,
        } as any);

        expect(meta.effort).toBe('high');
    });
});
