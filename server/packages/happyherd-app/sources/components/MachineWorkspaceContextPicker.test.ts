import { describe, expect, it } from 'vitest';

import { sortWorkspaceContextTreeEntries } from '@/utils/machineWorkspaceContext';

describe('MachineWorkspaceContextPicker', () => {
    it('sorts one-level context choices with folders first and names ascending', () => {
        expect(sortWorkspaceContextTreeEntries([
            { name: 'é.txt', path: '/work/é.txt', type: 'file' },
            { name: 'beta', path: '/work/beta', type: 'directory' },
            { name: 'a.txt', path: '/work/a.txt', type: 'file' },
            { name: 'Alpha', path: '/work/Alpha', type: 'directory' },
            { name: 'Z.txt', path: '/work/Z.txt', type: 'file' },
        ]).map((entry) => entry.name)).toEqual(['Alpha', 'beta', 'Z.txt', 'a.txt', 'é.txt']);
    });
});
