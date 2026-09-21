import { describe, expect, it } from 'vitest';
import {
    CREATE_COMMANDER_PICKER_KEY,
    getCommanderPickerFixedItems,
    NO_COMMANDER_PICKER_KEY,
    resolveCommanderPickerSelection,
} from './newSessionCommanderCreation';

const copy = {
    createLabel: 'Create Commander',
    createSubtitle: 'Start a guided onboarding session',
    noneLabel: 'No Commander',
    noneSubtitle: 'Use global AGENTS.md only',
};

describe('new session Commander creation entry', () => {
    it('shares Commander choices and the creation intent across all platforms', () => {
        expect(getCommanderPickerFixedItems(copy)).toEqual([
            {
                key: NO_COMMANDER_PICKER_KEY,
                label: copy.noneLabel,
                subtitle: copy.noneSubtitle,
            },
            {
                key: CREATE_COMMANDER_PICKER_KEY,
                label: copy.createLabel,
                subtitle: copy.createSubtitle,
                kind: 'action',
            },
        ]);
    });

    it('distinguishes creation intent from ordinary Commander selection', () => {
        expect(resolveCommanderPickerSelection(CREATE_COMMANDER_PICKER_KEY)).toEqual({ kind: 'create' });
        expect(resolveCommanderPickerSelection(NO_COMMANDER_PICKER_KEY)).toEqual({ kind: 'select', commanderId: null });
        expect(resolveCommanderPickerSelection('athena')).toEqual({ kind: 'select', commanderId: 'athena' });
    });
});
