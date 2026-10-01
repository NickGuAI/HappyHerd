import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import type { Metadata } from '@/sync/storageTypes';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { Text } from './StyledText';
import { CommanderSessionAvatar } from './CommanderSessionAvatar';
import { layout } from './layout';

/** Only the launch receipt establishes which files were actually included. */
export function CommanderContextRow({ metadata }: { metadata: Metadata | null }) {
    const router = useRouter();
    if (!metadata?.commanderId) return null;
    const name = metadata.commanderName || metadata.commanderId;

    return (
        <View style={styles.container} testID="commander-context-row" accessibilityLabel={t('happyHerd.commander.loadedContext')}>
            <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('happyHerd.commander.openCommanders', { name })}
                onPress={() => router.push('/commanders')}
                style={({ pressed }) => [styles.commander, pressed && styles.pressed]}
            >
                <CommanderSessionAvatar
                    machineId={metadata.machineId ?? null}
                    commanderId={metadata.commanderId}
                    commanderName={name}
                    size={24}
                    accessible={false}
                />
                <Text style={styles.name}>{name}</Text>
            </Pressable>
            {metadata.commanderContextFiles?.map((file) => (
                <View
                    key={`${file.kind}:${file.path}`}
                    accessible
                    accessibilityLabel={t('happyHerd.commander.loadedFile', { path: file.path })}
                    style={styles.file}
                    testID="commander-context-file"
                >
                    <Text style={styles.filename}>{file.path.split(/[\\/]/).pop() || file.path}</Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    commander: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: '100%',
        gap: 6,
    },
    pressed: { opacity: 0.7 },
    name: {
        color: theme.colors.textLink,
        fontSize: 13,
        flexShrink: 1,
        ...Typography.default('semiBold'),
    },
    file: {
        maxWidth: '100%',
        borderRadius: theme.kilv.radiusPill,
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
    },
    filename: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        ...Typography.mono(),
    },
}));
