import * as React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CredentialsSettingsView } from '@/components/CredentialsSettingsView';
import { getCodexQuotaRecovery } from '@/utils/codexQuotaRecovery';

export default React.memo(function CredentialsSettingsScreen() {
    const params = useLocalSearchParams<{
        quotaRecovery?: string;
        sessionId?: string;
        machineId?: string;
    }>();
    const router = useRouter();
    const recovery = getCodexQuotaRecovery(params);
    return <CredentialsSettingsView
        key={recovery ? `${recovery.sessionId}:${recovery.machineId ?? ''}:${recovery.action}` : 'settings'}
        quotaRecovery={recovery}
        onReturnToSession={recovery ? () => router.dismissTo({
            pathname: '/session/[id]',
            params: { id: recovery.sessionId },
        }) : undefined}
    />;
});
