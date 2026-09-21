import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { DiffFilesList, type DiffFileItem } from '@/components/diff/DiffFilesList';
import { DiffHeaderRight } from '@/components/diff/DiffHeaderRight';
import { Typography } from '@/constants/Typography';
import { useHappyHerdAgentGitFiles } from '@/hooks/useHappyHerdAgentGitFiles';
import { getHappyHerdAgentGitState, supportsHappyHerdAgentGit, type HappyHerdAgentGitState } from '@/sync/happyherdAgentGit';
import { useSettingMutable } from '@/sync/storage';
import type { Metadata } from '@/sync/storageTypes';
import { FULL_FILE_CONTEXT } from '@/utils/gitDiffCommand';
import { t } from '@/text';

// The phone runs the line diff itself, synchronously in render. The edit
// length bounds Myers' cost deterministically; the timeout is a wall-clock
// backstop for slow devices. Moving the build off the render path is a
// separate follow-up.
const NATIVE_DIFF_BUDGET = { timeoutMs: 200, maxEditLength: 2000 } as const;

type GitLoadState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; git: HappyHerdAgentGitState; revision: number };

export const HappyHerdAgentDiffView = React.memo(function HappyHerdAgentDiffView({
    sessionId, metadata, scrollToFile, onHeaderRightSlotChange,
}: {
    sessionId: string;
    metadata: Metadata;
    scrollToFile?: string | null;
    onHeaderRightSlotChange?: (slot: React.ReactNode) => void;
}) {
    const { theme } = useUnistyles();
    const supported = supportsHappyHerdAgentGit(metadata);
    const [state, setState] = React.useState<GitLoadState>({ status: 'loading' });
    const [refreshIndex, setRefreshIndex] = React.useState(0);
    const revision = React.useRef(0);
    const [diffStyle, setDiffStyle] = useSettingMutable('diffStyle');
    const [ignoreWhitespace, setIgnoreWhitespace] = React.useState(false);
    const refresh = React.useCallback(() => setRefreshIndex((previous) => previous + 1), []);

    // Primitive dependencies keep streaming metadata and header rerenders from
    // re-scanning Git. A focus change or explicit reload starts one fresh read.
    useFocusEffect(React.useCallback(() => {
        if (!supported) return;
        let cancelled = false;
        const requestRevision = ++revision.current;
        setState({ status: 'loading' });
        void getHappyHerdAgentGitState(sessionId).then(
            (git) => {
                if (!cancelled) setState({ status: 'ready', git, revision: requestRevision });
            },
            (error: unknown) => {
                if (!cancelled) setState({
                    status: 'error',
                    message: error instanceof Error ? error.message : t('upstreamSync.loadFailed'),
                });
            },
        );
        return () => { cancelled = true; };
    }, [sessionId, supported, refreshIndex]));

    const fileCount = supported && state.status === 'ready' && state.git.comparison === 'ready'
        ? state.git.changedFiles : null;
    const refreshing = supported && state.status === 'loading';
    React.useEffect(() => {
        if (!onHeaderRightSlotChange) return;
        onHeaderRightSlotChange(
            <DiffHeaderRight
                fileCount={fileCount}
                diffStyle={diffStyle}
                onDiffStyleChange={setDiffStyle}
                ignoreWhitespace={ignoreWhitespace}
                onIgnoreWhitespaceChange={setIgnoreWhitespace}
                onRefresh={refresh}
                refreshing={refreshing}
            />,
        );
        return () => onHeaderRightSlotChange(null);
    }, [fileCount, diffStyle, setDiffStyle, ignoreWhitespace, onHeaderRightSlotChange, refresh, refreshing]);

    let content: React.ReactNode;
    if (!supported) {
        content = <ChangesMessage message={t('upstreamSync.agentUpdate')} />;
    } else if (state.status === 'loading') {
        content = <View style={styles.centered}><ActivityIndicator size="small" color={theme.colors.textSecondary} /></View>;
    } else if (state.status === 'error') {
        content = <ChangesMessage message={state.message} onRetry={refresh} />;
    } else if (state.git.comparison !== 'ready' || !state.git.base) {
        content = <ChangesMessage message={t('upstreamSync.comparisonUnavailable')} onRetry={refresh} />;
    } else {
        content = (
            <HappyHerdAgentDiffFiles
                key={`${sessionId}:${state.revision}`}
                sessionId={sessionId}
                git={state.git}
                base={state.git.base}
                scrollToFile={scrollToFile}
                split={Platform.OS === 'web' && diffStyle === 'split'}
                ignoreWhitespace={ignoreWhitespace}
            />
        );
    }
    return <View style={[styles.outer, { backgroundColor: theme.colors.surface }]}>{content}</View>;
});

function HappyHerdAgentDiffFiles({ sessionId, git, base, scrollToFile, split, ignoreWhitespace }: {
    sessionId: string;
    git: HappyHerdAgentGitState;
    base: string;
    scrollToFile?: string | null;
    split: boolean;
    ignoreWhitespace: boolean;
}) {
    const { theme } = useUnistyles();
    const { results, requestContent } = useHappyHerdAgentGitFiles(sessionId, base, git.files);
    const [expandedContext, setExpandedContext] = React.useState<ReadonlySet<string>>(() => new Set());
    const expandContext = React.useCallback((path: string) => {
        setExpandedContext((previous) => previous.has(path) ? previous : new Set(previous).add(path));
    }, []);
    const items = React.useMemo<DiffFileItem[]>(() => git.files.map((file) => {
        const result = results.get(file.path);
        const content = result?.content;
        return {
            path: file.path,
            kind: file.status === 'added' || file.status === 'untracked' || file.status === 'copied'
                ? 'added' : file.status === 'deleted' ? 'deleted' : file.status === 'renamed' ? 'renamed' : 'modified',
            additions: file.insertions ?? 0,
            deletions: file.deletions ?? 0,
            error: result?.error,
            image: content?.kind === 'image' ? { before: content.before, after: content.after } : undefined,
            message: content?.kind === 'message' ? content.message
                : content?.kind === 'text' && content.oldText === content.newText
                    ? content.newText === '' ? t('files.fileEmpty') : t('upstreamSync.contentsMatch')
                    : undefined,
            source: content?.kind === 'text' ? {
                kind: 'contents',
                path: file.path,
                oldText: content.oldText,
                newText: content.newText,
                diffBudget: NATIVE_DIFF_BUDGET,
                ignoreWhitespace,
                contextLines: expandedContext.has(file.path) ? FULL_FILE_CONTEXT : undefined,
            } : null,
        };
    }), [git.files, results, expandedContext, ignoreWhitespace]);
    const notices = [
        ...(git.filesTruncated ? [t('upstreamSync.truncatedFiles', { shown: String(git.files.length), total: git.changedFiles })] : []),
        ...(!git.countsExact ? [t('upstreamSync.approximateCounts')] : []),
        ...(git.conflicted ? [t('upstreamSync.mergeConflicts')] : []),
    ];
    const clean = git.changedFiles === 0 && git.countsExact && !git.filesTruncated && !git.conflicted;
    return (
        <DiffFilesList
            items={items}
            scrollToPath={scrollToFile}
            split={split}
            defaultCollapsed
            onRequestContent={requestContent}
            onExpandContext={expandContext}
            emptyText={clean ? t('files.noChanges') : t('upstreamSync.noFileDetails')}
            header={notices.length > 0 ? (
                <View style={styles.notices}>
                    {notices.map((notice) => (
                        <Text key={notice} style={{ ...Typography.default(), color: theme.colors.textSecondary }}>{notice}</Text>
                    ))}
                </View>
            ) : undefined}
        />
    );
}

function ChangesMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.centered}>
            <Text style={{ ...Typography.default(), color: theme.colors.textSecondary, textAlign: 'center' }}>{message}</Text>
            {onRetry ? (
                <Pressable onPress={onRetry} style={styles.retry}>
                    <Text style={{ ...Typography.default('semiBold'), color: theme.colors.text }}>{t('common.retry')}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    outer: { flex: 1 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
    notices: { padding: 16, gap: 8 },
    retry: { padding: 12, marginTop: 8 },
});