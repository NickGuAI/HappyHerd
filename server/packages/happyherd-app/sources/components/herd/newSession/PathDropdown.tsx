import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { type FavoriteMachinePath, useMachinePathTree } from '@/components/MachinePathBrowser';
import { NewSessionPathScrollView } from '@/components/NewSessionPathScrollView';
import { Switch } from '@/components/Switch';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { resolvePhoneSafeTextEntryFontSize } from '@/utils/mobileTypographyFloor';
import { normalizeMachinePath } from '@/utils/normalizeMachinePath';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { herdWebClasses } from '../motion';

export type PathDropdownRecent = { key: string; label: string; subtitle?: string };

/** The dropdown's height cap, as in the mock. */
const DROPDOWN_MAX_HEIGHT = 360;

/**
 * The working-folder dropdown (UI overhaul), as the mock draws it: a bar with
 * root, parent, favorite and refresh, where it is, and Use this folder; then
 * the machine's recent paths, favorites and host folders, and a path field.
 * `anchored` floats below its trigger, over the form, and closes on a press
 * outside it or Escape; its parent must hold the trigger. `sheet` fills a
 * card that the caller places.
 */
export function PathDropdown(props: {
    variant: 'anchored' | 'sheet';
    /** 44 px rows for touch. */
    touch?: boolean;
    /** Anchored: at least this wide, for a trigger narrower than the bar. */
    minWidth?: number;
    machineId: string | null;
    machineName: string | null;
    homeDir?: string;
    platform?: string;
    online: boolean;
    value: string | null;
    recent: readonly PathDropdownRecent[];
    favorites: readonly FavoriteMachinePath[];
    onToggleFavorite: (path: string) => void;
    onChangeValue: (path: string) => void;
    /** A path was chosen; the dropdown's work is done. */
    onDone: () => void;
    onClose: () => void;
    testID?: string;
}) {
    const { theme } = useUnistyles();
    const anchored = props.variant === 'anchored';
    const tree = useMachinePathTree({
        machineId: props.machineId,
        homeDir: props.homeDir,
        platform: props.platform,
        online: props.online,
    });
    const containerRef = React.useRef<View>(null);
    const { onClose } = props;

    // Web: a press outside the dropdown and its trigger, or Escape, closes it.
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !anchored || typeof document === 'undefined') return;
        const node = containerRef.current as unknown as HTMLElement | null;
        const scope = node?.parentElement ?? node;
        const down = (event: PointerEvent) => {
            if (scope && event.target instanceof Node && scope.contains(event.target)) return;
            onClose();
        };
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('pointerdown', down, true);
        document.addEventListener('keydown', key, true);
        return () => {
            document.removeEventListener('pointerdown', down, true);
            document.removeEventListener('keydown', key, true);
        };
    }, [anchored, onClose]);

    // One recent path is checked: the exact one, else the first that is the same folder.
    const checkedKey = React.useMemo(() => {
        const value = props.value ?? '';
        if (props.recent.some((item) => item.key === value)) return value;
        const canonical = normalizeMachinePath(value, props.homeDir);
        if (canonical === null) return null;
        return props.recent.find((item) => normalizeMachinePath(item.key, props.homeDir) === canonical)?.key ?? null;
    }, [props.homeDir, props.recent, props.value]);
    const choose = (path: string) => {
        props.onChangeValue(path);
        props.onDone();
    };
    const favorites = props.favorites.filter((favorite) => favorite.machineId === props.machineId);
    const isFavorite = favorites.some((favorite) => favorite.path === tree.currentDirectory);
    const relative = (path: string) => formatPathRelativeToHome(path, props.homeDir);
    const iconColor = theme.colors.textSecondary;
    const rowStyle = ({ hovered, pressed }: any) => [styles.row, props.touch && styles.rowTouch, (hovered || pressed) && styles.rowHovered];

    const body = (
        <>
            <Text style={styles.section}>{t('workspace.recent')}</Text>
            <View testID="new-session-recent-path-list">
                {props.recent.map((item) => {
                    const checked = item.key === checkedKey;
                    return (
                        <Pressable
                            key={item.key}
                            testID={`new-session-recent-path-${encodeURIComponent(item.key)}`}
                            accessibilityRole="radio"
                            aria-checked={checked}
                            accessibilityLabel={item.label === item.key ? item.label : `${item.label}, ${item.key}`}
                            onPress={() => choose(item.key)}
                            style={rowStyle}
                        >
                            <Ionicons name="time-outline" size={14} color={iconColor} />
                            <View style={styles.rowText}>
                                <Text numberOfLines={1} style={[styles.rowLabel, checked && styles.rowLabelSelected]}>{item.label}</Text>
                                {item.subtitle && item.subtitle !== item.label ? (
                                    <Text numberOfLines={1} style={styles.rowSubtitle}>{item.subtitle}</Text>
                                ) : null}
                            </View>
                            {checked ? <Ionicons name="checkmark" size={15} color={theme.colors.textLink} /> : null}
                        </Pressable>
                    );
                })}
                {props.recent.length === 0 ? <Text style={styles.empty}>{t('uiCopy.noRecentProjectsYet')}</Text> : null}
            </View>

            {favorites.length > 0 ? (
                <>
                    <Text style={styles.section}>{t('workspace.favorites')}</Text>
                    {favorites.map((favorite) => (
                        <Pressable
                            key={favorite.path}
                            accessibilityRole="button"
                            accessibilityLabel={t('uiCopy.useFavoriteValue', { value1: favorite.path })}
                            onPress={() => choose(favorite.path)}
                            style={rowStyle}
                        >
                            <Ionicons name="star" size={14} color={theme.colors.textLink} />
                            <Text numberOfLines={1} style={[styles.rowLabel, styles.rowText]}>{relative(favorite.path)}</Text>
                        </Pressable>
                    ))}
                </>
            ) : null}

            <View style={styles.sectionRow}>
                <Text style={[styles.section, styles.sectionInRow]}>{t('uiCopy.hostFolders')}</Text>
                {tree.loading ? <ActivityIndicator size="small" color={iconColor} /> : null}
                <Text style={styles.hiddenLabel}>{t('newSession.showHidden')}</Text>
                <Switch
                    testID="machine-path-show-hidden"
                    accessibilityLabel={t('newSession.showHidden')}
                    value={tree.showHidden}
                    onValueChange={tree.setShowHidden}
                />
            </View>
            <View testID="machine-path-browser-tree">
                {tree.error ? (
                    <View style={styles.message}>
                        <Ionicons name="warning-outline" size={15} color={iconColor} />
                        <Text style={styles.messageText}>{tree.error}</Text>
                    </View>
                ) : (
                    <>
                        {tree.directories.map((entry) => (
                            <Pressable
                                key={entry.path}
                                accessibilityRole="button"
                                accessibilityLabel={t('uiCopy.openFolderValue', { value1: entry.name })}
                                onPress={() => tree.setCurrentDirectory(entry.path)}
                                style={rowStyle}
                            >
                                <Ionicons name="folder-outline" size={14} color={iconColor} />
                                <Text numberOfLines={1} style={[styles.rowLabel, styles.rowText]}>{entry.name}</Text>
                                <Ionicons name="chevron-forward" size={13} color={theme.colors.kilv.inkFaint} />
                            </Pressable>
                        ))}
                        {tree.files.map((entry) => (
                            <View key={entry.path} style={[styles.row, props.touch && styles.rowTouch, styles.fileRow]}>
                                <Ionicons name="document-outline" size={14} color={iconColor} />
                                <Text numberOfLines={1} style={[styles.rowLabel, styles.rowText]}>{entry.name}</Text>
                            </View>
                        ))}
                        {!tree.loading && tree.directories.length === 0 && tree.files.length === 0 ? (
                            <Text style={styles.empty}>{t('uiCopy.folderIsEmpty')}</Text>
                        ) : null}
                    </>
                )}
            </View>

            {/* Any path, typed. */}
            <View style={[styles.pathInput, props.touch && styles.rowTouch]}>
                <Ionicons name="create-outline" size={14} color={iconColor} />
                <TextInput
                    value={props.value ?? ''}
                    onChangeText={props.onChangeValue}
                    onSubmitEditing={props.onDone}
                    placeholder={t('uiCopy.enterProjectPath')}
                    placeholderTextColor={theme.colors.kilv.inkFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    style={styles.pathInputText}
                />
            </View>
        </>
    );

    return (
        <View
            ref={containerRef}
            testID={props.testID ?? 'new-session-path-dropdown'}
            accessibilityRole={Platform.OS === 'web' ? ('dialog' as any) : undefined}
            accessibilityLabel={t('workspace.browseMachine')}
            style={anchored ? [styles.anchored, props.minWidth ? { minWidth: props.minWidth } : null] : styles.sheet}
        >
            <View style={styles.bar}>
                <BarButton label={t('uiCopy.browseFilesystemRoot')} icon="server-outline" onPress={() => tree.setCurrentDirectory(tree.root)} />
                <BarButton label={t('uiCopy.browseParentFolder')} icon="arrow-back" onPress={tree.goToParent} />
                <BarButton
                    label={isFavorite ? t('uiCopy.removeWorkspaceFavorite') : t('uiCopy.addWorkspaceFavorite')}
                    icon={isFavorite ? 'star' : 'star-outline'}
                    active={isFavorite}
                    onPress={() => props.onToggleFavorite(tree.currentDirectory)}
                />
                <BarButton label={t('uiCopy.refreshFolder')} icon="refresh" onPress={() => void tree.load()} />
                <Text numberOfLines={1} style={styles.crumbs}>
                    {[props.machineName, relative(tree.currentDirectory)].filter(Boolean).join(' · ')}
                </Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('uiCopy.useValueAsWorkspace', { value1: tree.currentDirectory })}
                    onPress={() => choose(tree.currentDirectory)}
                    style={({ hovered, pressed }: any) => [styles.use, (hovered || pressed) && styles.useHovered]}
                >
                    <Text numberOfLines={1} style={styles.useText}>{t('uiCopy.useThisFolder')}</Text>
                </Pressable>
            </View>
            {anchored ? (
                <NewSessionPathScrollView testID="new-session-path-dropdown-body" maxHeight={DROPDOWN_MAX_HEIGHT - 52} keyboardShouldPersistTaps="handled">
                    {body}
                </NewSessionPathScrollView>
            ) : body}
        </View>
    );
}

function BarButton({ label, icon, active, onPress }: {
    label: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    active?: boolean;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={({ hovered, pressed }: any) => [styles.barButton, (hovered || pressed) && styles.rowHovered]}
        >
            <Ionicons name={icon} size={14} color={active ? theme.colors.textLink : theme.colors.textSecondary} />
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    anchored: {
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        marginTop: 8,
        zIndex: 30,
        maxHeight: DROPDOWN_MAX_HEIGHT,
        padding: 8,
        borderRadius: theme.kilv.radiusCard,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.kilv.bgRaised,
        _web: {
            boxShadow: theme.kilv.shadow,
            transformOrigin: 'top center',
            _classNames: herdWebClasses('herd-pop'),
        },
    },
    sheet: {
        padding: 8,
    },
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingTop: 2,
        paddingHorizontal: 2,
        paddingBottom: 8,
        marginBottom: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    barButton: {
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
        _web: { _classNames: herdWebClasses('herd-transition') },
    },
    crumbs: {
        flex: 1,
        minWidth: 0,
        marginLeft: 6,
        fontSize: 12.5,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    use: {
        height: 30,
        justifyContent: 'center',
        paddingHorizontal: 12,
        borderRadius: theme.kilv.radius,
        backgroundColor: theme.colors.button.primary.background,
        _web: { _classNames: herdWebClasses('herd-transition', 'herd-press') },
    },
    useHovered: {
        opacity: 0.9,
    },
    useText: {
        fontSize: 13,
        color: theme.colors.button.primary.tint,
        ...Typography.default('semiBold'),
    },
    section: {
        paddingTop: 8,
        paddingHorizontal: 8,
        paddingBottom: 4,
        fontSize: 10.5,
        letterSpacing: 1.9,
        textTransform: 'uppercase',
        color: theme.colors.textLink,
        ...Typography.mono('semiBold'),
    },
    sectionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingRight: 6,
    },
    sectionInRow: {
        flex: 1,
    },
    hiddenLabel: {
        paddingTop: 4,
        fontSize: 11,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    row: {
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 10,
        borderRadius: 7,
        _web: { _classNames: herdWebClasses('herd-transition') },
    },
    rowTouch: {
        height: 44,
    },
    rowHovered: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    fileRow: {
        opacity: 0.6,
    },
    rowText: {
        flex: 1,
        minWidth: 0,
    },
    rowLabel: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    rowLabelSelected: {
        color: theme.colors.text,
    },
    rowSubtitle: {
        fontSize: 11,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    empty: {
        paddingVertical: 10,
        paddingHorizontal: 10,
        fontSize: 12,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    message: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
    },
    messageText: {
        flexShrink: 1,
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    pathInput: {
        minHeight: 36,
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 10,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input.background,
    },
    pathInputText: {
        flex: 1,
        minWidth: 0,
        height: '100%',
        // Web text entry stays at 16 px, so a phone never zooms into it.
        fontSize: resolvePhoneSafeTextEntryFontSize(Platform.OS, 13),
        color: theme.colors.text,
        ...Typography.mono(),
        _web: { outlineStyle: 'none' },
    },
}));
