type AgentPickerSource = {
    key: string;
    label: string;
    description?: string;
    disabled?: boolean;
};

type ModePickerSource = {
    key: string;
    name: string;
    description?: string | null;
    disabled?: boolean;
    unavailable?: boolean;
    providerId?: string;
    providerName?: string;
};

export type NewSessionPickerItem = {
    key: string;
    label: string;
    subtitle?: string;
    kind?: 'option' | 'action';
    disabled?: boolean;
    section?: string;
};

export function getAgentPickerItems(agents: AgentPickerSource[]): NewSessionPickerItem[] {
    return agents.map((agent) => ({
        key: agent.key,
        label: agent.label,
        ...(agent.description ? { subtitle: agent.description } : {}),
        ...(agent.disabled ? { disabled: true } : {}),
    }));
}

export function getModePickerItems(options: ModePickerSource[]): NewSessionPickerItem[] {
    const hasProviders = options.some((option) => option.providerId || option.providerName);
    const available = options.filter((option) => !option.disabled && !option.unavailable);
    const unavailable = options.filter((option) => option.disabled || option.unavailable);
    const ordered = hasProviders
        ? [...available.reduce((groups, option) => {
            const groupKey = option.providerId || option.providerName || '__models__';
            const group = groups.get(groupKey) ?? [];
            group.push(option);
            groups.set(groupKey, group);
            return groups;
        }, new Map<string, ModePickerSource[]>()).values()].flat().concat(unavailable)
        : [...available, ...unavailable];

    return ordered.map((option) => ({
        key: option.key,
        label: option.name,
        ...(option.disabled || option.unavailable ? { disabled: true } : {}),
        ...(option.description && option.description !== option.providerName
            ? { subtitle: option.description }
            : {}),
        ...(!option.disabled && !option.unavailable && (option.providerName || option.providerId)
            ? { section: option.providerName || option.providerId }
            : {}),
    }));
}
