import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { CommanderSessionAvatar } from '@/components/CommanderSessionAvatar';
import { Typography } from '@/constants/Typography';
import { useGithubRepository, type GithubRepositoryStatus } from '@/sync/githubRepository';
import { t } from '@/text';
import { herdStaggerClass, herdWebClasses } from '../motion';

export type StreamlineCommanderOption = { id: string; name: string; role?: string | null };
export type StreamlineFolderOption = { machineId: string; path: string; name: string; machineName: string; online: boolean };
export type StreamlineProjectOption = { id: string; name: string };

const FOLDER_CARD_WIDTH = 246;
const COMMANDER_CARD_WIDTH = 208;

/** Mono amber section label used across the Streamline form. */
export function StreamlineLabel({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
    return (
        <View style={styles.labelRow}>
            <Text accessibilityRole="header" style={styles.label}>{children}</Text>
            {trailing}
        </View>
    );
}

/**
 * The three Streamline choices: Commander, working folder and project. Wide
 * layouts wrap the cards; phones scroll each choice as a horizontal row.
 */
export function StreamlineSections(props: {
    compact: boolean;
    commanders: readonly StreamlineCommanderOption[];
    commanderMachineId: string | null;
    commanderId: string | null;
    commanderNote?: string | null;
    onSelectCommander: (id: string | null) => void;
    onCreateCommander: () => void;
    folders: readonly StreamlineFolderOption[];
    selectedFolder: { machineId: string | null; path: string | null; name: string; machineName: string | null } | null;
    onSelectFolder: (folder: StreamlineFolderOption) => void;
    onChooseFolder: () => void;
    chooseFolderOpen: boolean;
    chooseFolderPopover?: React.ReactNode;
    projects: readonly StreamlineProjectOption[];
    projectId: string | null;
    focusProjectId?: string | null;
    onSelectProject: (id: string | null) => void;
}) {
    const { theme } = useUnistyles();
    const selectedKnown = !!props.selectedFolder && props.folders.some((folder) => (
        folder.machineId === props.selectedFolder!.machineId && folder.path === props.selectedFolder!.path
    ));

    let index = 0;
    const commanderCards = [
        <ChoiceCard
            key="none"
            index={index++}
            width={COMMANDER_CARD_WIDTH}
            selected={!props.commanderId}
            onPress={() => props.onSelectCommander(null)}
            testID="streamline-commander-none"
            leading={<View style={styles.glyph}><Ionicons name="document-text-outline" size={16} color={theme.colors.textSecondary} /></View>}
            title={t('uiCopy.noCommander')}
            subtitle={t('uiCopy.useGlobalAgentsMdOnly')}
        />,
        ...props.commanders.map((commander) => (
            <ChoiceCard
                key={commander.id}
                index={index++}
                width={COMMANDER_CARD_WIDTH}
                selected={props.commanderId === commander.id}
                onPress={() => props.onSelectCommander(commander.id)}
                testID={`streamline-commander-${commander.id}`}
                leading={(
                    <CommanderSessionAvatar
                        accessible={false}
                        machineId={props.commanderMachineId}
                        commanderId={commander.id}
                        commanderName={commander.name}
                        size={34}
                    />
                )}
                title={commander.name}
                subtitle={commander.role ?? undefined}
            />
        )),
        <ChoiceCard
            key="create"
            index={index++}
            width={COMMANDER_CARD_WIDTH}
            dashed
            onPress={props.onCreateCommander}
            testID="streamline-commander-create"
            leading={<View style={[styles.glyph, styles.glyphDashed]}><Ionicons name="add" size={16} color={theme.colors.textLink} /></View>}
            title={t('happyHerd.commander.createTitle')}
            subtitle={t('happyHerd.commander.createSubtitle')}
            accent
        />,
    ];

    const folderCards = [
        ...props.folders.map((folder) => (
            <StreamlineFolderCard
                key={`${folder.machineId}:${folder.path}`}
                index={index++}
                folder={folder}
                selected={props.selectedFolder?.machineId === folder.machineId && props.selectedFolder?.path === folder.path}
                onPress={() => props.onSelectFolder(folder)}
            />
        )),
        ...(props.selectedFolder && !selectedKnown && props.selectedFolder.machineId && props.selectedFolder.path ? [
            <StreamlineFolderCard
                key="selected"
                index={index++}
                folder={{
                    machineId: props.selectedFolder.machineId,
                    path: props.selectedFolder.path,
                    name: props.selectedFolder.name,
                    machineName: props.selectedFolder.machineName ?? props.selectedFolder.machineId,
                    online: true,
                }}
                selected
                onPress={props.onChooseFolder}
            />,
        ] : []),
        <ChoiceCard
            key="browse"
            index={index++}
            width={FOLDER_CARD_WIDTH}
            dashed
            accent
            selected={props.chooseFolderOpen}
            onPress={props.onChooseFolder}
            testID="streamline-choose-folder"
            leading={<View style={styles.folderGlyph}><Ionicons name="add" size={17} color={theme.colors.textLink} /></View>}
            title={t('newSession.streamline.browseFolder')}
            subtitle={t('workspace.browseMachine')}
        />,
    ];

    const projectChips = [
        <ProjectChip key="none" label={t('projects.noProject')} selected={!props.projectId} onPress={() => props.onSelectProject(null)} />,
        ...props.projects.map((project) => (
            <ProjectChip
                key={project.id}
                label={project.name}
                selected={props.projectId === project.id}
                focus={props.focusProjectId === project.id}
                onPress={() => props.onSelectProject(project.id)}
            />
        )),
    ];

    return (
        <View style={styles.root} testID="streamline-sections">
            <StreamlineLabel>{t('happyHerd.commander.category')}</StreamlineLabel>
            <ChoiceRow compact={props.compact}>{commanderCards}</ChoiceRow>
            {props.commanderNote ? <Text style={styles.note}>{props.commanderNote}</Text> : null}

            <StreamlineLabel>{t('newSession.streamline.whereLabel')}</StreamlineLabel>
            <ChoiceRow compact={props.compact}>{folderCards}</ChoiceRow>
            {props.chooseFolderPopover}

            <StreamlineLabel>{t('projects.project')}</StreamlineLabel>
            <ChoiceRow compact={props.compact} chips>{projectChips}</ChoiceRow>
        </View>
    );
}

function ChoiceRow({ compact, chips, children }: { compact: boolean; chips?: boolean; children: React.ReactNode }) {
    if (compact) {
        return (
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.row, styles.swipeContent, chips && styles.chipRow]}
                style={styles.swipeRow}
            >
                {children}
            </ScrollView>
        );
    }
    return <View style={[styles.row, styles.wrapRow, chips && styles.chipRow]}>{children}</View>;
}

function ChoiceCard(props: {
    index: number;
    width: number;
    title: string;
    subtitle?: string;
    leading: React.ReactNode;
    badge?: React.ReactNode;
    detail?: React.ReactNode;
    selected?: boolean;
    disabled?: boolean;
    dashed?: boolean;
    accent?: boolean;
    onPress: () => void;
    testID?: string;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={props.subtitle ? `${props.title}, ${props.subtitle}` : props.title}
            aria-checked={!!props.selected}
            disabled={props.disabled}
            onPress={props.onPress}
            testID={props.testID}
            style={({ hovered, pressed }: any) => [
                styles.card(props.index),
                { width: props.width },
                props.dashed && styles.cardDashed,
                (hovered || pressed) && !props.selected && styles.cardHovered,
                props.selected && styles.cardSelected,
                props.disabled && styles.cardDisabled,
            ]}
        >
            {props.leading}
            <View style={styles.cardText}>
                <View style={styles.cardTitleRow}>
                    <Text numberOfLines={1} style={[styles.cardTitle, props.badge ? styles.cardTitleWithBadge : null, props.accent && styles.cardTitleAccent]}>{props.title}</Text>
                    {props.badge}
                </View>
                {props.subtitle ? <Text numberOfLines={1} style={styles.cardSubtitle}>{props.subtitle}</Text> : null}
                {props.detail}
            </View>
        </Pressable>
    );
}

function repositoryBadge(status: GithubRepositoryStatus): 'github' | 'none' | null {
    return status === 'github' ? 'github' : status === 'none' ? 'none' : null;
}

/** Folder + machine card; asks the machine whether the folder is a GitHub repository. */
function StreamlineFolderCard({ folder, selected, index, onPress }: {
    folder: StreamlineFolderOption;
    selected: boolean;
    index: number;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    const repository = useGithubRepository(folder.online ? folder.machineId : null, folder.path);
    const badge = repositoryBadge(repository.status);
    return (
        <ChoiceCard
            index={index}
            width={FOLDER_CARD_WIDTH}
            selected={selected}
            disabled={!folder.online}
            onPress={onPress}
            testID={`streamline-folder-${folder.machineId}-${folder.name}`}
            leading={(
                <View style={styles.folderGlyph}>
                    <Ionicons name={selected ? 'folder-open' : 'folder-outline'} size={17} color={selected ? theme.colors.textLink : theme.colors.kilv.moltenDeep} />
                </View>
            )}
            title={folder.name}
            badge={badge ? (
                <View style={[styles.tag, badge === 'github' && styles.tagAccent]} testID={badge === 'github' ? 'streamline-github-badge' : 'streamline-not-git-badge'}>
                    <Text numberOfLines={1} style={[styles.tagText, badge === 'github' && styles.tagTextAccent]}>
                        {badge === 'github' ? t('newSession.streamline.githubBadge') : t('newSession.streamline.notGithub')}
                    </Text>
                </View>
            ) : null}
            subtitle={folder.path}
            detail={(
                <View style={styles.machineLine}>
                    <View style={[styles.dot, folder.online ? styles.dotOnline : styles.dotOffline]} />
                    <Text numberOfLines={1} style={styles.machineText}>
                        {folder.online ? folder.machineName : `${folder.machineName} · ${t('status.offline')}`}
                    </Text>
                </View>
            )}
        />
    );
}

function ProjectChip({ label, selected, focus, onPress }: { label: string; selected: boolean; focus?: boolean; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            aria-checked={selected}
            onPress={onPress}
            style={({ hovered, pressed }: any) => [
                styles.chip,
                (hovered || pressed) && !selected && styles.cardHovered,
                selected && styles.cardSelected,
            ]}
        >
            {focus ? <Ionicons name="locate-outline" size={14} color={theme.colors.textLink} /> : null}
            <Text numberOfLines={1} style={styles.chipText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    root: {
        gap: 0,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 22,
        marginBottom: 10,
    },
    label: {
        fontSize: 11,
        letterSpacing: 2.2,
        textTransform: 'uppercase',
        color: theme.colors.textLink,
        ...Typography.mono('semiBold'),
    },
    note: {
        marginTop: 8,
        fontSize: 13,
        color: theme.colors.status.disconnected,
        ...Typography.default(),
    },
    // Phones: each choice scrolls edge to edge as a swipe row.
    swipeRow: {
        marginHorizontal: -16,
        flexGrow: 0,
    },
    swipeContent: {
        paddingHorizontal: 16,
    },
    row: {
        flexDirection: 'row',
        gap: 10,
    },
    wrapRow: {
        flexWrap: 'wrap',
    },
    chipRow: {
        gap: 8,
    },
    card: (index: number) => ({
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-transition', 'herd-press', 'herd-rise-sm', herdStaggerClass(index)) },
    }),
    cardDashed: {
        borderStyle: 'dashed',
        backgroundColor: 'transparent',
    },
    cardHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    cardSelected: {
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
        _web: { boxShadow: theme.colors.selection.ring },
    },
    cardDisabled: {
        opacity: theme.kilv.disabledOpacity,
    },
    cardText: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    cardTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
    },
    cardTitle: {
        flexShrink: 1,
        fontSize: 14.5,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    // Beside a badge the name keeps priority, and the badge truncates instead.
    cardTitleWithBadge: {
        flexShrink: 0,
        maxWidth: '70%',
    },
    cardTitleAccent: {
        color: theme.colors.textLink,
    },
    cardSubtitle: {
        fontSize: 12,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    glyph: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    glyphDashed: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.selection.border,
    },
    folderGlyph: {
        width: 34,
        height: 34,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    tag: {
        flexShrink: 1,
        minWidth: 0,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    tagAccent: {
        borderColor: theme.colors.selection.border,
    },
    tagText: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    tagTextAccent: {
        color: theme.colors.textLink,
    },
    machineLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minWidth: 0,
    },
    machineText: {
        flexShrink: 1,
        fontSize: 11.5,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    dotOnline: {
        backgroundColor: theme.colors.status.connected,
    },
    dotOffline: {
        backgroundColor: theme.colors.status.disconnected,
    },
    chip: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-transition', 'herd-press') },
    },
    chipText: {
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default(),
    },
}));
