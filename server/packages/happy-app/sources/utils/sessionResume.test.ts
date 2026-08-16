import { describe, expect, it } from 'vitest';

import type { Machine, Session } from '@/sync/storageTypes';
import { getResumeAvailability } from './sessionResume';

function resumableSession(): Session {
    return {
        id: 'happy-session',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: {
            path: '/workspace',
            flavor: 'codex',
            machineId: 'machine-1',
            codexThreadId: 'codex-thread',
        } as Session['metadata'],
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        presence: 1,
    };
}

function onlineMachine(): Machine {
    return {
        id: 'machine-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

describe('getResumeAvailability', () => {
    it('offers resume for an eligible disconnected provider session without a feature flag', () => {
        expect(getResumeAvailability(resumableSession(), onlineMachine(), false)).toMatchObject({
            canResume: true,
            canShowResume: true,
        });
    });

    it('keeps resume unavailable while the provider session is connected', () => {
        expect(getResumeAvailability(resumableSession(), onlineMachine(), true)).toMatchObject({
            canResume: false,
            canShowResume: false,
        });
    });
});
