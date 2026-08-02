import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canConfirmAccountKeyBackup } from '@/auth/accountKeyLifecycle';
import { useAuth } from '@/auth/AuthContext';
import { AccountKeyPanel } from '@/components/AccountKeyPanel';
import { RoundButton } from '@/components/RoundButton';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { t } from '@/text';

export const AccountKeyBackupGate = React.memo(() => {
    const auth = useAuth();
    const insets = useSafeAreaInsets();
    const [hasCopiedAccountKey, setHasCopiedAccountKey] = React.useState(false);
    const secret = auth.credentials?.secret;
    const canContinue = canConfirmAccountKeyBackup(hasCopiedAccountKey);

    if (!secret) {
        return null;
    }

    return (
        <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[
                styles.contentContainer,
                {
                    paddingTop: insets.top + 32,
                    paddingBottom: insets.bottom + 32,
                },
            ]}
        >
            <View style={styles.content}>
                <Text style={styles.title}>{t('settingsAccount.backup')}</Text>
                <Text style={styles.description}>{t('settingsAccount.backupDescription')}</Text>
                <AccountKeyPanel
                    secret={secret}
                    onCopied={() => setHasCopiedAccountKey(true)}
                />
                <RoundButton
                    title={t('common.continue')}
                    disabled={!canContinue}
                    action={auth.confirmAccountKeyBackup}
                    style={styles.continueButton}
                />
            </View>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    scrollView: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    content: {
        width: '100%',
        maxWidth: layout.maxWidth,
    },
    title: {
        color: theme.colors.text,
        fontSize: 28,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    description: {
        color: theme.colors.textSecondary,
        fontSize: 16,
        lineHeight: 24,
        marginTop: 12,
        marginBottom: 24,
        textAlign: 'center',
        ...Typography.default(),
    },
    continueButton: {
        marginTop: 24,
    },
}));
