import * as React from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import type { MachineFileUploadState } from '@/hooks/useMachineFileUpload';
import { t } from '@/text';

export function MachineFileUploadStatus(props: {
    state: MachineFileUploadState;
    canCancel: boolean;
    canRetry: boolean;
    onCancel: () => void;
    onRetry: () => void;
    style?: StyleProp<ViewStyle>;
}) {
    const { theme } = useUnistyles();
    if (props.state.phase === 'idle') return null;

    const status = props.state.phase === 'uploading'
        ? t('workspace.uploading', {
            file: props.state.currentFile ?? '',
            completed: String(props.state.completed),
            total: String(props.state.total),
        })
        : props.state.phase === 'cancelling'
            ? t('workspace.uploadCancelling')
            : props.state.phase === 'cancelled'
                ? t('workspace.uploadCancelled', {
                    completed: String(props.state.completed),
                    total: String(props.state.total),
                })
                : props.state.phase === 'complete'
                    ? t('workspace.uploadComplete', { count: props.state.completed })
                    : props.state.error;
    const errorColor = props.state.phase === 'error' || props.state.phase === 'cancelled';

    return (
        <View style={[styles.container, props.style]}>
            <View style={styles.statusColumn}>
                <Text style={[
                    styles.status,
                    { color: errorColor ? theme.colors.status.disconnected : theme.colors.textSecondary },
                ]}>
                    {status}
                </Text>
                {props.state.target && (
                    <Text style={[styles.target, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {[props.state.target.label, props.state.target.directory].filter(Boolean).join(' · ')}
                    </Text>
                )}
            </View>
            {props.canCancel && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    onPress={props.onCancel}
                    style={({ pressed }) => [
                        styles.action,
                        { borderColor: theme.colors.divider, opacity: pressed ? 0.65 : 1 },
                    ]}
                >
                    <Text style={[styles.actionText, { color: theme.colors.text }]}>{t('common.cancel')}</Text>
                </Pressable>
            )}
            {props.canRetry && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.retry')}
                    onPress={props.onRetry}
                    style={({ pressed }) => [
                        styles.action,
                        { borderColor: theme.colors.divider, opacity: pressed ? 0.65 : 1 },
                    ]}
                >
                    <Text style={[styles.actionText, { color: theme.colors.text }]}>{t('common.retry')}</Text>
                </Pressable>
            )}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 28,
    },
    status: {
        fontSize: 12,
        ...Typography.default(),
    },
    statusColumn: { flex: 1, minWidth: 0, gap: 2 },
    target: { fontSize: 10, ...Typography.mono() },
    action: {
        minHeight: 28,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionText: {
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
}));
