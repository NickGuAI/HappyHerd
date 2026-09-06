import * as React from 'react';
import { View, ScrollView, ActivityIndicator, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { FileIcon } from '@/components/FileIcon';
import { DiffChunk } from '@/components/diff/DiffChunk';
import { DiffImageView } from '@/components/diff/DiffImageView';
import { buildGitDiffCommand, buildGitShowBase64Command } from '@/utils/gitDiffCommand';
import { imageDataUri, isImagePath } from '@/utils/imageFiles';
import { countPatchStats } from '@/components/diff/engine/stats';
import { sessionBash, sessionReadFile } from '@/sync/ops';
import { storage, useSettingMutable } from '@/sync/storage';
import { resolveSessionFilePath } from '@/utils/sessionFileLinks';
import { GitFileStatus } from '@/sync/gitStatusFiles';
import { layout } from '@/components/layout';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

interface InlineFileDiffProps {
    sessionId: string;
    fullPath: string;
    /** File status from sidebar — drives which git command we use to build the diff. */
    status: GitFileStatus['status'];
    onClose: () => void;
}

type DiffContent =
    | { kind: 'patch'; patch: string }
    | { kind: 'newFile'; contents: string }
    | { kind: 'image'; before: string | null; after: string | null };

export const InlineFileDiff = React.memo(function InlineFileDiff({ sessionId, fullPath, status, onClose }: InlineFileDiffProps) {
    const { theme } = useUnistyles();
    const state = storage.getState();
    const session = state.sessions[sessionId];
    const platform = session?.metadata?.machineId ? state.machines[session.metadata.machineId]?.metadata?.platform : undefined;
    const sessionPath = session?.metadata?.path ?? null;
    const resolved = resolveSessionFilePath(fullPath, sessionPath);
    const gitDiffPath = resolved?.withinSessionRoot ? resolved.relativePath : null;
    const [diffStyle, setDiffStyle] = useSettingMutable('diffStyle');

    const [content, setContent] = React.useState<DiffContent | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setContent(null);

        (async () => {
            if (!sessionPath || !gitDiffPath) {
                if (!cancelled) {
                    setLoading(false);
                    setError(t('files.failedToRead'));
                }
                return;
            }
            try {
                if (isImagePath(fullPath)) {
                    const [head, working] = await Promise.all([
                        status === 'untracked' || status === 'added' ? Promise.resolve(null) : sessionBash(sessionId, {
                            command: buildGitShowBase64Command(gitDiffPath), cwd: sessionPath, timeout: 8000,
                        }).then((r) => r.success ? r.stdout ?? null : null),
                        status === 'deleted' ? Promise.resolve(null) : sessionReadFile(sessionId, resolved!.absolutePath)
                            .then((r) => r.success ? r.content ?? null : null),
                    ]);
                    if (!cancelled) setContent({ kind: 'image', before: head ? imageDataUri(fullPath, head) : null, after: working ? imageDataUri(fullPath, working) : null });
                    return;
                }
                if (status === 'untracked') {
                    const res = await sessionReadFile(sessionId, resolved!.absolutePath);
                    if (cancelled) return;
                    if (!res.success) {
                        setError(res.error || t('files.failedToRead'));
                        return;
                    }
                    const bytes = Uint8Array.from(atob(res.content ?? ''), (char) => char.charCodeAt(0));
                    setContent({ kind: 'newFile', contents: new TextDecoder().decode(bytes) });
                    return;
                }

                const res = await sessionBash(sessionId, {
                    command: buildGitDiffCommand(gitDiffPath, { platform }),
                    cwd: sessionPath,
                    timeout: 5000,
                });
                if (cancelled) return;
                if (!res.success) {
                    setError(res.error || t('files.failedToRead'));
                    return;
                }
                setContent({ kind: 'patch', patch: res.stdout ?? '' });
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : t('files.failedToRead'));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [sessionId, sessionPath, gitDiffPath, status, fullPath, platform]);

    const fileName = fullPath.split('/').pop() || fullPath;
    const isEmpty =
        content === null ? false :
        content.kind === 'patch' ? content.patch.trim() === '' :
        content.kind === 'image' ? false :
        content.contents === '';

    const stats = React.useMemo(() => {
        if (!content || content.kind === 'image') return null;
        if (content.kind === 'patch') return countPatchStats(content.patch);
        const lineCount = content.contents === '' ? 0 : content.contents.split('\n').length;
        return { additions: lineCount, deletions: 0 };
    }, [content]);

    return (
        <View style={[styles.outer, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
                <DiffPaneHeader
                    fullPath={fullPath}
                    fileName={fileName}
                    stats={stats}
                    diffStyle={diffStyle}
                    onDiffStyleChange={setDiffStyle}
                    onClose={onClose}
                    showToggle={Platform.OS === 'web'}
                />
                {loading ? (
                    <View style={styles.centered}>
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    </View>
                ) : error ? (
                    <View style={styles.centered}>
                        <Text style={{ color: theme.colors.textSecondary, ...Typography.default() }}>{error}</Text>
                    </View>
                ) : !content || isEmpty ? (
                    <View style={styles.centered}>
                        <Text style={{ color: theme.colors.textSecondary, ...Typography.default() }}>{t('files.noChanges')}</Text>
                    </View>
                ) : content.kind === 'image' ? (
                    <DiffImageView before={content.before} after={content.after} />
                ) : (
                    <ScrollView style={{ flex: 1 }}>
                        {/* Split is offered on web only — two columns are
                            unreadable at phone widths. */}
                        <DiffChunk
                            patch={content.kind === 'patch' ? content.patch : undefined}
                            oldText={content.kind === 'newFile' ? '' : undefined}
                            newText={content.kind === 'newFile' ? content.contents : undefined}
                            fileName={fullPath}
                            split={Platform.OS === 'web' && diffStyle === 'split'}
                            collapseAfter={600}
                        />
                    </ScrollView>
                )}
            </View>
        </View>
    );
});

const DiffPaneHeader = React.memo(function DiffPaneHeader({
    fullPath,
    fileName,
    stats,
    diffStyle,
    onDiffStyleChange,
    onClose,
    showToggle,
}: {
    fullPath: string;
    fileName: string;
    stats: { additions: number; deletions: number } | null;
    diffStyle: 'unified' | 'split';
    onDiffStyleChange: (v: 'unified' | 'split') => void;
    onClose: () => void;
    showToggle: boolean;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={[styles.paneHeader, { backgroundColor: theme.colors.surfaceHigh, borderBottomColor: theme.colors.divider }]}>
            <FileIcon fileName={fileName} size={18} />
            <Text
                numberOfLines={1}
                ellipsizeMode="middle"
                style={[styles.headerPath, { color: theme.colors.textSecondary }]}
            >
                {fullPath}
            </Text>
            {stats && (stats.additions > 0 || stats.deletions > 0) ? (
                <View style={styles.stats}>
                    {stats.additions > 0 ? <Text style={styles.added}>+{stats.additions}</Text> : null}
                    {stats.deletions > 0 ? <Text style={styles.removed}>-{stats.deletions}</Text> : null}
                </View>
            ) : null}
            {showToggle ? <DiffStyleToggle value={diffStyle} onChange={onDiffStyleChange} /> : null}
            <Pressable onPress={onClose} hitSlop={15} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
            </Pressable>
        </View>
    );
});

const DiffStyleToggle = React.memo<{ value: 'unified' | 'split'; onChange: (v: 'unified' | 'split') => void }>(({ value, onChange }) => {
    const { theme } = useUnistyles();
    const buttonStyle = (active: boolean) => ({
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: active ? theme.colors.surface : 'transparent',
    });
    const textStyle = (active: boolean) => ({
        fontSize: 12,
        ...Typography.default(active ? 'semiBold' : undefined),
        color: active ? theme.colors.text : theme.colors.textSecondary,
    });
    return (
        <View style={[toggleStyles.container, { backgroundColor: theme.colors.groupped.background, borderColor: theme.colors.divider }]}>
            <Pressable onPress={() => onChange('unified')} style={buttonStyle(value === 'unified')}>
                <Text style={textStyle(value === 'unified')}>{t("settingsAppearance.diffStyleOptions.unified")}</Text>
            </Pressable>
            <Pressable onPress={() => onChange('split')} style={buttonStyle(value === 'split')}>
                <Text style={textStyle(value === 'split')}>{t("settingsAppearance.diffStyleOptions.split")}</Text>
            </Pressable>
        </View>
    );
});

const toggleStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        gap: 2,
        padding: 2,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
    },
});

const styles = StyleSheet.create({
    outer: {
        flex: 1,
        alignItems: 'center',
    },
    container: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
    },
    paneHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
    },
    headerPath: {
        flex: 1,
        fontSize: 13,
        ...Typography.mono(),
    },
    stats: {
        flexDirection: 'row',
        gap: 6,
    },
    added: {
        fontSize: 12,
        color: '#34C759',
        ...Typography.mono(),
    },
    removed: {
        fontSize: 12,
        color: '#FF3B30',
        ...Typography.mono(),
    },
    closeButton: {
        padding: 4,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
});
