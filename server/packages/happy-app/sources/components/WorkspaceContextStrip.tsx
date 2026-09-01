import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

import { t } from '@/text';
import { workspaceContextEntryKey, type WorkspaceContextEntry } from '@/sync/workspaceContext';

export const WorkspaceContextStrip = React.memo(function WorkspaceContextStrip({
    entries,
    onRemove,
}: {
    entries: readonly WorkspaceContextEntry[];
    onRemove: (entry: WorkspaceContextEntry) => void;
}) {
    const { theme } = useUnistyles();
    if (entries.length === 0) return null;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.container}>
            {entries.map((entry) => (
                <View key={workspaceContextEntryKey(entry)} style={[styles.chip, { borderColor: theme.colors.divider }]}>
                    <Ionicons
                        name={entry.kind === 'directory' ? 'folder-outline' : 'document-attach-outline'}
                        size={14}
                        color={theme.colors.textLink}
                    />
                    <Text style={[styles.label, { color: theme.colors.text }]} numberOfLines={1}>
                        {entry.path}
                    </Text>
                    <Pressable
                        onPress={() => onRemove(entry)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t("uiCopy.removeValueFromMessageContext", { value1: entry.path })}
                    >
                        <Ionicons name="close-circle" size={16} color={theme.colors.textSecondary} />
                    </Pressable>
                </View>
            ))}
        </ScrollView>
    );
});

const styles = StyleSheet.create(() => ({
    container: { gap: 6, paddingHorizontal: 8, paddingTop: 8 },
    chip: {
        maxWidth: 260,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    label: { maxWidth: 210, fontSize: 12, ...Typography.mono() },
}));
