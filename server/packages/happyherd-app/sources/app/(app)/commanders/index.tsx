import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { HappyHerdCommanderSummary } from '@happyherd/wire';

import { CommanderSessionAvatar } from '@/components/CommanderSessionAvatar';
import { Text } from '@/components/StyledText';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { requestHomeDockFocus } from '@/components/homeDockFocus';
import {
    HerdButton,
    HerdEmptyState,
    HerdNotice,
    HerdPageHeader,
    useHerdWideLayout,
} from '@/components/herd/pages/HerdPage';
import { HerdSheet } from '@/components/herd/pages/HerdSheet';
import {
    COMMANDER_MEMORY_FILES,
    commanderMemoryLine,
    commanderMemoryPath,
    readCommanderMemory,
    type CommanderMemoryFile,
} from '@/components/herd/pages/commanderMemory';
import { herdStaggerClass, herdWebClasses } from '@/components/herd/motion';
import { Typography } from '@/constants/Typography';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { machineListCommanders, machineReadFileWithinRoot } from '@/sync/ops';
import { useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { t } from '@/text';
import { isMachineOnline } from '@/utils/machineUtils';

type CommanderEntry = {
    machine: Machine;
    commander: HappyHerdCommanderSummary;
};

type MachineFailure = {
    machine: Machine;
    message: string;
};

type MemoryState = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; message: string };

const CARD_MIN_WIDTH = 280;
const CARD_GAP = 18;

function machineName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id;
}

function entryKey(entry: CommanderEntry): string {
    return `${entry.machine.id}\u0000${entry.commander.id}`;
}

/** Point the New Session draft at this Commander, its folder and machine, then open it. */
function startSessionWith(entry: CommanderEntry, navigate: () => void) {
    const draft = useNewSessionDraft.getState();
    if (draft.selectedMachineId !== entry.machine.id) draft.setMachineId(entry.machine.id);
    draft.setCommanderId(entry.commander.id);
    draft.setPath(entry.commander.workspace);
    draft.setSessionType('simple');
    draft.setWorktreeKey(null);
    if (!requestHomeDockFocus()) navigate();
}

function useCommanderEntries() {
    const machines = useAllMachines({ includeOffline: true });
    const onlineMachines = React.useMemo(() => machines.filter(isMachineOnline), [machines]);
    const onlineRef = React.useRef(onlineMachines);
    onlineRef.current = onlineMachines;
    // Presence heartbeats change machine objects constantly; reload only when
    // the set of reachable machines changes.
    const reloadKey = onlineMachines.map((machine) => machine.id).sort().join('|');
    const [entries, setEntries] = React.useState<CommanderEntry[]>([]);
    const [failures, setFailures] = React.useState<MachineFailure[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let active = true;
        const targets = onlineRef.current;
        setLoading(true);
        void Promise.allSettled(targets.map((machine) => machineListCommanders(machine.id))).then((results) => {
            if (!active) return;
            const nextEntries: CommanderEntry[] = [];
            const nextFailures: MachineFailure[] = [];
            results.forEach((result, index) => {
                const machine = targets[index];
                if (result.status === 'fulfilled') {
                    for (const commander of result.value.commanders) nextEntries.push({ machine, commander });
                } else {
                    nextFailures.push({
                        machine,
                        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
                    });
                }
            });
            nextEntries.sort((left, right) => (
                left.commander.name.localeCompare(right.commander.name)
                || machineName(left.machine).localeCompare(machineName(right.machine))
            ));
            setEntries(nextEntries);
            setFailures(nextFailures);
            setLoading(false);
        });
        return () => {
            active = false;
        };
    }, [reloadKey]);

    return { entries, failures, loading, machineCount: machines.length, onlineCount: onlineMachines.length };
}

function CommanderCard({
    entry,
    index,
    width,
    memoryLine,
    onOpenMemory,
    onNewSession,
}: {
    entry: CommanderEntry;
    index: number;
    width: number | undefined;
    memoryLine: string | null | undefined;
    onOpenMemory: (file: CommanderMemoryFile) => void;
    onNewSession: () => void;
}) {
    const { theme } = useUnistyles();
    const { commander, machine } = entry;
    return (
        <View
            testID={`commander-card-${commander.id}`}
            style={[styles.card(index), width ? { width } : styles.cardFull]}
        >
            <CommanderSessionAvatar
                machineId={machine.id}
                commanderId={commander.id}
                commanderName={commander.name}
                size={64}
            />
            <Text style={styles.name} numberOfLines={2}>{commander.name}</Text>
            {commander.role ? <Text style={styles.role} numberOfLines={3}>{commander.role}</Text> : null}
            <View style={styles.folder}>
                <Ionicons name="folder-outline" size={13} color={theme.colors.textSecondary} />
                <Text selectable style={styles.folderText} numberOfLines={1}>{commander.workspace}</Text>
            </View>
            <View style={styles.folder}>
                <Ionicons name="desktop-outline" size={13} color={theme.colors.textSecondary} />
                <Text style={styles.folderText} numberOfLines={1}>{machineName(machine)}</Text>
            </View>
            <View style={styles.memory}>
                {COMMANDER_MEMORY_FILES.map((file) => (
                    <Pressable
                        key={file}
                        accessibilityRole="button"
                        accessibilityLabel={`${commander.name} · ${file}`}
                        onPress={() => onOpenMemory(file)}
                        style={({ pressed }) => [styles.memoryFile, pressed && styles.pressed]}
                    >
                        <Ionicons name="document-text-outline" size={13} color={theme.colors.textSecondary} />
                        <Text style={styles.memoryFileText} numberOfLines={1}>{file}</Text>
                    </Pressable>
                ))}
                {memoryLine ? (
                    <Text testID={`commander-memory-line-${commander.id}`} style={styles.memoryLine} numberOfLines={4}>
                        {`“${memoryLine}”`}
                    </Text>
                ) : null}
            </View>
            <View style={styles.cardFooter}>
                <HerdButton
                    size="sm"
                    icon="create-outline"
                    label={t('sidebar.newSession')}
                    accessibilityLabel={t('happyHerd.commander.newSessionWith', { name: commander.name })}
                    onPress={onNewSession}
                />
            </View>
        </View>
    );
}

function CreateCommanderCard({ index, width, onPress }: { index: number; width: number | undefined; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            testID="commander-create-card"
            accessibilityRole="button"
            accessibilityLabel={t('happyHerd.commander.createTitle')}
            onPress={onPress}
            style={({ pressed }) => [
                styles.card(index),
                styles.createCard,
                width ? { width } : styles.cardFull,
                pressed && styles.pressed,
            ]}
        >
            <View style={styles.createIcon}>
                <Ionicons name="add" size={28} color={theme.colors.textLink} />
            </View>
            <Text style={styles.createTitle}>{t('happyHerd.commander.createTitle')}</Text>
            <Text style={styles.createSubtitle}>{t('happyHerd.commander.createSubtitle')}</Text>
        </Pressable>
    );
}

export default function CommandersScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const wide = useHerdWideLayout();
    const { entries, failures, loading, machineCount, onlineCount } = useCommanderEntries();
    const [gridWidth, setGridWidth] = React.useState(0);
    const [memoryLines, setMemoryLines] = React.useState<Record<string, string | null>>({});
    const [reader, setReader] = React.useState<{ entry: CommanderEntry; file: CommanderMemoryFile } | null>(null);
    const [readerState, setReaderState] = React.useState<MemoryState>({ status: 'loading' });
    const [readerAttempt, setReaderAttempt] = React.useState(0);

    const columns = Math.max(1, Math.floor((gridWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
    const cardWidth = gridWidth > 0 && columns > 1
        ? Math.floor((gridWidth - CARD_GAP * (columns - 1)) / columns)
        : undefined;
    const onGridLayout = React.useCallback((event: LayoutChangeEvent) => {
        setGridWidth(event.nativeEvent.layout.width);
    }, []);

    // Each card quotes its working memory once per load.
    React.useEffect(() => {
        let active = true;
        for (const entry of entries) {
            const key = entryKey(entry);
            void readCommanderMemory(machineReadFileWithinRoot, entry.machine.id, entry.commander, COMMANDER_MEMORY_FILES[0])
                .then((text) => commanderMemoryLine(text), () => null)
                .then((line) => {
                    if (active) setMemoryLines((current) => ({ ...current, [key]: line }));
                });
        }
        return () => {
            active = false;
        };
    }, [entries]);

    React.useEffect(() => {
        if (!reader) return;
        let active = true;
        setReaderState({ status: 'loading' });
        readCommanderMemory(machineReadFileWithinRoot, reader.entry.machine.id, reader.entry.commander, reader.file).then(
            (text) => {
                if (active) setReaderState({ status: 'ready', text });
            },
            (error) => {
                if (active) {
                    setReaderState({
                        status: 'error',
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            },
        );
        return () => {
            active = false;
        };
    }, [reader, readerAttempt]);

    const createCommander = React.useCallback(() => {
        router.navigate({ pathname: '/new', params: { intent: 'create-commander' } });
    }, [router]);

    return (
        <View style={styles.page}>
            <Stack.Screen options={{ headerTitle: t('happyHerd.commander.category') }} />
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.content, !wide && styles.contentCompact]}
            >
                <HerdPageHeader
                    compact={!wide}
                    subtitle={t('happyHerd.commander.pageSubtitle')}
                    actions={(
                        <HerdButton
                            variant="primary"
                            icon="add"
                            label={t('happyHerd.commander.createTitle')}
                            onPress={createCommander}
                        />
                    )}
                />
                <View style={styles.notices}>
                    {failures.map((failure) => (
                        <HerdNotice
                            key={failure.machine.id}
                            tone="error"
                            message={t('happyHerd.commander.machineLoadFailed', {
                                name: machineName(failure.machine),
                                message: failure.message,
                            })}
                        />
                    ))}
                </View>
                {loading ? (
                    <View key="loading" style={styles.loading}>
                        <ActivityIndicator color={theme.colors.textSecondary} />
                        <Text style={styles.loadingText}>{t('happyHerd.commanderAvatars.loading')}</Text>
                    </View>
                ) : onlineCount === 0 ? (
                    <HerdEmptyState
                        testID="commanders-offline"
                        icon="cloud-offline-outline"
                        title={machineCount === 0
                            ? t('happyHerd.commanderAvatars.noMachines')
                            : t('happyHerd.commanderAvatars.machineOffline')}
                        description={t('happyHerd.commander.noOnlineMachine')}
                    />
                ) : entries.length === 0 && failures.length === 0 ? (
                    <HerdEmptyState
                        testID="commanders-empty"
                        icon="people-outline"
                        title={t('happyHerd.commander.emptyTitle')}
                        description={t('happyHerd.commander.createSubtitle')}
                        action={(
                            <HerdButton
                                variant="primary"
                                icon="add"
                                label={t('happyHerd.commander.createTitle')}
                                onPress={createCommander}
                            />
                        )}
                    />
                ) : (
                    // Keyed so the grid mounts fresh after loading: web onLayout starts observing on mount.
                    <View key="grid" testID="commanders-grid" onLayout={onGridLayout} style={styles.grid}>
                        {entries.map((entry, index) => (
                            <CommanderCard
                                key={entryKey(entry)}
                                entry={entry}
                                index={index}
                                width={cardWidth}
                                memoryLine={memoryLines[entryKey(entry)]}
                                onOpenMemory={(file) => setReader({ entry, file })}
                                onNewSession={() => startSessionWith(entry, () => router.navigate('/new'))}
                            />
                        ))}
                        <CreateCommanderCard index={entries.length} width={cardWidth} onPress={createCommander} />
                    </View>
                )}
            </ScrollView>

            <HerdSheet
                visible={reader !== null}
                wide
                testID="commander-memory-sheet"
                title={reader?.entry.commander.name ?? ''}
                subtitle={reader ? commanderMemoryPath(reader.entry.commander, reader.file) : undefined}
                leading={reader ? (
                    <CommanderSessionAvatar
                        machineId={reader.entry.machine.id}
                        commanderId={reader.entry.commander.id}
                        commanderName={reader.entry.commander.name}
                        size={34}
                    />
                ) : null}
                closeLabel={t('common.cancel')}
                onClose={() => setReader(null)}
            >
                {readerState.status === 'loading' ? (
                    <View style={styles.loading}>
                        <ActivityIndicator color={theme.colors.textSecondary} />
                    </View>
                ) : readerState.status === 'error' ? (
                    <View style={styles.readerError}>
                        <HerdNotice tone="error" message={`${t('happyHerd.commander.memoryReadFailed')} ${readerState.message}`} />
                        <HerdButton size="sm" label={t('common.retry')} onPress={() => setReaderAttempt((value) => value + 1)} />
                    </View>
                ) : readerState.text.trim().length === 0 ? (
                    <Text style={styles.loadingText}>{t('happyHerd.commander.memoryEmpty')}</Text>
                ) : (
                    <View testID="commander-memory-content" style={styles.reader}>
                        <MarkdownView markdown={readerState.text} />
                    </View>
                )}
            </HerdSheet>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: { flex: 1, width: '100%' },
    scroll: { flex: 1 },
    content: { width: '100%', maxWidth: 1120, alignSelf: 'center', paddingHorizontal: 34, paddingTop: 28, paddingBottom: 80 },
    // Phones (UI overhaul): the page content sits on the 16 px gutter.
    contentCompact: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 48 },
    notices: { gap: 10, marginBottom: 12 },
    loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 32 },
    loadingText: { ...Typography.default(), fontSize: 14, color: theme.colors.textSecondary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP },
    // The only style in a card's list that sets web classes (see Unistyles `_web` merging).
    card: (index: number) => ({
        paddingHorizontal: 22,
        paddingTop: 24,
        paddingBottom: 20,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        borderRadius: theme.kilv.radiusSheet,
        backgroundColor: theme.colors.surface,
        _web: {
            _classNames: herdWebClasses('herd-transition', 'herd-rise', herdStaggerClass(index)),
            boxShadow: theme.kilv.shadow,
            _hover: { borderColor: theme.colors.selection.border, transform: 'translateY(-3px)' },
        },
    }),
    cardFull: { width: '100%' },
    name: {
        ...Typography.default('semiBold'),
        marginTop: 16,
        fontSize: 26,
        lineHeight: 32,
        letterSpacing: -0.3,
        color: theme.colors.text,
    },
    role: {
        ...Typography.default(),
        marginTop: 4,
        fontSize: 15,
        lineHeight: 21,
        color: theme.colors.textSecondary,
    },
    folder: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
    folderText: { ...Typography.mono(), flex: 1, minWidth: 0, fontSize: 12.5, color: theme.colors.textSecondary },
    memory: {
        marginTop: 18,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
        gap: 8,
    },
    memoryFile: {
        minHeight: 34,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.input.background,
        _web: {
            _classNames: herdWebClasses('herd-transition'),
            cursor: 'pointer',
            _hover: { borderColor: theme.colors.selection.border },
        },
    },
    memoryFileText: { ...Typography.mono(), flex: 1, minWidth: 0, fontSize: 12.5, color: theme.colors.textSecondary },
    memoryLine: {
        ...Typography.default(),
        marginTop: 4,
        fontSize: 15,
        lineHeight: 23,
        color: theme.colors.text,
    },
    cardFooter: { marginTop: 16, flexDirection: 'row', justifyContent: 'flex-end' },
    createCard: {
        minHeight: 300,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        borderStyle: 'dashed',
        backgroundColor: 'transparent',
        _web: { boxShadow: 'none', cursor: 'pointer' },
    },
    createIcon: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.selection.border,
    },
    createTitle: { ...Typography.default('semiBold'), fontSize: 18, color: theme.colors.textLink },
    createSubtitle: { ...Typography.default(), fontSize: 13.5, color: theme.colors.textSecondary, textAlign: 'center' },
    readerError: { gap: 12, alignItems: 'flex-start' },
    reader: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.input.background,
    },
    pressed: { opacity: 0.82 },
}));
