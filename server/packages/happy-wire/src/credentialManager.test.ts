import { describe, expect, it } from 'vitest';

import {
    CredentialLoginFlowSchema,
    CredentialManagerSnapshotSchema,
    SavedCredentialErrorCodeSchema,
    SavedCredentialUpsertRequestSchema,
} from './credentialManager';

describe('credential manager wire contract', () => {
    it('keeps credential summaries secret-free', () => {
        const parsed = CredentialManagerSnapshotSchema.parse({
            accounts: [{
                id: '00000000-0000-4000-8000-000000000006',
                provider: 'claude',
                name: 'work',
                status: 'stored',
                current: true,
                limitedUntil: null,
                createdAt: 1,
                updatedAt: 2,
                credentialVersion: 1,
            }],
            credentials: [{
                id: 'credential-1',
                name: 'Example token',
                type: 'token',
                service: 'api.example.test',
                username: null,
                usage: ['skills', 'mcp'],
                version: 0,
                createdAt: 1,
                updatedAt: 2,
                secret: 'must-be-stripped',
            }],
        });

        expect(parsed.credentials[0]).not.toHaveProperty('secret');
        expect(JSON.stringify(parsed)).not.toContain('must-be-stripped');
    });

    it('requires a secret on create and allows an omitted secret on versioned update', () => {
        expect(SavedCredentialUpsertRequestSchema.safeParse({
            name: 'Example token',
            type: 'token',
            service: 'api.example.test',
            usage: ['skills'],
        }).success).toBe(false);
        expect(SavedCredentialUpsertRequestSchema.safeParse({
            id: 'credential-1',
            expectedVersion: 2,
            name: 'Example token',
            type: 'token',
            service: 'api.example.test',
            usage: ['skills'],
        }).success).toBe(true);
        expect(SavedCredentialUpsertRequestSchema.safeParse({
            name: 'Example token',
            type: 'unknown',
            service: '',
            usage: [],
            secret: 'value',
        }).success).toBe(false);
    });

    it('keeps saved credential conflict causes distinct', () => {
        for (const code of [
            'saved-credential-limit-reached',
            'saved-credential-name-conflict',
            'saved-credential-version-conflict',
        ]) {
            expect(SavedCredentialErrorCodeSchema.parse(code)).toBe(code);
        }
        expect(SavedCredentialErrorCodeSchema.safeParse('saved-credential-conflict').success).toBe(false);
    });

    it('rejects secret-shaped fields from login status', () => {
        const flow = CredentialLoginFlowSchema.parse({
            id: 'flow-1',
            provider: 'codex',
            name: 'personal',
            state: 'waiting-user',
            verificationUrl: 'https://example.test/device',
            userCode: 'ABCD-EFGH',
            requiresCodeEntry: false,
            expiresAt: Date.now() + 1_000,
            token: 'must-be-stripped',
        });
        expect(flow).not.toHaveProperty('token');
    });
});
