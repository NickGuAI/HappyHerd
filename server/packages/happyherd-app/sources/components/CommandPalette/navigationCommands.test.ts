import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ t: (key: string) => key }));

import { buildNavigationCommands, FOCUS_MODE_ENTER_SELECTOR } from './navigationCommands';

function build(overrides: Partial<Parameters<typeof buildNavigationCommands>[0]> = {}) {
    const push = vi.fn();
    const click = vi.fn();
    const commands = buildNavigationCommands({
        machineWorkspace: true,
        focusActive: false,
        web: true,
        push,
        findFocusControl: () => ({ click }),
        ...overrides,
    });
    return { commands, push, click };
}

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

    it('opens the Focus setup by pressing the top bar\'s Focus control', () => {
        const { commands, click, push } = build();
        commands.find((command) => command.id === 'focus-mode')!.action();
        expect(click).toHaveBeenCalledTimes(1);
        expect(push).not.toHaveBeenCalled();
        expect(FOCUS_MODE_ENTER_SELECTOR).toBe('[data-testid="focus-mode-enter"]');
    });

    it('offers Focus mode only while focus is off and only on web, where the control shows', () => {
        expect(build({ focusActive: true }).commands.some((command) => command.id === 'focus-mode')).toBe(false);
        expect(build({ web: false }).commands.some((command) => command.id === 'focus-mode')).toBe(false);
    });

    it('does nothing when no Focus control is on the page', () => {
        const { commands } = build({ findFocusControl: () => null });
        expect(() => commands.find((command) => command.id === 'focus-mode')!.action()).not.toThrow();
    });
});
