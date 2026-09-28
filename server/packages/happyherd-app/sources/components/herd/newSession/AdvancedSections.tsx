import * as React from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { HerdSegmentedControl } from '@/components/herd/SegmentedControl';
import { t } from '@/text';
import { herdStaggerClass, herdWebClasses } from '../motion';
import {
    StreamlineCommanderChoices,
    StreamlineLabel,
    StreamlineLabelLink,
    StreamlineProjectChoices,
    type StreamlineCommanderOption,
    type StreamlineProjectOption,
} from './StreamlineSections';

export type AdvancedMachineOption = { id: string; name: string; os: string; online: boolean; accessibilityDetail: string };
export type AdvancedChoiceOption = { key: string; label: string; disabled?: boolean; section?: string };

/** The mock's machine cards take at least this width, as many to a row as fit. */
const MACHINE_CARD_MIN_WIDTH = 200;
const MACHINE_CARD_GAP = 12;

/**
 * Advanced New Session (UI overhaul): the full form as the approved mock lays
 * it out. Machine cards, then Workspace and AI provider, model and effort,
 * permission mode, project and worktree, and the Commander cards. Wide layouts
 * pair sections in two columns; phones stack them.
 */
export function AdvancedSections(props: {
    compact: boolean;
    machines: readonly AdvancedMachineOption[];
    machineId: string | null;
    onSelectMachine: (id: string) => void;
    offlineNotice?: { title: string; body: string } | null;
    pathLabel: string;
    pathOpen: boolean;
    onTogglePath: () => void;
    pathPopover?: React.ReactNode;
    providers: readonly AdvancedChoiceOption[];
    providerKey: string;
    renderProviderIcon: (key: string, color: string) => React.ReactNode;
    onSelectProvider: (key: string) => void;
    models: readonly AdvancedChoiceOption[] | null;
    modelKey: string | null;
    onSelectModel: (key: string) => void;
    efforts: readonly AdvancedChoiceOption[] | null;
    effortKey: string | null;
    onSelectEffort: (key: string) => void;
    permissionTitle: string;
    permissions: readonly AdvancedChoiceOption[] | null;
    permissionKey: string | null;
    onSelectPermission: (key: string) => void;
    projects: readonly StreamlineProjectOption[];
    projectId: string | null;
    focusProjectId?: string | null;
    onSelectProject: (id: string | null) => void;
    worktree: {
        title: string;
        fixed: readonly AdvancedChoiceOption[];
        existing: readonly AdvancedChoiceOption[];
        value: string;
        onSelect: (key: string) => void;
    } | null;
    commanders: readonly StreamlineCommanderOption[];
    commanderMachineId: string | null;
    commanderId: string | null;
    commanderNote?: string | null;
    onSelectCommander: (id: string | null) => void;
    onCreateCommander: () => void;
    onOpenCommanders: () => void;
}) {
    const { theme } = useUnistyles();
    const offline = !!props.offlineNotice;
    const [machinesWidth, setMachinesWidth] = React.useState(0);
    const machineCardWidth = resolveMachineCardWidth(machinesWidth, props.machines.length, props.compact);
    const onMachinesLayout = React.useCallback((event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.width);
        setMachinesWidth((current) => (current === next ? current : next));
    }, []);

    const effortSegments = segmentOptions(props.efforts, props.effortKey);
    const permissionSegments = segmentOptions(props.permissions, props.permissionKey);
    const worktreeSegments = props.worktree
        ? props.worktree.fixed.map((option) => ({ value: option.key, label: option.label }))
        : [];
    const worktreeValue = props.worktree?.value ?? '';
    const worktreeOnFixed = worktreeSegments.some((option) => option.value === worktreeValue);

    const workspaceBlock = (
        <View style={styles.column}>
            <StreamlineLabel>{t('newSession.workspace')}</StreamlineLabel>
            {/* The dropdown floats from here, over the sections below. */}
            <View style={[styles.anchor, props.pathOpen && styles.anchorOpen]}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('sessionInfo.path')}
                accessibilityValue={{ text: props.pathLabel }}
                aria-expanded={props.pathOpen}
                onPress={props.onTogglePath}
                testID="advanced-path"
                style={({ hovered, pressed }: any) => [styles.pathButton, (hovered || pressed || props.pathOpen) && styles.pathButtonActive]}
            >
                <Ionicons name={props.pathOpen ? 'folder-open-outline' : 'folder-outline'} size={16} color={theme.colors.textSecondary} />
                <Text numberOfLines={1} style={styles.pathText}>{props.pathLabel}</Text>
                <Ionicons name={props.pathOpen ? 'chevron-up' : 'chevron-down'} size={15} color={theme.colors.kilv.inkFaint} />
            </Pressable>
            {props.pathPopover}
            </View>
        </View>
    );

    const providerBlock = (
        <View style={styles.column}>
            <StreamlineLabel>{t('sessionInfo.aiProvider')}</StreamlineLabel>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('sessionInfo.aiProvider')}>
                {props.providers.map((provider) => {
                    const selected = provider.key === props.providerKey;
                    return (
                        <Chip
                            key={provider.key}
                            label={provider.label}
                            selected={selected}
                            disabled={provider.disabled}
                            touch={props.compact}
                            leading={props.renderProviderIcon(provider.key, selected ? theme.colors.text : theme.colors.textSecondary)}
                            onPress={() => props.onSelectProvider(provider.key)}
                            testID={`advanced-provider-${provider.key}`}
                        />
                    );
                })}
            </View>
        </View>
    );

    const modelBlock = props.models && props.models.length > 0 ? (
        <View style={styles.column}>
            <StreamlineLabel>{t('agentInput.model.title')}</StreamlineLabel>
            {/* Models from several providers keep the model picker's provider groups. */}
            {groupBySection(props.models).map((group, groupIndex) => (
                <View key={group.section ?? `group-${groupIndex}`} style={groupIndex > 0 && styles.modelGroupGap}>
                    {group.section ? <Text style={styles.modelGroupLabel}>{group.section}</Text> : null}
                    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={group.section ?? t('agentInput.model.title')}>
                        {group.options.map((model) => (
                            <Chip
                                key={model.key}
                                label={model.label}
                                selected={model.key === props.modelKey}
                                disabled={model.disabled}
                                touch={props.compact}
                                onPress={() => props.onSelectModel(model.key)}
                                testID={`advanced-model-${model.key}`}
                            />
                        ))}
                    </View>
                </View>
            ))}
        </View>
    ) : <View style={styles.column} />;

    const effortBlock = effortSegments.length > 0 ? (
        <View style={styles.column}>
            <StreamlineLabel>{t('agentInput.effort.title')}</StreamlineLabel>
            <HerdSegmentedControl
                options={effortSegments}
                value={props.effortKey ?? effortSegments[0].value}
                onChange={props.onSelectEffort}
                size={props.compact ? 'touch' : 'md'}
                fit={props.compact}
                accessibilityLabel={t('agentInput.effort.title')}
                testID="advanced-effort"
            />
        </View>
    ) : <View style={styles.column} />;

    return (
        <View testID="advanced-sections">
            <StreamlineLabel>{t('happyHerd.automations.machine')}</StreamlineLabel>
            <View style={styles.machines} onLayout={onMachinesLayout} accessibilityRole="radiogroup" accessibilityLabel={t('happyHerd.automations.machine')}>
                {props.machines.map((machine, index) => {
                    const selected = machine.id === props.machineId;
                    return (
                        <Pressable
                            key={machine.id}
                            accessibilityRole="radio"
                            accessibilityLabel={`${machine.name}, ${machine.accessibilityDetail}`}
                            aria-checked={selected}
                            onPress={() => props.onSelectMachine(machine.id)}
                            testID={`advanced-machine-${machine.id}`}
                            style={({ hovered, pressed }: any) => [
                                styles.machineCard(index),
                                machineCardWidth ? { width: machineCardWidth } : styles.machineCardFill,
                                (hovered || pressed) && !selected && styles.hovered,
                                selected && styles.selected,
                                !machine.online && styles.machineOffline,
                            ]}
                        >
                            <View style={[styles.dot, machine.online ? styles.dotOnline : styles.dotOffline]} />
                            <View style={styles.machineText}>
                                <Text numberOfLines={1} style={styles.machineName}>{machine.name}</Text>
                                <Text numberOfLines={1} style={styles.machineOs}>
                                    {[machine.os, machine.online ? t('status.online') : t('status.offline')].filter(Boolean).join(' · ')}
                                </Text>
                            </View>
                        </Pressable>
                    );
                })}
            </View>
            {props.offlineNotice ? (
                <View style={styles.offlineCard} testID="advanced-offline-notice">
                    <Text style={styles.offlineTitle}>{props.offlineNotice.title}</Text>
                    <Text style={styles.offlineBody}>{props.offlineNotice.body}</Text>
                </View>
            ) : null}

            {/* An offline machine keeps the rest of the form visible but inert. */}
            <View style={offline && styles.inert} pointerEvents={offline ? 'none' : 'auto'} aria-disabled={offline || undefined}>
                <Grid compact={props.compact} raised={props.pathOpen ? 0 : null}>
                    {workspaceBlock}
                    {providerBlock}
                </Grid>
                <Grid compact={props.compact}>
                    {modelBlock}
                    {effortBlock}
                </Grid>
                {permissionSegments.length > 0 ? (
                    <>
                        <StreamlineLabel>{props.permissionTitle}</StreamlineLabel>
                        <HerdSegmentedControl
                            options={permissionSegments}
                            value={props.permissionKey ?? permissionSegments[0].value}
                            onChange={props.onSelectPermission}
                            size={props.compact ? 'touch' : 'md'}
                            fit={props.compact}
                            accessibilityLabel={props.permissionTitle}
                            testID="advanced-permission"
                        />
                    </>
                ) : null}
                <Grid compact={props.compact}>
                    <View style={styles.column}>
                        <StreamlineLabel>{t('projects.project')}</StreamlineLabel>
                        <StreamlineProjectChoices
                            compact={props.compact}
                            projects={props.projects}
                            projectId={props.projectId}
                            focusProjectId={props.focusProjectId}
                            onSelect={props.onSelectProject}
                        />
                    </View>
                    {props.worktree ? (
                        <View style={styles.column}>
                            <StreamlineLabel>{props.worktree.title}</StreamlineLabel>
                            <HerdSegmentedControl
                                options={worktreeSegments}
                                value={worktreeOnFixed ? worktreeValue : null}
                                onChange={props.worktree.onSelect}
                                size={props.compact ? 'touch' : 'md'}
                                fit={props.compact}
                                accessibilityLabel={props.worktree.title}
                                testID="advanced-worktree"
                            />
                            {props.worktree.existing.length > 0 ? (
                                <View style={[styles.chips, styles.existingWorktrees]}>
                                    {props.worktree.existing.map((option) => (
                                        <Chip
                                            key={option.key}
                                            label={option.label}
                                            mono
                                            selected={option.key === worktreeValue}
                                            touch={props.compact}
                                            onPress={() => props.worktree!.onSelect(option.key)}
                                            testID={`advanced-worktree-${option.key}`}
                                        />
                                    ))}
                                </View>
                            ) : null}
                        </View>
                    ) : <View style={styles.column} />}
                </Grid>
                <StreamlineLabel trailing={(
                    <StreamlineLabelLink
                        label={t('happyHerd.commander.category')}
                        onPress={props.onOpenCommanders}
                        testID="advanced-open-commanders"
                    />
                )}>
                    {t('happyHerd.commander.category')}
                </StreamlineLabel>
                <StreamlineCommanderChoices
                    compact={props.compact}
                    commanders={props.commanders}
                    machineId={props.commanderMachineId}
                    selectedId={props.commanderId}
                    onSelect={props.onSelectCommander}
                    onCreate={props.onCreateCommander}
                    testIDPrefix="advanced"
                />
                {props.commanderNote ? <Text style={styles.note}>{props.commanderNote}</Text> : null}
            </View>
        </View>
    );
}

/**
 * The mock's `repeat(auto-fit, minmax(200px, 1fr))`: as many cards to a row as
 * fit at 200 px, never more columns than cards, sharing the row equally.
 * Phones stack full width. Before the first layout the cards fill their row.
 */
export function resolveMachineCardWidth(containerWidth: number, count: number, compact: boolean): number | null {
    if (compact || containerWidth <= 0 || count <= 0) return compact && containerWidth > 0 ? containerWidth : null;
    const fit = Math.max(1, Math.floor((containerWidth + MACHINE_CARD_GAP) / (MACHINE_CARD_MIN_WIDTH + MACHINE_CARD_GAP)));
    const columns = Math.min(fit, count);
    return Math.floor((containerWidth - MACHINE_CARD_GAP * (columns - 1)) / columns);
}

/** Consecutive options that share a section; unsectioned options form their own group. */
function groupBySection(options: readonly AdvancedChoiceOption[]) {
    const groups: { section?: string; options: AdvancedChoiceOption[] }[] = [];
    for (const option of options) {
        const last = groups[groups.length - 1];
        if (last && last.section === option.section) last.options.push(option);
        else groups.push({ section: option.section, options: [option] });
    }
    return groups;
}

/** Segments for the enabled options; a disabled current choice stays visible. */
function segmentOptions(options: readonly AdvancedChoiceOption[] | null, selectedKey: string | null) {
    return (options ?? [])
        .filter((option) => !option.disabled || option.key === selectedKey)
        .map((option) => ({ value: option.key, label: option.label }));
}

/**
 * The mock's two-column rows. Only the wide layout shares the row equally;
 * stacked on phones, each cell is as tall as its own content, so wrapping
 * chips never run under the next section.
 */
/**
 * Paired columns on wide layouts, one column on phones. `raised` lifts one cell
 * and the row above the rest of the form, for a dropdown that floats from it:
 * every web View is its own stacking layer.
 */
function Grid({ compact, raised, children }: { compact: boolean; raised?: number | null; children: React.ReactNode }) {
    return (
        <View style={[styles.grid, compact && styles.gridCompact, raised != null && styles.raised]}>
            {React.Children.map(children, (child, index) => (
                <View style={[compact ? styles.cellCompact : styles.cell, raised === index && styles.raised]}>{child}</View>
            ))}
        </View>
    );
}

function Chip(props: {
    label: string;
    selected: boolean;
    disabled?: boolean;
    touch?: boolean;
    mono?: boolean;
    leading?: React.ReactNode;
    onPress: () => void;
    testID?: string;
}) {
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityLabel={props.label}
            aria-checked={props.selected}
            aria-disabled={props.disabled || undefined}
            disabled={props.disabled}
            onPress={props.onPress}
            testID={props.testID}
            style={({ hovered, pressed }: any) => [
                styles.chip,
                props.touch && styles.chipTouch,
                (hovered || pressed) && !props.selected && styles.hovered,
                props.selected && styles.selected,
                props.disabled && styles.disabled,
            ]}
        >
            {props.leading}
            <Text numberOfLines={1} style={[styles.chipText, props.mono && styles.chipTextMono]}>{props.label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    machines: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: MACHINE_CARD_GAP,
    },
    machineCard: (index: number) => ({
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-transition', 'herd-press', 'herd-rise-sm', herdStaggerClass(index)) },
    }),
    // Before the first layout, a card fills its share of the row.
    machineCardFill: {
        flexGrow: 1,
        flexBasis: MACHINE_CARD_MIN_WIDTH,
    },
    machineOffline: {
        opacity: 0.5,
    },
    machineText: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    machineName: {
        fontSize: 15.5,
        color: theme.colors.text,
        ...Typography.mono(),
    },
    machineOs: {
        fontSize: 12,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    dotOnline: {
        backgroundColor: theme.colors.status.connected,
    },
    dotOffline: {
        backgroundColor: theme.colors.status.disconnected,
    },
    offlineCard: {
        marginTop: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: theme.kilv.radiusCard,
        borderWidth: 1,
        borderColor: theme.colors.warning,
        backgroundColor: theme.colors.surface,
        _web: { _classNames: herdWebClasses('herd-rise-sm') },
    },
    offlineTitle: {
        marginBottom: 4,
        fontSize: 13.5,
        color: theme.colors.warning,
        ...Typography.default('semiBold'),
    },
    offlineBody: {
        fontSize: 13.5,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default(),
    },
    inert: {
        opacity: 0.45,
    },
    // The mock's two-column rows; each column starts with its own label.
    grid: {
        flexDirection: 'row',
        gap: 28,
    },
    gridCompact: {
        flexDirection: 'column',
        gap: 0,
    },
    cell: {
        flex: 1,
        minWidth: 0,
    },
    cellCompact: {
        minWidth: 0,
    },
    raised: {
        zIndex: 1,
    },
    column: {
        minWidth: 0,
    },
    anchor: {
        position: 'relative',
    },
    anchorOpen: {
        zIndex: 30,
    },
    pathButton: {
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: 14,
        paddingRight: 12,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
        _web: { _classNames: herdWebClasses('herd-transition') },
    },
    pathButtonActive: {
        borderColor: theme.colors.selection.border,
    },
    pathText: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.mono(),
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    modelGroupGap: {
        marginTop: 12,
    },
    modelGroupLabel: {
        marginBottom: 6,
        fontSize: 12,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default('semiBold'),
    },
    existingWorktrees: {
        marginTop: 10,
    },
    chip: {
        height: 42,
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
    // Phones: touch-size chips.
    chipTouch: {
        height: 44,
    },
    chipText: {
        fontSize: 14.5,
        color: theme.colors.text,
        ...Typography.default(),
    },
    chipTextMono: {
        fontSize: 13.5,
        ...Typography.mono(),
    },
    hovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    selected: {
        borderColor: theme.colors.selection.border,
        backgroundColor: theme.colors.selection.background,
        _web: { boxShadow: theme.colors.selection.ring },
    },
    disabled: {
        opacity: theme.kilv.disabledOpacity,
    },
    note: {
        marginTop: 8,
        fontSize: 13,
        color: theme.colors.status.disconnected,
        ...Typography.default(),
    },
}));
