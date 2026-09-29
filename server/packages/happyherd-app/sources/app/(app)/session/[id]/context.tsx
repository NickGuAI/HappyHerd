import * as React from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { HerdButton, HerdPageHeader } from '@/components/herd/pages/HerdPage';
import { Typography } from '@/constants/Typography';
import { useMachine, useSession, useSetting } from '@/sync/storage';
import { readSessionContextWindow, type ContextWindowResult } from '@/sync/contextWindow';
import { t } from '@/text';

export default function SessionContextWindowScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const enabled = useSetting('expContextWindow');
    const session = useSession(id);
    const machine = useMachine(session?.metadata?.machineId ?? '');
    const [result, setResult] = React.useState<ContextWindowResult | null>(null);
    const [loading, setLoading] = React.useState(false);
    const generation = React.useRef(0);
    const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);

    React.useEffect(() => {
        const current = ++generation.current;
        setResult(null);
        setLoading(false);
        if (!enabled) return;
        if (!session) {
            setResult({ type: 'error', reason: 'missing' });
            return;
        }
        setLoading(true);
        void readSessionContextWindow(session, machine).then((response) => {
            if (generation.current !== current) return;
            setResult(response);
            setLoading(false);
        });
        return () => { generation.current++; };
        // A snapshot refreshes explicitly, or when its source/reachability changes.
    }, [enabled, id, session?.metadata?.machineId, session?.metadata?.path,
        session?.metadata?.flavor, session?.metadata?.claudeSessionId,
        session?.metadata?.codexThreadId, session?.metadata?.codexHome, session?.metadata?.homeDir, machine?.active, attempt]);

    const header = (
        <View style={styles.header}>
            <HerdPageHeader title={t('contextWindow.title')} subtitle={t('contextWindow.description')} />
            {!enabled ? <Text style={styles.notice}>{t('contextWindow.disabled')}</Text> : <>
                <HerdButton label={result?.type === 'success' ? t('contextWindow.refresh') : t('common.retry')} onPress={retry} disabled={loading} />
                {loading ? <ActivityIndicator accessibilityLabel={t('common.loading')} /> : null}
                {result?.type === 'error' ? <Text accessibilityRole="alert" style={styles.notice}>{t(`contextWindow.errors.${result.reason}`)}</Text> : null}
                {result?.type === 'success' ? <>
                    {result.limitations.map((limitation) => <Text key={limitation} style={styles.notice}>{t(`contextWindow.limitations.${limitation}`)}</Text>)}
                    <Text style={styles.notice}>{t('contextWindow.entryCount', { count: result.entries.length })}</Text>
                    {result.entries.length === 0 ? <Text style={styles.notice}>{t('contextWindow.empty')}</Text> : null}
                </> : null}
            </>}
        </View>
    );

    return <View style={styles.container}>
        <Stack.Screen options={{ title: t('contextWindow.title') }} />
        <FlatList
            data={enabled && result?.type === 'success' ? result.entries : []}
            ListHeaderComponent={header}
            keyExtractor={(_, index) => String(index)}
            initialNumToRender={10}
            renderItem={({ item, index }) => <View style={styles.entry}>
                <Text accessibilityRole="header" selectable style={styles.kind}>{index + 1}. {item.kind}</Text>
                <Text selectable style={styles.content}>{item.content}</Text>
            </View>}
        />
    </View>;
}

const styles = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.groupped.background },
    header: { padding: 16, gap: 12 },
    notice: { color: theme.colors.textSecondary, fontSize: 16, lineHeight: 24, ...Typography.default() },
    entry: { marginHorizontal: 16, marginBottom: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 12, backgroundColor: theme.colors.surface },
    kind: { color: theme.colors.text, fontSize: 16, ...Typography.mono('semiBold') },
    content: { color: theme.colors.text, fontSize: 16, lineHeight: 24, ...Typography.mono() },
}));
