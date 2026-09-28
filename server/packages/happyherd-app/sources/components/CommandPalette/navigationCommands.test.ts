import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ t: (key: string) => key }));

import { closeFocusSetup, useFocusSetupRequest } from '@/components/focusSetup';
import { buildNavigationCommands } from './navigationCommands';

function build(overrides: Partial<Parameters<typeof buildNavigationCommands>[0]> = {}) {
    const push = vi.fn();
    const commands = buildNavigationCommands({
        machineWorkspace: true,
        focusActive: false,
        push,
        ...overrides,
    });
    return { commands, push };
}

afterEach(() => closeFocusSetup());

describe('command palette Navigation destinations', () => {
    it('lists Workspace, Automations, Projects and Focus mode in the Navigation group, as the mock does', () => {
        const { commands } = build();
        expect(commands.map((command) => command.id)).toEqual(['workspace', 'automations', 'projects', 'focus-mode']);
        expect(new Set(commands.map((command) => command.category))).toEqual(new Set(['Navigation']));
        expect(commands.map((command) => command.title)).toEqual(['workspace.title', 'happyHerd.automations.title', 'sidebar.projects', 'focusMode.enter']);
    });

    it('opens each destination through its existing route', () => {
        const { commands, push } = build();
        for (const id of ['workspace', 'automations', 'projects']) commands.find((command) => command.id === id)!.action();
        expect(push.mock.calls.map(([route]) => route)).toEqual(['/workspace', '/automations', '/projects']);
    });

    it('leaves Workspace out while the machine workspace is off', () => {
        expect(build({ machineWorkspace: false }).commands.map((command) => command.id)).toEqual(['automations', 'projects', 'focus-mode']);
    });

    it('opens the Focus setup through its opener, drawn with the shell\'s Focus glyph', () => {
        const { commands, push } = build();
        const focus = commands.find((command) => command.id === 'focus-mode')!;
        expect(focus.glyph).toBe('focus');
        expect(focus.icon).toBeUndefined();
        expect(useFocusSetupRequest.getState().request).toBeNull();
        focus.action();
        expect(useFocusSetupRequest.getState().request).toMatchObject({ projectId: undefined });
        expect(push).not.toHaveBeenCalled();
    });

    it('offers Focus mode only while focus is off', () => {
        expect(build({ focusActive: true }).commands.some((command) => command.id === 'focus-mode')).toBe(false);
    });
});
