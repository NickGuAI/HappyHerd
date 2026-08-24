import { describe, expect, it } from 'vitest';

import {
    resolvePermissionStyle,
    resolveSelectedOption,
    validateNewSessionLaunchSelection,
} from './newSessionModeSelection';

const modes = [
    { key: 'default', name: 'Default' },
    { key: 'yolo', name: 'YOLO' },
];

describe('new session mode selection', () => {
    it('resolves the indexed option and falls back to the first one', () => {
        expect(resolveSelectedOption(modes, 1)).toEqual({ key: 'yolo', name: 'YOLO' });
        expect(resolveSelectedOption(modes, 7)).toEqual({ key: 'default', name: 'Default' });
    });

    it('returns null when a Rig machine publishes no options at all', () => {
        // Rig machines with no `operatingModes` reach the composer with an
        // empty permission catalog; the screen must render without a pick.
        expect(resolveSelectedOption([], 0)).toBeNull();
        expect(resolveSelectedOption([], 3)).toBeNull();
    });

    it('has no permission accent without a selection or for the default mode', () => {
        expect(resolvePermissionStyle(null)).toBeNull();
        expect(resolvePermissionStyle(undefined)).toBeNull();
        expect(resolvePermissionStyle(resolveSelectedOption(modes, 0))).toBeNull();
        expect(resolvePermissionStyle(resolveSelectedOption([], 0))).toBeNull();
    });

    it('accents the permission modes that change agent behaviour', () => {
        expect(resolvePermissionStyle({ key: 'yolo' })?.color).toBe('#F87171');
        expect(resolvePermissionStyle({ key: 'plan' })?.icon).toBe('pause');
        expect(resolvePermissionStyle({ key: 'read-only' })?.icon).toBe('pause');
    });

    it('blocks recovery-only full-screen selections from reaching session spawn', () => {
        const base = {
            agentAvailable: true,
            permissionOptions: [{ key: 'yolo' }],
            modelOptions: [{ key: 'gpt-5.6-sol' }],
            effortOptions: [{ key: 'max' }],
            permissionKey: 'yolo',
            modelKey: 'gpt-5.6-sol',
            effortKey: 'max',
        };

        expect(validateNewSessionLaunchSelection(base)).toBeNull();
        expect(validateNewSessionLaunchSelection({
            ...base,
            agentAvailable: false,
        })).toBe('agent-unavailable');
        expect(validateNewSessionLaunchSelection({
            ...base,
            permissionOptions: [{ key: 'yolo', disabled: true }],
        })).toBe('permission-unavailable');
        expect(validateNewSessionLaunchSelection({
            ...base,
            modelOptions: [{ key: 'gpt-5.6-sol', unavailable: true }],
        })).toBe('model-unavailable');
        expect(validateNewSessionLaunchSelection({
            ...base,
            effortOptions: [],
        })).toBe('effort-unavailable');
    });

    it('allows a dimension with no explicit selection', () => {
        expect(validateNewSessionLaunchSelection({
            agentAvailable: true,
            permissionOptions: [],
            modelOptions: [],
            effortOptions: [],
            permissionKey: null,
            modelKey: null,
            effortKey: null,
        })).toBeNull();
    });
});
