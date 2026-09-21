import { describe, expect, it } from 'vitest';

import {
    GrokPermissionModeTransitionReceiptSchema,
    GrokPermissionModeTransitionRequestSchema,
} from './grokPermissionMode';

describe('Grok permission mode transition wire contract', () => {
    it('accepts an exact session request and authoritative receipt', () => {
        expect(GrokPermissionModeTransitionRequestSchema.parse({
            sessionId: 'happyherd-session',
            permissionMode: 'bypassPermissions',
        })).toEqual({
            sessionId: 'happyherd-session',
            permissionMode: 'bypassPermissions',
        });
        expect(GrokPermissionModeTransitionReceiptSchema.parse({
            type: 'success',
            sessionId: 'happyherd-session',
            permissionMode: 'bypassPermissions',
        })).toEqual({
            type: 'success',
            sessionId: 'happyherd-session',
            permissionMode: 'bypassPermissions',
        });
    });

    it('rejects empty session and permission identities', () => {
        expect(GrokPermissionModeTransitionRequestSchema.safeParse({
            sessionId: '',
            permissionMode: 'default',
        }).success).toBe(false);
        expect(GrokPermissionModeTransitionReceiptSchema.safeParse({
            type: 'success',
            sessionId: 'happyherd-session',
            permissionMode: '',
        }).success).toBe(false);
    });
});
