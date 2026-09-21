import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { useSession } from '@/sync/storage';
import { buildWorkspaceAttachmentParams } from '@/utils/machineWorkspace';

/**
 * Compatibility route for old bookmarks and native stacks.
 *
 * The former session/git-scoped file browser was deliberately retired. File
 * selection now happens in the machine-scoped Workspace and returns to the
 * same session with staged attachment chips.
 */
export default function LegacySessionFilesRedirect() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const session = useSession(sessionId || '');

    React.useEffect(() => {
        if (!sessionId || !session) return;
        const params = buildWorkspaceAttachmentParams(sessionId, session.metadata);
        if (!params) {
            router.replace('/workspace');
            return;
        }
        router.replace({
            pathname: '/workspace',
            params,
        });
    }, [router, session, sessionId]);

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={theme.colors.textSecondary} />
        </View>
    );
}
