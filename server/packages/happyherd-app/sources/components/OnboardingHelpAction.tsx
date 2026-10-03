import * as React from 'react';
import { Pressable, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { PRODUCT } from '@/constants/product';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useHappyHerdAction } from '@/hooks/useHappyHerdAction';
import { openExternalUrl } from '@/utils/openExternalUrl';

/** Secondary action for the existing first-run and account restoration screens. */
export function OnboardingHelpAction({ context }: { context: 'link' | 'restore' }) {
    const [, reportIssue] = useHappyHerdAction(async () => {
        await openExternalUrl(PRODUCT.issueUrl);
    });
    const openHelp = React.useCallback(() => {
        Modal.alert(
            t('components.onboardingHelp.action'),
            context === 'link' ? t('components.onboardingHelp.linkMessage') : t('components.onboardingHelp.restoreMessage'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('settings.reportIssue'), onPress: reportIssue },
            ],
        );
    }, [context, reportIssue]);
    return (
        <Pressable
            accessibilityRole="button"
            onPress={openHelp}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
            <Text style={styles.label}>{t('components.onboardingHelp.action')}</Text>
        </Pressable>
    );
}
// Retain the existing EmptyMainScreen secondary-action geometry and theme tokens.
const styles = StyleSheet.create(theme => ({
    action: {
        minHeight: 40, marginTop: 4, paddingHorizontal: 14,
        alignItems: 'center', justifyContent: 'center', borderRadius: 4,
    },
    pressed: { backgroundColor: theme.colors.surfacePressedOverlay },
    label: { fontSize: 15, color: theme.colors.textSecondary, ...Typography.default('semiBold') },
}));
