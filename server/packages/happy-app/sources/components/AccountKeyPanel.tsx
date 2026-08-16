import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { formatSecretKeyForBackup } from '@/auth/secretKeyBackup';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { t } from '@/text';

export const AccountKeyPanel = React.memo(({
    secret,
    onCopied,
}: {
    secret: string;
    onCopied?: () => void;
}) => {
    const { theme } = useUnistyles();
    const [copiedRecently, setCopiedRecently] = React.useState(false);
    const formattedSecret = React.useMemo(
        () => formatSecretKeyForBackup(secret),
        [secret]
    );

    const handleCopy = React.useCallback(async () => {
        try {
            await Clipboard.setStringAsync(formattedSecret);
            setCopiedRecently(true);
            onCopied?.();
            setTimeout(() => setCopiedRecently(false), 2000);
            Modal.alert(t('common.success'), t('settingsAccount.secretKeyCopied'));
        } catch (error) {
            Modal.alert(t('common.error'), t('settingsAccount.secretKeyCopyFailed'));
        }
    }, [formattedSecret, onCopied]);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settingsAccount.secretKeyLabel')}
            onPress={handleCopy}
            style={({ pressed }) => [styles.container, pressed && styles.pressed]}
        >
            <View style={styles.labelRow}>
                <Text style={styles.label}>
                    {t('settingsAccount.secretKeyLabel')}
                </Text>
                <Ionicons
                    name={copiedRecently ? 'checkmark-circle' : 'copy-outline'}
                    size={18}
                    color={copiedRecently ? '#34C759' : theme.colors.textSecondary}
                />
            </View>
            <Text selectable style={styles.key}>
                {formattedSecret}
            </Text>
        </Pressable>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: Platform.select({ web: 16, default: 14 }),
        borderWidth: Platform.select({ web: 0, default: StyleSheet.hairlineWidth }),
        borderColor: theme.colors.divider,
    },
    pressed: {
        opacity: 0.8,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    label: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        ...Typography.default('semiBold'),
    },
    key: {
        fontSize: 13,
        letterSpacing: 0.5,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.mono(),
    },
}));
