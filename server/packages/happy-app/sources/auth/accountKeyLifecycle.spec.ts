import { describe, expect, it } from 'vitest';
import {
    accountAccessRoutes,
    canConfirmAccountKeyBackup,
    requiresAccountKeyBackup,
} from './accountKeyLifecycle';

describe('account key lifecycle', () => {
    it('requires a backup gate only for newly created accounts', () => {
        expect(requiresAccountKeyBackup('new-account')).toBe(true);
        expect(requiresAccountKeyBackup('account-key')).toBe(false);
        expect(requiresAccountKeyBackup('linked-device')).toBe(false);
    });

    it('provides a direct account-key route and keeps device linking separate', () => {
        expect(accountAccessRoutes.accountKey).toBe('/restore/manual');
        expect(accountAccessRoutes.linkedDevice).toBe('/restore');
        expect(accountAccessRoutes.accountKey).not.toBe(accountAccessRoutes.linkedDevice);
    });

    it('does not allow backup confirmation before the key is copied', () => {
        expect(canConfirmAccountKeyBackup(false)).toBe(false);
        expect(canConfirmAccountKeyBackup(true)).toBe(true);
    });
});
