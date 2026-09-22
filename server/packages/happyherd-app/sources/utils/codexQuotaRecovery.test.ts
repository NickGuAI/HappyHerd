import { describe, expect, it } from 'vitest';
import { getCodexQuotaRecovery } from './codexQuotaRecovery';

describe('Codex quota Credentials route', () => {
    it.each(['connect-account', 'add-api-key'])('retains the exact origin for %s', (quotaRecovery) => {
        expect(getCodexQuotaRecovery({ quotaRecovery, sessionId: 'session-1', machineId: 'machine-1' })).toEqual({
            action: quotaRecovery, sessionId: 'session-1', machineId: 'machine-1',
        });
    });

    it('keeps the session return path without inventing a missing machine', () => {
        expect(getCodexQuotaRecovery({ quotaRecovery: 'connect-account', sessionId: 'session-1' })).toEqual({
            action: 'connect-account', sessionId: 'session-1',
        });
    });

    it.each([
        {},
        { quotaRecovery: 'other', sessionId: 'session-1' },
        { quotaRecovery: 'connect-account' },
        { quotaRecovery: 'connect-account', sessionId: ' ' },
        { quotaRecovery: ['connect-account', 'add-api-key'], sessionId: 'session-1' },
        { quotaRecovery: 'connect-account', sessionId: ['session-1', 'session-2'] },
    ])('does not open a recovery form for incomplete or ambiguous params %j', (params) => {
        expect(getCodexQuotaRecovery(params)).toBeUndefined();
    });
});
