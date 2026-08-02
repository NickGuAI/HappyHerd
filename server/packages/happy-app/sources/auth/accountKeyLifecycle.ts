export type AccountLoginMethod = 'new-account' | 'account-key' | 'linked-device';

export const accountAccessRoutes = {
    accountKey: '/restore/manual',
    linkedDevice: '/restore',
} as const;

export function requiresAccountKeyBackup(method: AccountLoginMethod): boolean {
    return method === 'new-account';
}

export function canConfirmAccountKeyBackup(hasCopiedAccountKey: boolean): boolean {
    return hasCopiedAccountKey;
}
