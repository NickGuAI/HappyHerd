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
};

export type NewSessionPickerItem = {
    key: string;
    label: string;
    subtitle?: string;
    kind?: 'option' | 'action';
    disabled?: boolean;
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
    return options.map((option) => ({
        key: option.key,
        label: option.name,
        ...(option.description ? { subtitle: option.description } : {}),
        ...(option.disabled || option.unavailable ? { disabled: true } : {}),
    }));
}
