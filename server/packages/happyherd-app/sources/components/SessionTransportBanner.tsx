import * as React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { recoverSessionTransport, type SessionTransportStatus } from '@/sync/sessionTransport';

export function transportCause(status: SessionTransportStatus): string {
    switch (status.errorCode) {
        case 'dns': return t('superSession.causeDns');
        case 'http': return t('superSession.causeHttp');
        case 'connect': return t('superSession.causeConnect');
        case 'closed': return t('superSession.causeClosed');
        case 'stale-endpoint': return t('superSession.causeStaleEndpoint');
        case 'recovery-timeout': return t('superSession.causeTimeout');
        default: return t('superSession.causeUnavailable');
    }
}
export function SessionTransportBanner({ status, machineId }: { status: SessionTransportStatus; machineId: string }) {
    const { theme } = useUnistyles();
    const busy = status.state === 'reconnecting';
    return <View accessibilityLiveRegion="polite" style={{ padding: 12, gap: 8, borderRadius: 12, backgroundColor: theme.colors.surface }}>
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '600' }}>{busy ? t('superSession.reconnecting') : t('superSession.disconnected')}</Text>
        <Text style={{ color: theme.colors.text, fontSize: 14 }}>{transportCause(status)}</Text>
        <Text style={{ color: theme.colors.text, fontSize: 14 }}>{t('superSession.pendingReplay')}</Text>
        {status.canRecover && <Pressable accessibilityRole="button" accessibilityLabel={t('superSession.reconnect')} disabled={busy}
            onPress={() => { void recoverSessionTransport(machineId, status.sessionId); }}
            style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, opacity: busy ? 0.6 : 1 }}>
            {busy && <ActivityIndicator size="small" color={theme.colors.textLink} />}
            <Text style={{ color: theme.colors.textLink, fontSize: 16 }}>{busy ? t('superSession.reconnecting') : t('superSession.reconnect')}</Text>
        </Pressable>}
    </View>;
}
