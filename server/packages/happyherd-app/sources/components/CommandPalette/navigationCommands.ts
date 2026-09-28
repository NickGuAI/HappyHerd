import { t } from '@/text';
import type { Command } from './types';

/** The top bar's Focus control, the only owner of the Focus setup. */
export const FOCUS_MODE_ENTER_SELECTOR = '[data-testid="focus-mode-enter"]';

/**
 * The mock's Navigation destinations beyond Settings (UI overhaul): the
 * panel's Workspace (when enabled), Automations and Projects, and Focus mode.
 * Focus setup belongs to the top bar's Focus control, which exports no opener,
 * so the command presses that control; it is listed only on web while focus
 * is off, which is when the control shows.
 */
export function buildNavigationCommands(input: {
    machineWorkspace: boolean;
    focusActive: boolean;
    web: boolean;
    push: (route: string) => void;
    findFocusControl?: () => { click: () => void } | null;
}): Command[] {
    const findFocusControl = input.findFocusControl
        ?? (() => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(FOCUS_MODE_ENTER_SELECTOR)));
    return [
        ...(input.machineWorkspace ? [{
            id: 'workspace',
            title: t('workspace.title'),
            subtitle: t('workspace.featureSubtitle'),
            icon: 'folder-open-outline',
            category: 'Navigation',
            action: () => input.push('/workspace'),
        }] : []),
        {
            id: 'automations',
            title: t('happyHerd.automations.title'),
            subtitle: t('happyHerd.automations.subtitle'),
            icon: 'time-outline',
            category: 'Navigation',
            action: () => input.push('/automations'),
        },
        {
            id: 'projects',
            title: t('sidebar.projects'),
            icon: 'albums-outline',
            category: 'Navigation',
            action: () => input.push('/projects'),
        },
        ...(!input.focusActive && input.web ? [{
            id: 'focus-mode',
            title: t('focusMode.enter'),
            subtitle: t('focusMode.title'),
            icon: 'timer-outline',
            category: 'Navigation',
            action: () => findFocusControl()?.click(),
        }] : []),
    ];
}
