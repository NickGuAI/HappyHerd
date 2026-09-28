import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { CommanderSessionAvatar } from '@/components/CommanderSessionAvatar';
import { Typography } from '@/constants/Typography';
import { useGithubRepository, type GithubRepositoryStatus } from '@/sync/githubRepository';
import { t } from '@/text';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { herdStaggerClass, herdWebClasses } from '../motion';

export type StreamlineCommanderOption = { id: string; name: string; role?: string | null };
/** `homeDir` lets the folder show home-relative (`~/code/web-app`). */
export type StreamlineFolderOption = { machineId: string; path: string; name: string; machineName: string; online: boolean; homeDir?: string | null };
export type StreamlineProjectOption = { id: string; name: string };

const FOLDER_CARD_WIDTH = 246;
const COMMANDER_CARD_WIDTH = 208;
/** Phones (UI overhaul): Commanders are square cards with the avatar and name. */
const COMMANDER_SQUARE_SIZE = 104;

/** Mono amber section label used across the Streamline form. */
export function StreamlineLabel({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
    return (
        <View style={styles.labelRow}>
            <Text accessibilityRole="header" style={styles.label}>{children}</Text>
            {trailing}
        </View>
    );
}

/** A section label's trailing link, such as "Commanders ›" (UI overhaul). */
export function StreamlineLabelLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="link"
            accessibilityLabel={label}
            onPress={onPress}
            testID={testID}
            style={({ hovered, pressed }: any) => [styles.labelLink, (hovered || pressed) && styles.labelLinkHovered]}
        >
            <Text style={styles.labelLinkText}>{label}</Text>
            <Ionicons name="chevron-forward" size={13} color={theme.colors.textSecondary} />
        </Pressable>
    );
}

/**
 * The three Streamline choices: Commander, working folder and project. Wide
 * layouts wrap the cards. Phones (UI overhaul) scroll square Commander cards
 * and folder chips sideways, edge to edge, and wrap the project chips.
 */
export function StreamlineSections(props: {
    compact: boolean;
    commanders: readonly StreamlineCommanderOption[];
    commanderMachineId: string | null;
    commanderId: string | null;
    commanderNote?: string | null;
    onSelectCommander: (id: string | null) => void;
    onCreateCommander: () => void;
    onOpenCommanders: () => void;
    folders: readonly StreamlineFolderOption[];
    selectedFolder: { machineId: string | null; path: string | null; name: string; machineName: string | null; homeDir?: string | null } | null;
    /** Canonical match of a folder against the selection (machine and normalized path). */
    isFolderSelected: (folder: { machineId: string; path: string }) => boolean;
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
    const selectedKnown = props.folders.some(props.isFolderSelected);

    // Folder cards continue the Commander cards' entrance stagger.
    let index = props.commanders.length + 2;
    const folderCards = props.compact ? [
        ...props.folders.map((folder) => (
            <StreamlineFolderChip
                key={`${folder.machineId}:${folder.path}`}
                folder={folder}
                selected={props.isFolderSelected(folder)}
                onPress={() => props.onSelectFolder(folder)}
            />
        )),
        ...(props.selectedFolder && !selectedKnown && props.selectedFolder.machineId && props.selectedFolder.path ? [
            <StreamlineFolderChip
                key="selected"
                folder={{
                    machineId: props.selectedFolder.machineId,
                    path: props.selectedFolder.path,
                    name: props.selectedFolder.name,
                    machineName: props.selectedFolder.machineName ?? props.selectedFolder.machineId,
                    online: true,
                    homeDir: props.selectedFolder.homeDir,
                }}
                selected
                onPress={props.onChooseFolder}
            />,
        ] : []),
        <Pressable
            key="browse"
            accessibilityRole="button"
            accessibilityLabel={t('newSession.streamline.browseFolder')}
            aria-expanded={props.chooseFolderOpen}
            onPress={props.onChooseFolder}
            testID="streamline-choose-folder"
            style={({ hovered, pressed }: any) => [
                styles.chip,
                styles.chipTouch,
                styles.cardDashed,
                (hovered || pressed) && !props.chooseFolderOpen && styles.cardHovered,
                props.chooseFolderOpen && styles.cardSelected,
            ]}
        >
            <Ionicons name="add" size={15} color={theme.colors.textLink} />
            <Text numberOfLines={1} style={[styles.chipText, styles.cardTitleAccent]}>{t('newSession.streamline.browseFolder')}</Text>
        </Pressable>,
    ] : [
        ...props.folders.map((folder) => (
            <StreamlineFolderCard
                key={`${folder.machineId}:${folder.path}`}
                index={index++}
                folder={folder}
                selected={props.isFolderSelected(folder)}
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
                    homeDir: props.selectedFolder.homeDir,
                }}
                selected
                onPress={props.onChooseFolder}
            />,
        ] : []),
        // The folder dropdown floats from the Choose folder card, over the form.
        <View key="browse" style={[styles.anchor, props.chooseFolderOpen && styles.anchorOpen]}>
            <ChoiceCard
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
            />
            {props.chooseFolderPopover}
        </View>,
    ];

    return (
        // The folder dropdown floats over what follows; every web View is its own stacking layer.
        <View style={[styles.root, props.chooseFolderOpen && styles.anchorOpen]} testID="streamline-sections">
            <StreamlineLabel trailing={(
                <StreamlineLabelLink
                    label={t('happyHerd.commander.category')}
                    onPress={props.onOpenCommanders}
                    testID="streamline-open-commanders"
                />
            )}>{t('happyHerd.commander.category')}</StreamlineLabel>
            <StreamlineCommanderChoices
                compact={props.compact}
                commanders={props.commanders}
                machineId={props.commanderMachineId}
                selectedId={props.commanderId}
                onSelect={props.onSelectCommander}
                onCreate={props.onCreateCommander}
            />
            {props.commanderNote ? <Text style={styles.note}>{props.commanderNote}</Text> : null}

            <StreamlineLabel>{t('newSession.streamline.whereLabel')}</StreamlineLabel>
            <ChoiceRow compact={props.compact} raised={props.chooseFolderOpen}>{folderCards}</ChoiceRow>

            <StreamlineLabel>{t('projects.project')}</StreamlineLabel>
            <StreamlineProjectChoices
                compact={props.compact}
                projects={props.projects}
                projectId={props.projectId}
                focusProjectId={props.focusProjectId}
                onSelect={props.onSelectProject}
            />
        </View>
    );
}

/**
 * The Commander choices: no Commander, each Commander, and Create Commander.
 * Wide layouts wrap cards; phones scroll square cards sideways. Streamline and
 * Advanced share them (UI overhaul).
 */
export function StreamlineCommanderChoices(props: {
    compact: boolean;
    commanders: readonly StreamlineCommanderOption[];
    machineId: string | null;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onCreate: () => void;
    /** Test ID prefix; Streamline keeps `streamline`. */
    testIDPrefix?: string;
}) {
    const { theme } = useUnistyles();
    const prefix = props.testIDPrefix ?? 'streamline';
    let index = 0;
    const commanderCards = props.compact ? [
        <SquareCard
            key="none"
            index={index++}
            selected={!props.selectedId}
            onPress={() => props.onSelect(null)}
            testID={`${prefix}-commander-none`}
            accessibilityLabel={`${t('uiCopy.noCommander')}, ${t('uiCopy.useGlobalAgentsMdOnly')}`}
            leading={<View style={[styles.glyph, styles.glyphSquare]}><Ionicons name="document-text-outline" size={18} color={theme.colors.textSecondary} /></View>}
            title={t('uiCopy.noCommander')}
        />,
        ...props.commanders.map((commander) => (
            <SquareCard
                key={commander.id}
                index={index++}
                selected={props.selectedId === commander.id}
                onPress={() => props.onSelect(commander.id)}
                testID={`${prefix}-commander-${commander.id}`}
                accessibilityLabel={commander.role ? `${commander.name}, ${commander.role}` : commander.name}
                leading={(
                    <CommanderSessionAvatar
                        accessible={false}
                        machineId={props.machineId}
                        commanderId={commander.id}
                        commanderName={commander.name}
                        size={44}
                    />
                )}
                title={commander.name}
            />
        )),
        <SquareCard
            key="create"
            index={index++}
            dashed
            accent
            role="button"
            onPress={props.onCreate}
            testID={`${prefix}-commander-create`}
            accessibilityLabel={t('happyHerd.commander.createTitle')}
            leading={<View style={[styles.glyph, styles.glyphSquare, styles.glyphDashed]}><Ionicons name="add" size={18} color={theme.colors.textLink} /></View>}
            title={t('common.create')}
        />,
    ] : [
        <ChoiceCard
            key="none"
            index={index++}
            width={COMMANDER_CARD_WIDTH}
            selected={!props.selectedId}
            onPress={() => props.onSelect(null)}
            testID={`${prefix}-commander-none`}
            leading={<View style={styles.glyph}><Ionicons name="document-text-outline" size={16} color={theme.colors.textSecondary} /></View>}
            title={t('uiCopy.noCommander')}
            subtitle={t('uiCopy.useGlobalAgentsMdOnly')}
        />,
        ...props.commanders.map((commander) => (
            <ChoiceCard
                key={commander.id}
                index={index++}
                width={COMMANDER_CARD_WIDTH}
                selected={props.selectedId === commander.id}
                onPress={() => props.onSelect(commander.id)}
                testID={`${prefix}-commander-${commander.id}`}
                leading={(
                    <CommanderSessionAvatar
                        accessible={false}
                        machineId={props.machineId}
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
            onPress={props.onCreate}
            testID={`${prefix}-commander-create`}
            leading={<View style={[styles.glyph, styles.glyphDashed]}><Ionicons name="add" size={16} color={theme.colors.textLink} /></View>}
            title={t('happyHerd.commander.createTitle')}
            subtitle={t('happyHerd.commander.createSubtitle')}
            accent
        />,
    ];

    return <ChoiceRow compact={props.compact}>{commanderCards}</ChoiceRow>;
}

/** The project chips, No Project first; they wrap on every width. */
export function StreamlineProjectChoices(props: {
    compact: boolean;
    projects: readonly StreamlineProjectOption[];
    projectId: string | null;
    focusProjectId?: string | null;
    onSelect: (id: string | null) => void;
}) {
    return (
        <ChoiceRow compact={false} chips>
            <ProjectChip key="none" label={t('projects.noProject')} selected={!props.projectId} touch={props.compact} onPress={() => props.onSelect(null)} />
            {props.projects.map((project) => (
                <ProjectChip
                    key={project.id}
                    label={project.name}
                    selected={props.projectId === project.id}
                    focus={props.focusProjectId === project.id}
                    touch={props.compact}
                    onPress={() => props.onSelect(project.id)}
                />
            ))}
        </ChoiceRow>
    );
}

function ChoiceRow({ compact, chips, raised, children }: { compact: boolean; chips?: boolean; raised?: boolean; children: React.ReactNode }) {
    if (compact) {
        return (
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.row, styles.swipeContent, chips && styles.chipRow]}
                style={styles.swipeRow}
                testID="streamline-swipe-row"
            >
                {children}
            </ScrollView>
        );
    }
    return <View style={[styles.row, styles.wrapRow, chips && styles.chipRow, raised && styles.anchorOpen]}>{children}</View>;
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

/** Phones: a square card with the avatar or glyph above the name. */
function SquareCard(props: {
    index: number;
    title: string;
    accessibilityLabel: string;
    leading: React.ReactNode;
    selected?: boolean;
    dashed?: boolean;
    accent?: boolean;
    role?: 'radio' | 'button';
    onPress: () => void;
    testID?: string;
}) {
    const role = props.role ?? 'radio';
    return (
        <Pressable
            accessibilityRole={role}
            accessibilityLabel={props.accessibilityLabel}
            aria-checked={role === 'radio' ? !!props.selected : undefined}
            onPress={props.onPress}
            testID={props.testID}
            style={({ hovered, pressed }: any) => [
                styles.card(props.index),
                styles.square,
                props.dashed && styles.cardDashed,
                (hovered || pressed) && !props.selected && styles.cardHovered,
                props.selected && styles.cardSelected,
            ]}
        >
            {props.leading}
            <Text numberOfLines={2} style={[styles.squareTitle, props.accent && styles.cardTitleAccent]}>{props.title}</Text>
        </Pressable>
    );
}

/** Phones: a working folder as a chip, the name and then its machine, like the project chips. */
function StreamlineFolderChip({ folder, selected, onPress }: {
    folder: StreamlineFolderOption;
    selected: boolean;
    onPress: () => void;
}) {
    const repository = useGithubRepository(folder.online ? folder.machineId : null, folder.path);
    const label = [
        folder.name,
        formatPathRelativeToHome(folder.path, folder.homeDir ?? undefined),
        folder.machineName,
        repository.status === 'github' ? t('newSession.streamline.githubBadge') : null,
        folder.online ? null : t('status.offline'),
    ].filter(Boolean).join(', ');
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            aria-checked={selected}
            disabled={!folder.online}
            onPress={onPress}
            testID={`streamline-folder-${folder.machineId}-${folder.name}`}
            style={({ hovered, pressed }: any) => [
                styles.chip,
                styles.chipTouch,
                (hovered || pressed) && !selected && styles.cardHovered,
                selected && styles.cardSelected,
                !folder.online && styles.cardDisabled,
            ]}
        >
            <Text numberOfLines={1} style={styles.chipText}>{folder.name}</Text>
            <Text numberOfLines={1} style={[styles.chipSub, selected && styles.chipSubSelected]}>{folder.machineName}</Text>
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
            subtitle={formatPathRelativeToHome(folder.path, folder.homeDir ?? undefined)}
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

function ProjectChip({ label, selected, focus, touch, onPress }: { label: string; selected: boolean; focus?: boolean; touch?: boolean; onPress: () => void }) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={label}
            aria-checked={selected}
            onPress={onPress}
            style={({ hovered, pressed }: any) => [
                styles.chip,
                touch && styles.chipTouch,
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
    anchor: {
        position: 'relative',
    },
    anchorOpen: {
        zIndex: 30,
    },
    labelLink: {
        marginLeft: 'auto',
        height: 30,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        borderRadius: theme.kilv.radius,
        _web: { _classNames: herdWebClasses('herd-transition') },
    },
    labelLinkHovered: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    labelLinkText: {
        fontSize: 13.5,
        color: theme.colors.text,
        ...Typography.default(),
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
    glyphSquare: {
        width: 44,
        height: 44,
        borderRadius: 22,
    },
    // Phones: the Commander square.
    square: {
        width: COMMANDER_SQUARE_SIZE,
        height: COMMANDER_SQUARE_SIZE,
        minHeight: COMMANDER_SQUARE_SIZE,
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 10,
        paddingHorizontal: 8,
    },
    squareTitle: {
        maxWidth: '100%',
        fontSize: 12.5,
        lineHeight: 15,
        textAlign: 'center',
        color: theme.colors.text,
        ...Typography.default('semiBold'),
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
    // Phones: touch-size chips.
    chipTouch: {
        height: 44,
        flexShrink: 0,
    },
    chipSub: {
        fontSize: 11.5,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    chipSubSelected: {
        color: theme.colors.textSecondary,
    },
}));
