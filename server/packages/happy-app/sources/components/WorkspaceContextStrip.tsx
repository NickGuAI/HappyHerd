import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

import { t } from '@/text';
export const WorkspaceContextStrip = React.memo(function WorkspaceContextStrip({
    files,
    onRemove,
}: {
    files: readonly string[];
    onRemove: (filePath: string) => void;
}) {
    const { theme } = useUnistyles();
    if (files.length === 0) return null;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.container}>
            {files.map((filePath) => (
                <View key={filePath} style={[styles.chip, { borderColor: theme.colors.divider }]}>
                    <Ionicons name="document-attach-outline" size={14} color={theme.colors.textLink} />
                    <Text style={[styles.label, { color: theme.colors.text }]} numberOfLines={1}>
                        {filePath}
                    </Text>
                    <Pressable
                        onPress={() => onRemove(filePath)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t("uiCopy.removeValueFromMessageContext", { value1: filePath })}
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
