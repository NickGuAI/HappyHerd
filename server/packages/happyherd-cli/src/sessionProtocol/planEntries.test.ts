import { describe, expect, it } from 'vitest';
import { readPlanEntries } from './planEntries';

describe('readPlanEntries', () => {
    it('retains every standard status, priority and the exact provider content', () => {
        const entries = [
            { content: '  Inspect source\n', status: 'pending', priority: 'high', providerExtra: true },
            { content: 'Patch', status: 'in_progress', priority: 'medium' },
            { content: 'Verify', status: 'completed', priority: 'low' },
        ];
        expect(readPlanEntries({ entries })).toEqual([
            { content: '  Inspect source\n', status: 'pending', priority: 'high' },
            { content: 'Patch', status: 'in_progress', priority: 'medium' },
            { content: 'Verify', status: 'completed', priority: 'low' },
        ]);
        expect(readPlanEntries({ entries })?.[0]).not.toBe(entries[0]);
    });

    it('distinguishes an explicit empty snapshot from an invalid snapshot', () => {
        expect(readPlanEntries({ entries: [] })).toEqual([]);
        expect(readPlanEntries({})).toBeNull();
        expect(readPlanEntries({ entries: undefined })).toBeNull();
    });

    it.each([
        null, undefined, 1, 'plan', [], { entries: {} }, { entries: [null] },
        { entries: [{ content: 1, status: 'pending' }] },
        { entries: [{ content: 'Step', status: 'inProgress' }] },
        { entries: [{ content: 'Step', status: ['pending'] }] },
        { entries: [{ content: 'Step', status: 'pending', priority: ['high'] }] },
        { entries: [{ content: 'Step', status: 'pending', priority: 'urgent' }] },
    ])('rejects malformed snapshots without coercion: %j', payload => {
        expect(readPlanEntries(payload)).toBeNull();
    });
});
