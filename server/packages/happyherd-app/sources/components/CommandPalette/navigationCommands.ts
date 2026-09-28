import { t } from '@/text';
import { openFocusSetup } from '@/components/focusSetup';
import type { Command } from './types';

/**
 * The mock's Navigation destinations beyond Settings (UI overhaul): the
 * panel's Workspace (when enabled), Automations and Projects, and Focus mode,
 * which opens the Focus setup while focus is off.
 */
export function buildNavigationCommands(input: {
    machineWorkspace: boolean;
    focusActive: boolean;
    push: (route: string) => void;
}): Command[] {
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
        ...(!input.focusActive ? [{
            id: 'focus-mode',
            title: t('focusMode.enter'),
            subtitle: t('focusMode.title'),
            glyph: 'focus' as const,
            category: 'Navigation',
            action: () => openFocusSetup(),
        }] : []),
    ];
}
