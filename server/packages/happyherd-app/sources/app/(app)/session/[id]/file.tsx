import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FileViewPanel } from '@/components/FileViewPanel';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { t } from '@/text';
import { storage } from '@/sync/storage';
import { resolveSessionFilePath } from '@/utils/sessionFileLinks';

function decodePath(encodedPath: string | undefined): string {
    if (!encodedPath) return '';
    try {
        return atob(encodedPath);
    } catch {
        return encodedPath;
    }
}

/**
 * Compatibility route used by FilesSidebar and tool-result links. Rendering is
 * intentionally delegated to FileViewPanel so every supported file entrypoint
 * shares link resolution, inline review, JSON Canvas, previews, and editing.
 */
export default React.memo(function FileScreen() {
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const params = useLocalSearchParams<{ id: string; path?: string; line?: string; column?: string }>();
    const sessionId = params.id;
    const sessionPath = storage.getState().sessions[sessionId]?.metadata?.path ?? null;
    const rawPath = decodePath(params.path);
    const resolvedPath = resolveSessionFilePath(rawPath, sessionPath);
    const filePath = resolvedPath?.absolutePath ?? rawPath;
    const requestedLine = params.line ? Number.parseInt(params.line, 10) : null;
    const requestedColumn = params.column ? Number.parseInt(params.column, 10) : null;
    const [headerRight, setHeaderRight] = React.useState<React.ReactNode>(null);
    const [dirty, setDirty] = React.useState(false);
    const allowDiscardRef = React.useRef(false);

    React.useEffect(() => {
        allowDiscardRef.current = false;
    }, [filePath]);

    React.useEffect(() => navigation.addListener('beforeRemove', (event) => {
        if (!dirty || allowDiscardRef.current) return;
        event.preventDefault();
        void Modal.confirm(
            t('uiCopy.discardUnsavedChanges'),
            t('uiCopy.yourEditsToValueHaveNotBeenSaved', { value1: filePath.split('/').pop() || filePath }),
            { confirmText: t('common.discard'), destructive: true },
        ).then((confirmed) => {
            if (!confirmed) return;
            allowDiscardRef.current = true;
            navigation.dispatch(event.data.action);
        });
    }), [dirty, filePath, navigation]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.header, { backgroundColor: theme.colors.surfaceHigh, borderBottomColor: theme.colors.divider }]}>
                <Text selectable numberOfLines={2} style={[styles.path, { color: theme.colors.textSecondary }]}>
                    {requestedLine && requestedLine > 0
                        ? `${filePath}:${requestedLine}${requestedColumn && requestedColumn > 0 ? `:${requestedColumn}` : ''}`
                        : filePath}
                </Text>
                {headerRight}
            </View>
            <FileViewPanel
                sessionId={sessionId}
                filePath={filePath}
                onHeaderRightSlotChange={setHeaderRight}
                onDirtyChange={setDirty}
                requestedLine={requestedLine}
                requestedColumn={requestedColumn}
            />
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: { flex: 1 },
    header: {
        minHeight: 52,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    path: { ...Typography.mono(), fontSize: 13, flex: 1 },
}));
