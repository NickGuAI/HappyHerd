import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ data: new Map<string, string>() }));
vi.mock('react-native-mmkv', () => ({ MMKV: class {
    getString(key: string) { return state.data.get(key); }
    set(key: string, value: string) { state.data.set(key, value); }
} }));
import { loadLocalSettings, saveLocalSettings } from './persistence';
import { applyLocalSettings } from './localSettings';
beforeEach(() => state.data.clear());
describe('onboarding checklist device persistence', () => {
    it('defaults old devices to unchecked and retains each step and unrelated preferences across reloads', async () => {
        state.data.set('local-settings', JSON.stringify({ themePreference: 'dark', collapsedProjects: { project: true } }));
        const initial = loadLocalSettings();
        expect(initial.linkComputerChecklist).toEqual({});
        saveLocalSettings(applyLocalSettings(initial, { linkComputerChecklist: { install: true } }));
        vi.resetModules();
        const reinitialized = await import('./persistence');
        const afterInstall = reinitialized.loadLocalSettings();
        expect(afterInstall.linkComputerChecklist).toEqual({ install: true });
        reinitialized.saveLocalSettings(applyLocalSettings(afterInstall, { linkComputerChecklist: { ...afterInstall.linkComputerChecklist, open: true } }));
        expect(loadLocalSettings().linkComputerChecklist).toEqual({ install: true, open: true });
        saveLocalSettings(applyLocalSettings(loadLocalSettings(), { linkComputerChecklist: { install: false, open: true } }));
        expect(loadLocalSettings()).toMatchObject({ linkComputerChecklist: { install: false, open: true }, themePreference: 'dark', collapsedProjects: { project: true } });
        expect([...state.data.keys()]).toEqual(['local-settings']);
    });
});
