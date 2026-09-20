import type { NewSessionPickerItem } from './newSessionPickerItems';

export const CREATE_COMMANDER_PICKER_KEY = '__create-commander__';
export const NO_COMMANDER_PICKER_KEY = '__none__';

type CommanderPickerCopy = {
    createLabel: string;
    createSubtitle: string;
    noneLabel: string;
    noneSubtitle: string;
};

export type CommanderPickerSelection =
    | { kind: 'create' }
    | { kind: 'select'; commanderId: string | null };

export function getCommanderPickerFixedItems(
    copy: CommanderPickerCopy,
): NewSessionPickerItem[] {
    const noneItem: NewSessionPickerItem = {
        key: NO_COMMANDER_PICKER_KEY,
        label: copy.noneLabel,
        subtitle: copy.noneSubtitle,
    };

    return [
        noneItem,
        {
            key: CREATE_COMMANDER_PICKER_KEY,
            label: copy.createLabel,
            subtitle: copy.createSubtitle,
            kind: 'action',
        },
    ];
}

export function resolveCommanderPickerSelection(key: string): CommanderPickerSelection {
    if (key === CREATE_COMMANDER_PICKER_KEY) {
        return { kind: 'create' };
    }

    return {
        kind: 'select',
        commanderId: key === NO_COMMANDER_PICKER_KEY ? null : key,
    };
}
