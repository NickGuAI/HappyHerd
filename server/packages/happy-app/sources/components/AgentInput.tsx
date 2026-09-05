import { Ionicons, Octicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import * as React from 'react';
import { Keyboard, View, Platform, useWindowDimensions, Text, ActivityIndicator, Pressable, TouchableWithoutFeedback, LayoutChangeEvent } from 'react-native';
import { AgentInputAttachmentStrip } from './AgentInputAttachmentStrip';
import { WorkspaceContextStrip } from './WorkspaceContextStrip';
import type { AttachmentPreview } from '@/sync/attachmentTypes';
import { AttachmentInputButton } from '@/components/AttachmentInputButton';
import { AttachmentInputMenu, type AttachmentInputMenuAnchor } from '@/components/AttachmentInputMenu';
import type { WorkspaceContextEntry } from '@/sync/workspaceContext';
import { generateThumbhash } from '@/utils/thumbhash';
import { layout } from './layout';
import { MultiTextInput, KeyPressEvent } from './MultiTextInput';
import { Typography } from '@/constants/Typography';
import { PermissionMode, ModelMode } from './PermissionModeSelector';
import { EffortLevel } from './modelModeOptions';
import { hapticsLight, hapticsError } from './haptics';
import { Shaker, ShakeInstance } from './Shaker';
import { StatusDot } from './StatusDot';
import { useActiveWord } from './autocomplete/useActiveWord';
import { useActiveSuggestions } from './autocomplete/useActiveSuggestions';
import { AgentInputAutocomplete } from './AgentInputAutocomplete';
import { FloatingOverlay } from './FloatingOverlay';
import { TextInputState, MultiTextInputHandle } from './MultiTextInput';
import { applySuggestion } from './autocomplete/applySuggestion';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSetting } from '@/sync/storage';
import { hackMode, hackModes } from '@/sync/modeHacks';
import { getPermissionModeMenuLabel, getPermissionModeShortLabel } from '@/utils/permissionModeLabels';
import { getUsageLimitDisplayPercentage, getUsageLimitRows, formatUsageLimitResetTime, type UsageLimitsLike } from '@/utils/sessionStatusBar';
import { compactCount } from '@/utils/rigGitLineChanges';
import { Theme } from '@/theme';
import { t } from '@/text';
import { Metadata } from '@/sync/storageTypes';
import { isRunningOnMac } from '@/utils/platform';
import { MobileGlassSurface } from './MobileGlass';
import { AnimatedClickAwayBackdrop, AnimatedFade } from './AnimatedOverlay';
import { BubblePressable } from './BubblePressable';
import { resolveAgentInputPrimaryAction, resolveAgentInputSendPressAvailability } from './agentInputPrimaryAction';
import { resolveVoiceDictationControl, resolveVoiceDictationControlVisibility } from './voiceDictationControl';
import { NativeSettingsMenu, type NativeSettingsMenuGroup, type NativeSettingsMenuOption } from './NativeSettingsMenu';
import { ProviderIcon } from './ProviderIcon';
import { isRigMetadata } from '@/sync/rig';
import type { VoiceDictationPhase } from '@/hooks/useVoiceDictation';
import {
    MOBILE_COMPOSER_LAYOUT,
    MOBILE_COMPOSER_METRICS,
    resolveMobileComposerActionGeometry,
    resolveMobileComposerActionRowGeometry,
    resolveMobileComposerMenuGeometry,
} from './agentInputLayout';
import { shouldUseExpoNativeSettingsMenu } from './glassInteractionPolicy';

interface AgentInputProps {
    // `initialValue` seeds the uncontrolled textarea once; keystrokes never
    // round-trip back into it via React, which is what keeps fast typing/
    // deletion crisp. The parent reads the live text via the imperative ref.
    initialValue: string;
    placeholder: string;
    // Fires on every keystroke so the parent can sync derived state (drafts,
    // hasText) — typically wrapped in startTransition / debounce by the caller.
    onChangeText?: (text: string) => void;
    sessionId?: string;
    onSend: () => void;
    onQueueMessage?: () => void;
    /** Owns the single consolidated action menu in a Web session host. */
    showWebActionMenu?: boolean;
    /** Session-scoped file surfaces consolidated into the Web composer menu. */
    webWorkspaceActions?: {
        onOpenChanges: () => void;
        onOpenWorkspace: () => void;
    };
    sendIcon?: React.ReactNode;
    onMicPress?: () => void;
    permissionMode?: PermissionMode | null;
    /** Show a daemon-confirmed launch mode without offering a runtime mutation. */
    permissionModeReadOnly?: boolean;
    availableModes?: PermissionMode[];
    onPermissionModeChange?: (mode: PermissionMode) => void;
    modelMode?: ModelMode | null;
    availableModels?: ModelMode[];
    onModelModeChange?: (mode: ModelMode) => void;
    effortLevel?: EffortLevel | null;
    availableEffortLevels?: EffortLevel[];
    onEffortLevelChange?: (level: EffortLevel) => void;
    metadata?: Metadata | null;
    onAbort?: () => void | Promise<void>;
    showAbortButton?: boolean;
    connectionStatus?: {
        text: string;
        color: string;
        dotColor: string;
        isPulsing?: boolean;
        cliStatus?: {
            claude: boolean | null;
            codex: boolean | null;
            gemini?: boolean | null;
        };
    };
    autocompletePrefixes: string[];
    autocompleteSuggestions: (query: string) => Promise<{ key: string, text: string, component: React.ElementType }[]>;
    usageData?: {
        inputTokens: number;
        outputTokens: number;
        cacheCreation: number;
        cacheRead: number;
        contextSize: number;
        contextWindow?: number;
    };
    alwaysShowContextSize?: boolean;
    /** Hide the auxiliary connection/mode row while reading older messages. */
    showStatusDetails?: boolean;
    /**
     * Reports the composer card's top offset from AgentInput's own top edge.
     * The status/chips rows above the card keep their layout space when faded
     * out, so callers anchoring to AgentInput would float above empty space.
     */
    onActionAreaOffsetChange?: (offset: number) => void;
    sessionStatusGitBranch?: string | null;
    /** Unstaged line changes for the checkout, matching the session list. */
    sessionStatusGitChanges?: { insertions: number; deletions: number; approximate: boolean } | null;
    /** Plan quota windows from agent state, for the week stat and its popup. */
    sessionStatusUsageLimits?: UsageLimitsLike | null;
    agentType?: 'claude' | 'codex' | 'grok' | 'dsh' | 'gemini' | 'agy';
    onAgentClick?: () => void;
    machineName?: string | null;
    onMachineClick?: () => void;
    currentPath?: string | null;
    onPathClick?: () => void;
    blockSend?: boolean;
    isSendDisabled?: boolean;
    isSending?: boolean;
    minHeight?: number;
    zenMode?: boolean;
    /** Image attachments waiting to be sent. */
    selectedImages?: AttachmentPreview[];
    onPickImages?: () => void;
    onPickDeviceFiles?: () => void;
    /** Keep DSH Photos/Device files split on desktop and group them beneath Attachments on Web Mobile. */
    splitWebAttachmentActions?: boolean;
    onRemoveImage?: (id: string) => void;
    onAddImages?: (images: AttachmentPreview[]) => void;
    /** Explicit workspace files/directories embedded in the next user message. */
    selectedContextEntries?: readonly WorkspaceContextEntry[];
    onRemoveContextEntry?: (entry: WorkspaceContextEntry) => void;
    dictationPhase?: VoiceDictationPhase;
    dictationError?: string | null;
    onDictationCancel?: () => void;
    onDictationRetry?: () => void;
}

function permissionKindIcon(kind: string | null | undefined): React.ComponentProps<typeof Ionicons>['name'] {
    if (kind === 'read-only') return 'lock-closed-outline';
    if (kind === 'safe-yolo') return 'shield-checkmark-outline';
    if (kind === 'yolo') return 'warning-outline';
    return 'folder-open-outline';
}

const MOBILE_MODEL_MENU_GEOMETRY = resolveMobileComposerMenuGeometry('model');
const MOBILE_EFFORT_MENU_GEOMETRY = resolveMobileComposerMenuGeometry('effort');
const MOBILE_PERMISSION_MENU_GEOMETRY = resolveMobileComposerMenuGeometry('permission');
const MOBILE_ACTION_ROW_GEOMETRY = resolveMobileComposerActionRowGeometry();
const MOBILE_ICON_ACTION_GEOMETRY = resolveMobileComposerActionGeometry('icon');
const MOBILE_PRIMARY_ACTION_GEOMETRY = resolveMobileComposerActionGeometry('primary');

// Shared with the action-area offset reported to onActionAreaOffsetChange —
// the Shaker's layout.y is relative to innerContainer, which sits this far
// below AgentInput's top edge.
const CONTAINER_TOP_PADDING = 8;

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        alignItems: 'center',
        paddingBottom: 8,
        paddingTop: CONTAINER_TOP_PADDING,
    },
    innerContainer: {
        width: '100%',
        position: 'relative',
    },
    unifiedPanel: {
        backgroundColor: theme.colors.input.background,
        borderRadius: Platform.select({ default: 16, android: 20 }),
        overflow: 'hidden',
        paddingVertical: 2,
        paddingBottom: 8,
        paddingHorizontal: 8,
    },
    unifiedPanelShadow: {
        borderRadius: 24,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: theme.dark ? 6 : 2 },
        shadowOpacity: theme.dark ? 0.22 : 0.08,
        shadowRadius: theme.dark ? 16 : 8,
        elevation: theme.dark ? 4 : 2,
    },
    mobileUnifiedPanel: {
        // The frosted material is supplied by MobileGlassSurface. The dense
        // tint keeps the transcript illegible behind it without losing glass.
        backgroundColor: Platform.select({
            ios: 'transparent',
            android: theme.colors.glass.backgroundStrong,
            default: theme.colors.input.background,
        }),
        borderRadius: MOBILE_COMPOSER_METRICS.shellRadius,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.glass.border,
        paddingHorizontal: MOBILE_COMPOSER_METRICS.shellInset,
        paddingTop: MOBILE_COMPOSER_METRICS.shellPaddingTop,
        paddingBottom: MOBILE_COMPOSER_METRICS.shellPaddingBottom,
    },
    mobileUnifiedPanelShadow: {
        borderRadius: MOBILE_COMPOSER_METRICS.shellRadius,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 0,
        paddingLeft: 2,
        paddingRight: 8,
        paddingVertical: 4,
        minHeight: 40,
    },
    mobileInputContainer: {
        alignItems: 'center',
        // Keep a one-line composer compact while aligning its caret with the
        // add glyph below. The previous 60pt slot left a full blank line below
        // an empty input on phones.
        minHeight: MOBILE_COMPOSER_METRICS.inputMinHeight,
        // 18pt from the outer edge: 10pt shell inset plus the 8pt inset from
        // the add button edge to the 26pt glyph.
        paddingLeft: MOBILE_COMPOSER_LAYOUT.inputContainerPaddingLeft,
        paddingRight: MOBILE_COMPOSER_LAYOUT.inputContainerPaddingRight,
        paddingTop: MOBILE_COMPOSER_METRICS.inputPaddingTop,
        paddingBottom: MOBILE_COMPOSER_METRICS.inputPaddingBottom,
    },

    // Overlay styles
    autocompleteOverlay: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 8,
        zIndex: 1000,
    },
    settingsOverlay: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 12,
        zIndex: 1000,
    },
    mobileActionsOverlay: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        width: 320,
        maxWidth: '100%',
        marginBottom: 12,
        zIndex: 1000,
    },
    mobileActionsMenu: {
        paddingVertical: 6,
    },
    mobileActionsRow: {
        minHeight: 46,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
    },
    mobileActionsRowPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    mobileActionsRowDisabled: {
        opacity: 0.42,
    },
    mobileActionsLabel: {
        flex: 1,
        color: theme.colors.text,
        fontSize: 15,
        ...Typography.default(),
    },
    mobileActionsDestructiveLabel: {
        color: theme.colors.textDestructive,
    },
    mobileActionsTrigger: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    overlayBackdrop: {
        position: 'absolute',
        top: -1000,
        left: -1000,
        right: -1000,
        bottom: -1000,
        zIndex: 999,
    },
    overlaySection: {
        paddingVertical: 8,
    },
    settingsStatusInfo: {
        paddingTop: 6,
        paddingBottom: 4,
        paddingHorizontal: 8,
    },
    overlaySectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        paddingHorizontal: 16,
        paddingBottom: 4,
        ...Typography.default('semiBold'),
    },
    overlayDivider: {
        height: 1,
        backgroundColor: theme.colors.glass.divider,
        marginHorizontal: 16,
    },

    // Selection styles
    selectionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: 'transparent',
    },
    selectionItemPressed: {
        backgroundColor: theme.colors.surfacePressed,
    },
    radioButton: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    radioButtonActive: {
        borderColor: theme.colors.radio.active,
    },
    radioButtonInactive: {
        borderColor: theme.colors.radio.inactive,
    },
    radioButtonDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.radio.dot,
    },
    selectionLabel: {
        fontSize: 14,
        ...Typography.default(),
    },
    selectionLabelActive: {
        color: theme.colors.radio.active,
    },
    selectionLabelInactive: {
        color: theme.colors.text,
    },

    // Status styles
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 4,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusText: {
        fontSize: 11,
        ...Typography.default(),
    },
    permissionModeContainer: {
        flexDirection: 'column',
        alignItems: 'flex-end',
    },
    permissionModeText: {
        fontSize: 11,
        ...Typography.default(),
    },
    contextWarningText: {
        fontSize: 11,
        marginLeft: 8,
        ...Typography.default(),
    },

    // Button styles
    actionButtonsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 0,
    },
    mobileActionButtonsContainer: MOBILE_ACTION_ROW_GEOMETRY,
    mobileIconButton: MOBILE_ICON_ACTION_GEOMETRY,
    mobileModelMenuFrame: MOBILE_MODEL_MENU_GEOMETRY.frame,
    mobileModelMenuContent: MOBILE_MODEL_MENU_GEOMETRY.content,
    mobileEffortMenuFrame: MOBILE_EFFORT_MENU_GEOMETRY.frame,
    mobileEffortMenuContent: MOBILE_EFFORT_MENU_GEOMETRY.content,
    mobileQueueButton: {
        minWidth: 68,
        height: MOBILE_COMPOSER_METRICS.actionSize,
        paddingHorizontal: 8,
        borderRadius: MOBILE_COMPOSER_METRICS.actionSize / 2,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    mobileQueueButtonText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    mobilePermissionMenuFrame: MOBILE_PERMISSION_MENU_GEOMETRY.frame,
    mobilePermissionMenuContent: MOBILE_PERMISSION_MENU_GEOMETRY.content,
    mobilePermissionButton: {
        ...MOBILE_PERMISSION_MENU_GEOMETRY.content,
        flexShrink: 0,
    },
    mobileModeButton: {
        flex: 1,
        minWidth: 0,
        height: MOBILE_COMPOSER_METRICS.secondaryActionHeight,
        borderRadius: MOBILE_COMPOSER_METRICS.secondaryActionHeight / 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingHorizontal: 8,
        paddingRight: 0,
        gap: 7,
    },
    mobileEffortButton: {
        width: MOBILE_COMPOSER_METRICS.effortWidth,
        flexShrink: 0,
        height: MOBILE_COMPOSER_METRICS.secondaryActionHeight,
        borderRadius: MOBILE_COMPOSER_METRICS.secondaryActionHeight / 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingLeft: 2,
        paddingRight: 0,
        gap: 4,
    },
    mobileModeText: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 14,
        color: theme.colors.text,
        ...Typography.default(),
    },
    mobileModeSeparator: {
        flexShrink: 0,
        color: theme.colors.textSecondary,
        fontSize: 14,
        ...Typography.default(),
    },
    actionButtonsLeft: {
        flexDirection: 'row',
        gap: 8,
        flex: 1,
        overflow: 'hidden',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Platform.select({ default: 16, android: 20 }),
        paddingHorizontal: 8,
        paddingVertical: 6,
        justifyContent: 'center',
        height: 32,
    },
    actionButtonPressed: {
        opacity: 0.7,
    },
    actionButtonIcon: {
        color: theme.colors.button.secondary.tint,
    },
    sendButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        marginLeft: 8,
    },
    mobilePrimaryButton: MOBILE_PRIMARY_ACTION_GEOMETRY,
    mobilePrimaryButtonActive: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    mobilePrimaryButtonInactive: {
        backgroundColor: theme.dark ? '#3A3A3C' : '#D1D1D6',
    },
    mobileStopButton: {
        backgroundColor: theme.dark ? '#F5F5F5' : theme.colors.button.primary.background,
    },
    sendButtonActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    sendButtonInactive: {
        backgroundColor: theme.colors.button.primary.disabled,
    },
    sendButtonLocked: {
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    sendButtonInner: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendButtonInnerPressed: {
        opacity: 0.7,
    },
    sendButtonIcon: {
        color: theme.colors.button.primary.tint,
    },
}));

const formatTokenCount = (tokens: number): string => {
    if (tokens < 1000) {
        return `${Math.max(0, Math.round(tokens))}`;
    }
    if (tokens < 999500) {
        return `${Math.round(tokens / 1000)}k`;
    }
    const millions = tokens / 1000000;
    return `${millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10}M`;
};

const getContextStatus = (contextSize: number, alwaysShow: boolean = false, theme: Theme, contextWindow: number | undefined) => {
    // Until the session reports its window there is no honest denominator, so
    // nothing is shown rather than dividing by a guess — a percentage that
    // later corrects itself upward reads as the context refilling.
    if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
        return null;
    }
    const percentageUsed = Math.max(0, Math.min(100, (contextSize / contextWindow) * 100));
    const percentageRemaining = 100 - percentageUsed;

    let color: string;
    if (percentageRemaining <= 5) {
        color = theme.colors.warningCritical;
    } else if (percentageRemaining <= 10) {
        color = theme.colors.warning;
    } else if (alwaysShow) {
        color = theme.colors.textSecondary;
    } else {
        return null; // No display needed
    }

    return {
        percent: Math.round(percentageUsed),
        detailText: t('agentInput.context.detailContext', {
            used: formatTokenCount(contextSize),
            total: formatTokenCount(contextWindow),
        }),
        color,
    };
};

// Stable sub-trees extracted from AgentInput so they don't reconcile when
// the input's keystroke-derived state (hasText / inputState) flips. Their
// props are derived from session metadata, not from the textarea content,
// so memo skips re-render on typing entirely.

type StatusRowProps = {
    connectionStatus?: AgentInputProps['connectionStatus'];
    gitBranch: string | null;
    gitChanges: { insertions: number; deletions: number; approximate: boolean } | null;
};

const AgentInputStatusRow = React.memo(function AgentInputStatusRow(p: StatusRowProps) {
    const { theme } = useUnistyles();
    if (!p.connectionStatus && !p.gitBranch) {
        return null;
    }
    return (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingBottom: 4,
            minHeight: 20,
        }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 11 }}>
                {p.connectionStatus && (
                    <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <StatusDot
                                color={p.connectionStatus.dotColor}
                                isPulsing={p.connectionStatus.isPulsing}
                                size={6}
                                // Optically centers the dot against the 11pt text baseline.
                                style={{ marginTop: 1 }}
                            />
                            <Text style={{
                                fontSize: 11,
                                color: p.connectionStatus.color,
                                ...Typography.default()
                            }}>
                                {p.connectionStatus.text}
                            </Text>
                        </View>
                        {p.connectionStatus.cliStatus && (
                            <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Text style={{
                                        fontSize: 11,
                                        color: p.connectionStatus.cliStatus.claude ? theme.colors.success : theme.colors.textDestructive,
                                        ...Typography.default()
                                    }}>
                                        {p.connectionStatus.cliStatus.claude ? '✓' : '✗'}
                                    </Text>
                                    <Text style={{
                                        fontSize: 11,
                                        color: p.connectionStatus.cliStatus.claude ? theme.colors.success : theme.colors.textDestructive,
                                        ...Typography.default()
                                    }}>
                                        {t("uiCopy.claude")}
                                    </Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Text style={{
                                        fontSize: 11,
                                        color: p.connectionStatus.cliStatus.codex ? theme.colors.success : theme.colors.textDestructive,
                                        ...Typography.default()
                                    }}>
                                        {p.connectionStatus.cliStatus.codex ? '✓' : '✗'}
                                    </Text>
                                    <Text style={{
                                        fontSize: 11,
                                        color: p.connectionStatus.cliStatus.codex ? theme.colors.success : theme.colors.textDestructive,
                                        ...Typography.default()
                                    }}>
                                        {t("uiCopy.codex")}
                                    </Text>
                                </View>
                                {p.connectionStatus.cliStatus.gemini !== undefined && (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                        <Text style={{
                                            fontSize: 11,
                                            color: p.connectionStatus.cliStatus.gemini ? theme.colors.success : theme.colors.textDestructive,
                                            ...Typography.default()
                                        }}>
                                            {p.connectionStatus.cliStatus.gemini ? '✓' : '✗'}
                                        </Text>
                                        <Text style={{
                                            fontSize: 11,
                                            color: p.connectionStatus.cliStatus.gemini ? theme.colors.success : theme.colors.textDestructive,
                                            ...Typography.default()
                                        }}>
                                            {t("uiCopy.gemini")}
                                        </Text>
                                    </View>
                                )}
                            </>
                        )}
                    </>
                )}
            </View>
            {p.gitBranch && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}>
                    <Octicons name="git-branch" size={11} color={theme.colors.textSecondary} />
                    <Text style={{ fontSize: 11, color: theme.colors.textSecondary, flexShrink: 1, ...Typography.default() }} numberOfLines={1}>
                        {p.gitBranch}
                    </Text>
                    {p.gitChanges?.approximate && (
                        <Text style={{ fontSize: 11, color: theme.colors.textSecondary, ...Typography.default() }}>≈</Text>
                    )}
                    {p.gitChanges && p.gitChanges.insertions > 0 && (
                        <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.gitAddedText, ...Typography.default() }}>
                            +{compactCount(p.gitChanges.insertions)}
                        </Text>
                    )}
                    {p.gitChanges && p.gitChanges.deletions > 0 && (
                        <Text style={{ fontSize: 11, fontWeight: '600', color: theme.colors.gitRemovedText, ...Typography.default() }}>
                            -{compactCount(p.gitChanges.deletions)}
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
});

// Grayscale ring that fills and darkens with context usage — reads at a
// glance without color, sized to sit beside the 11pt status text.
function ContextGaugeIcon(props: { percent: number }) {
    const { theme } = useUnistyles();
    const size = 14;
    const strokeWidth = 2.5;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(100, Math.max(0, props.percent));
    const intensity = 0.35 + 0.65 * (progress / 100);
    const color = theme.dark
        ? `rgba(255, 255, 255, ${intensity})`
        : `rgba(0, 0, 0, ${intensity})`;
    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={theme.colors.divider}
                strokeWidth={strokeWidth}
                fill="none"
            />
            <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={circumference * (1 - progress / 100)}
                rotation="-90"
                originX={size / 2}
                originY={size / 2}
            />
        </Svg>
    );
}

type UsageRowProps = {
    contextStatus: { percent: number; detailText: string; color: string } | null;
    weekPercent: number | null;
    /** Prebuilt "Session — 32% · resets 6 PM" rows for the week popup. */
    usageMenuOptions: NativeSettingsMenuOption[];
};

// Sits under the composer card, right-aligned with the effort label: week
// quota (tap for the session/week detail popup) and the context gauge (tap
// to swap the percent for exact token counts).
const AgentInputUsageRow = React.memo(function AgentInputUsageRow(p: UsageRowProps) {
    const { theme } = useUnistyles();
    const [showPreciseContext, setShowPreciseContext] = React.useState(false);
    if (!p.contextStatus && p.weekPercent == null) {
        return null;
    }
    const weekText = p.weekPercent != null ? (
        <Text style={{ fontSize: 11, color: theme.colors.textSecondary, ...Typography.default() }}>
            {t('agentInput.context.percentWeek', { percent: Math.round(p.weekPercent) })}
        </Text>
    ) : null;
    return (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
            // 18 = 10pt shell inset + 8pt action inset: lines the gauge up
            // with the effort label's right edge.
            paddingHorizontal: 18,
            paddingTop: 6,
            minHeight: 18,
        }}>
            {weekText && (
                p.usageMenuOptions.length > 0 ? (
                    <NativeSettingsMenu
                        anchor="bottom"
                        groups={[{
                            key: 'usage',
                            label: '',
                            title: '',
                            options: p.usageMenuOptions,
                            selectedKey: null,
                            onSelect: () => { },
                        }]}
                    >
                        {/* Native menu triggers hit only their own bounds, so
                            pad the target out and pull the layout back in. */}
                        <View style={{ padding: 10, margin: -10 }}>
                            {weekText}
                        </View>
                    </NativeSettingsMenu>
                ) : weekText
            )}
            {p.contextStatus && (
                <Pressable
                    onPress={() => setShowPreciseContext((current) => !current)}
                    hitSlop={{ top: 12, bottom: 14, left: 10, right: 14 }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
                >
                    <Text style={{ fontSize: 11, color: p.contextStatus.color, ...Typography.default() }}>
                        {showPreciseContext
                            ? p.contextStatus.detailText
                            : t('agentInput.context.percentContext', { percent: p.contextStatus.percent })}
                    </Text>
                    <ContextGaugeIcon percent={p.contextStatus.percent} />
                </Pressable>
            )}
        </View>
    );
});

type ContextChipsProps = {
    machineName?: string | null;
    onMachineClick?: () => void;
    currentPath?: string | null;
    onPathClick?: () => void;
};

const AgentInputContextChips = React.memo(function AgentInputContextChips(p: ContextChipsProps) {
    const { theme } = useUnistyles();
    if (p.machineName === undefined && !p.currentPath) {
        return null;
    }
    return (
        <View style={{
            backgroundColor: theme.colors.surfacePressed,
            borderRadius: 12,
            padding: 8,
            marginBottom: 8,
            gap: 4,
        }}>
            {p.machineName !== undefined && p.onMachineClick && (
                <BubblePressable
                    onPress={() => {
                        hapticsLight();
                        p.onMachineClick?.();
                    }}
                    hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                    style={(s) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        borderRadius: Platform.select({ default: 16, android: 20 }),
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        height: 32,
                        opacity: s.pressed ? 0.7 : 1,
                        gap: 6,
                    })}
                >
                    <Ionicons name="desktop-outline" size={14} color={theme.colors.textSecondary} />
                    <Text style={{
                        fontSize: 13,
                        color: theme.colors.text,
                        fontWeight: '600',
                        ...Typography.default('semiBold'),
                    }}>
                        {p.machineName === null ? t('agentInput.noMachinesAvailable') : p.machineName}
                    </Text>
                </BubblePressable>
            )}
            {p.currentPath && p.onPathClick && (
                <BubblePressable
                    onPress={() => {
                        hapticsLight();
                        p.onPathClick?.();
                    }}
                    hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                    style={(s) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        borderRadius: Platform.select({ default: 16, android: 20 }),
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        height: 32,
                        opacity: s.pressed ? 0.7 : 1,
                        gap: 6,
                    })}
                >
                    <Ionicons name="folder-outline" size={14} color={theme.colors.textSecondary} />
                    <Text style={{
                        fontSize: 13,
                        color: theme.colors.text,
                        fontWeight: '600',
                        ...Typography.default('semiBold'),
                    }}>
                        {p.currentPath}
                    </Text>
                </BubblePressable>
            )}
        </View>
    );
});

export const AgentInput = React.memo(React.forwardRef<MultiTextInputHandle, AgentInputProps>((props, ref) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    // The compact action row is deliberately limited to the narrow native
    // layout. Desktop web, Mac Catalyst, and tablet-width canvases retain the
    // existing composer affordances rather than inheriting it.
    const runningOnMac = isRunningOnMac();
    const compactMobileComposer = Platform.OS !== 'web' && !runningOnMac && screenWidth <= 700;
    // SessionView supplies this contract for every Web session host. Use that
    // owning signal directly so Main Agent and Side chat keep the same menu
    // across responsive breakpoints.
    const webActionMenu = Platform.OS === 'web' && !!props.showWebActionMenu;
    // iOS only. On Android the settings/model/effort triggers are React Native
    // subtrees hosted inside a Jetpack Compose DropdownMenu, and expo-modules-core
    // pins such a child to `Modifier.size(view.width, view.height)` sampled once at
    // composition with no layout listener (ExpoComposeAndroidView) — composed before
    // React Native measures it, the trigger stays 0x0 and the control is invisible
    // while still occupying its slot. The composer's own popup pickers below render
    // identically and work, so Android uses those instead of the native menu.
    const useNativeSettingsMenus = shouldUseExpoNativeSettingsMenu(Platform.OS, runningOnMac);
    const activeSendIconColor = compactMobileComposer ? theme.colors.text : theme.colors.button.primary.tint;
    const isSendBlocked = props.blockSend ?? false;

    // `hasText` drives only the send-button appearance/enabled state. It's
    // updated via startTransition from the keystroke handler so a busy reducer
    // never blocks the next character from landing in the textarea.
    const [hasText, setHasText] = React.useState(() => props.initialValue.trim().length > 0);
    const hasImages = (props.selectedImages?.length ?? 0) > 0;
    const hasContextEntries = (props.selectedContextEntries?.length ?? 0) > 0;
    const hasComposerContent = hasText || hasImages || hasContextEntries;

    // Check if this is a Codex or Gemini session
    // Use metadata.flavor for existing sessions, agentType prop for new sessions
    const isRig = isRigMetadata(props.metadata);
    const isCodex = !isRig && (props.metadata?.flavor === 'codex' || props.agentType === 'codex');
    const isGemini = props.metadata?.flavor === 'gemini' || props.agentType === 'gemini';
    const displayPermissionMode = React.useMemo(() => (
        props.permissionMode ? hackMode(props.permissionMode) : null
    ), [props.permissionMode]);
    const permissionModeKey = displayPermissionMode?.key ?? 'default';
    // The chip is one word; the sandbox qualifier stays on the menu options and
    // the status badge, which both have room to spell it out.
    const permissionShortLabel = getPermissionModeShortLabel(displayPermissionMode);
    const showReadOnlyPermissionMode = props.permissionModeReadOnly === true && permissionShortLabel !== null;
    const availableModes = React.useMemo(() => (
        hackModes(props.availableModes ?? [])
    ), [props.availableModes]);
    const availableModels = props.availableModels ?? [];
    const availableEffortLevels = props.availableEffortLevels ?? [];
    const modelLabel = props.modelMode?.name ?? t('agentInput.model.title');
    const effortLabel = props.effortLevel?.name;
    const canOpenModelPicker = availableModels.length > 0 && !!props.onModelModeChange;
    const canOpenEffortPicker = availableEffortLevels.length > 0 && !!props.onEffortLevelChange;
    const isSandboxEnabled = React.useMemo(() => {
        const sandbox = props.metadata?.sandbox as unknown;
        if (!sandbox) {
            return false;
        }
        if (typeof sandbox === 'object' && sandbox !== null && 'enabled' in sandbox) {
            return Boolean((sandbox as { enabled?: unknown }).enabled);
        }
        return true;
    }, [props.metadata?.sandbox]);
    const isSandboxedYoloMode = isSandboxEnabled && (
        permissionModeKey === 'bypassPermissions' || permissionModeKey === 'yolo'
    );

    const withSandboxSuffix = React.useCallback((label: string, modeKey?: string) => {
        if (!isSandboxEnabled) {
            return label;
        }
        if (modeKey === 'bypassPermissions' || modeKey === 'yolo') {
            return `${label} (sandboxed)`;
        }
        return label;
    }, [isSandboxEnabled]);

    // Usage row under the card: week quota + context gauge
    const usageLimitShowRemaining = useSetting('usageLimitShowRemaining');
    const contextStatus = props.usageData?.contextSize
        ? getContextStatus(props.usageData.contextSize, props.alwaysShowContextSize ?? false, theme, props.usageData.contextWindow)
        : null;
    // Only Session and Week are user-meaningful; provider-internal windows
    // (nimbus_quill and friends) stay out of the popup.
    const usageRows = React.useMemo(() => {
        const rows = getUsageLimitRows(props.sessionStatusUsageLimits ?? null);
        const session = rows.find((row) => row.id === 'five_hour') ?? null;
        const week = rows.find((row) => row.id === 'seven_day') ?? null;
        return { session, week };
    }, [props.sessionStatusUsageLimits]);
    const weekPercent = usageRows.week?.utilization != null && (props.alwaysShowContextSize || contextStatus != null)
        ? getUsageLimitDisplayPercentage(usageRows.week.utilization, usageLimitShowRemaining)
        : null;
    const usageMenuOptions = React.useMemo<NativeSettingsMenuOption[]>(() => {
        const options: NativeSettingsMenuOption[] = [];
        const push = (key: string, label: string, row: { utilization: number | null; resetsAt: number | null } | null) => {
            if (!row || row.utilization == null) return;
            const percent = getUsageLimitDisplayPercentage(row.utilization, usageLimitShowRemaining);
            // The newline renders as a second line inside the native menu row.
            const reset = row.resetsAt != null
                ? `\n${t('agentInput.usagePopup.resets', { time: formatUsageLimitResetTime(row.resetsAt) })}`
                : '';
            options.push({ key, label: `${label} · ${Math.round(percent)}%${reset}` });
        };
        push('session', t('agentInput.usagePopup.session'), usageRows.session);
        push('week', t('agentInput.usagePopup.week'), usageRows.week);
        return options;
    }, [usageRows, usageLimitShowRemaining]);

    const agentInputEnterToSend = useSetting('agentInputEnterToSend');


    // Abort button state
    const [isAborting, setIsAborting] = React.useState(false);
    const [stopRequested, setStopRequested] = React.useState(false);
    const shakerRef = React.useRef<ShakeInstance>(null);
    const sendBlockShakerRef = React.useRef<ShakeInstance>(null);
    const inputRef = React.useRef<MultiTextInputHandle>(null);
    const primaryAction = resolveAgentInputPrimaryAction({
        hasComposerContent,
        isSendBlocked,
        isSendDisabled: props.isSendDisabled ?? false,
        showAbortButton: props.showAbortButton ?? false,
        canAbort: !!props.onAbort && !stopRequested,
        canVoice: !!props.onMicPress,
        dictationPhase: props.dictationPhase,
        canRetryVoice: !!props.onDictationRetry,
        voiceControlPlacement: 'dedicated',
    });
    const shouldShowStopButton = primaryAction === 'stop';
    const canSendMessage = primaryAction === 'send';
    const canPressSendButton = resolveAgentInputSendPressAvailability({
        isAborting,
        isSending: !!props.isSending,
        isSendDisabled: !!props.isSendDisabled,
    });
    const desktopCanPressSendButton = !compactMobileComposer && canPressSendButton;

    // A local acknowledgement avoids leaving Stop visible forever when the
    // session-status update arrives after the abort RPC has completed. The next
    // agent turn, or the eventual idle update, makes Stop eligible again.
    React.useEffect(() => {
        if (!props.showAbortButton) {
            setStopRequested(false);
        }
    }, [props.showAbortButton]);

    // Forward ref to the MultiTextInput
    React.useImperativeHandle(ref, () => inputRef.current!, []);

    // Web paste/drag — intercept image pastes and file drops for the
    // attachment feature. Both handlers funnel through props.onAddImages.
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !props.onAddImages) return;

        const handlePaste = async (e: ClipboardEvent) => {
            // Only handle pastes targeted at a focused text-editable element.
            // The listener is attached to document, so without this guard a
            // paste in the URL bar, another modal, or any focused-elsewhere
            // input would steal images intended for somewhere else.
            const active = document.activeElement;
            const isEditableTarget = active instanceof HTMLInputElement
                || active instanceof HTMLTextAreaElement
                || (active instanceof HTMLElement && active.isContentEditable);
            if (!isEditableTarget) return;

            const { getImagesFromClipboard, fileToAttachmentPreview } = await import('@/utils/pasteImages.web');
            const files = getImagesFromClipboard(e);
            if (!files.length) return;
            e.preventDefault();
            const previews = (await Promise.all(
                files.map((f) => fileToAttachmentPreview(f, generateThumbhash))
            )).filter(Boolean) as Omit<AttachmentPreview, 'id'>[];
            if (previews.length) {
                props.onAddImages!(previews.map((p) => ({
                    ...p,
                    id: `paste_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                })));
            }
        };

        // dragover must call preventDefault for drop to fire; we gate on
        // `types.includes('Files')` so we don't hijack drag-text/HTML in the
        // rest of the app.
        const isFileDrag = (e: DragEvent) => {
            const types = e.dataTransfer?.types;
            if (!types) return false;
            // DataTransferItemList vs DOMStringList — both expose .includes-ish.
            for (let i = 0; i < types.length; i++) {
                if (types[i] === 'Files') return true;
            }
            return false;
        };

        const handleDragOver = (e: DragEvent) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        };

        const handleDrop = async (e: DragEvent) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            const { getImagesFromDrop, fileToAttachmentPreview } = await import('@/utils/pasteImages.web');
            const files = getImagesFromDrop(e);
            if (!files.length) return;
            const previews = (await Promise.all(
                files.map((f) => fileToAttachmentPreview(f, generateThumbhash))
            )).filter(Boolean) as Omit<AttachmentPreview, 'id'>[];
            if (previews.length) {
                props.onAddImages!(previews.map((p) => ({
                    ...p,
                    id: `drop_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                })));
            }
        };

        document.addEventListener('paste', handlePaste as any);
        document.addEventListener('dragover', handleDragOver);
        document.addEventListener('drop', handleDrop);
        return () => {
            document.removeEventListener('paste', handlePaste as any);
            document.removeEventListener('dragover', handleDragOver);
            document.removeEventListener('drop', handleDrop);
        };
    }, [props.onAddImages]);

    // Autocomplete state — text + selection. Updated via startTransition so
    // typing renders the character immediately and the autocomplete pipeline
    // catches up on the next idle frame instead of blocking input.
    const [inputState, setInputState] = React.useState<TextInputState>(() => ({
        text: props.initialValue,
        selection: { start: props.initialValue.length, end: props.initialValue.length }
    }));

    const onActionAreaOffsetChange = props.onActionAreaOffsetChange;
    const handleActionAreaLayout = React.useCallback((event: LayoutChangeEvent) => {
        onActionAreaOffsetChange?.(CONTAINER_TOP_PADDING + event.nativeEvent.layout.y);
    }, [onActionAreaOffsetChange]);

    const onChangeTextProp = props.onChangeText;
    const handleTextChange = React.useCallback((text: string) => {
        React.startTransition(() => {
            setHasText(text.trim().length > 0);
        });
        onChangeTextProp?.(text);
    }, [onChangeTextProp]);

    const handleInputStateChange = React.useCallback((newState: TextInputState) => {
        React.startTransition(() => {
            setInputState(newState);
        });
    }, []);

    // Use the tracked selection from inputState
    const activeWord = useActiveWord(inputState.text, inputState.selection, props.autocompletePrefixes);
    // Using default options: clampSelection=true, autoSelectFirst=true, wrapAround=true
    // To customize: useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: false, wrapAround: false })
    const [suggestions, selected, moveUp, moveDown] = useActiveSuggestions(activeWord, props.autocompleteSuggestions, { clampSelection: true, wrapAround: true });

    // Debug logging
    // React.useEffect(() => {
    //     console.log('🔍 Autocomplete Debug:', JSON.stringify({
    //         value: props.value,
    //         inputState,
    //         activeWord,
    //         suggestionsCount: suggestions.length,
    //         selected,
    //         prefixes: props.autocompletePrefixes
    //     }, null, 2));
    // }, [props.value, inputState, activeWord, suggestions.length, selected]);

    // Handle suggestion selection
    const handleSuggestionSelect = React.useCallback((index: number) => {
        if (!suggestions[index] || !inputRef.current) return;

        const suggestion = suggestions[index];

        // Apply the suggestion
        const result = applySuggestion(
            inputState.text,
            inputState.selection,
            suggestion.text,
            props.autocompletePrefixes,
            true // add space after
        );

        // Use imperative API to set text and selection
        inputRef.current.setTextAndSelection(result.text, {
            start: result.cursorPosition,
            end: result.cursorPosition
        });

        // console.log('Selected suggestion:', suggestion.text);

        // Small haptic feedback
        hapticsLight();
    }, [suggestions, inputState, props.autocompletePrefixes]);

    // The compact composer has separate controls for permission, model, and
    // effort. Keep a single popup state so only one selection surface is ever
    // visible, including while we dismiss the keyboard on mobile.
    type ComposerPicker = 'permission' | 'model' | 'effort';
    const [openPicker, setOpenPicker] = React.useState<ComposerPicker | null>(null);
    const [webActionMenuOpen, setWebActionMenuOpen] = React.useState(false);
    const [webAttachmentMenuOpen, setWebAttachmentMenuOpen] = React.useState(false);
    const [webAttachmentMenuAnchor, setWebAttachmentMenuAnchor] = React.useState<AttachmentInputMenuAnchor>({
        x: 12,
        y: Math.max(12, screenHeight - 52),
        width: 32,
        height: 32,
    });
    const webAttachmentActionRef = React.useRef<View>(null);
    const pickerOpeningRef = React.useRef<ComposerPicker | null>(null);
    const pickerKeyboardSubscriptionRef = React.useRef<ReturnType<typeof Keyboard.addListener> | null>(null);
    const pickerOpenTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelPendingPickerOpen = React.useCallback(() => {
        pickerOpeningRef.current = null;
        pickerKeyboardSubscriptionRef.current?.remove();
        pickerKeyboardSubscriptionRef.current = null;
        if (pickerOpenTimerRef.current) {
            clearTimeout(pickerOpenTimerRef.current);
            pickerOpenTimerRef.current = null;
        }
    }, []);

    const closePicker = React.useCallback(() => {
        cancelPendingPickerOpen();
        setOpenPicker(null);
    }, [cancelPendingPickerOpen]);

    const closeWebActionMenu = React.useCallback(() => {
        setWebActionMenuOpen(false);
    }, []);

    const closeWebAttachmentMenu = React.useCallback(() => {
        setWebAttachmentMenuOpen(false);
    }, []);

    const openWebAttachmentMenu = React.useCallback(() => {
        setWebAttachmentMenuOpen(true);
        webAttachmentActionRef.current?.measureInWindow((x, y, width, height) => {
            setWebAttachmentMenuAnchor({ x, y, width, height });
        });
    }, []);

    React.useEffect(() => cancelPendingPickerOpen, [cancelPendingPickerOpen]);

    const handlePickerPress = React.useCallback((picker: ComposerPicker) => {
        hapticsLight();
        if (openPicker === picker || pickerOpeningRef.current === picker) {
            closePicker();
            return;
        }

        closePicker();
        if (Platform.OS === 'web' || !Keyboard.isVisible()) {
            setOpenPicker(picker);
            return;
        }

        pickerOpeningRef.current = picker;
        const finishOpening = () => {
            const pickerToOpen = pickerOpeningRef.current;
            cancelPendingPickerOpen();
            if (pickerToOpen) {
                setOpenPicker(pickerToOpen);
            }
        };
        pickerKeyboardSubscriptionRef.current = Keyboard.addListener('keyboardDidHide', finishOpening);
        pickerOpenTimerRef.current = setTimeout(finishOpening, 420);
        inputRef.current?.blur();
        Keyboard.dismiss();
    }, [cancelPendingPickerOpen, closePicker, openPicker]);

    const handleSettingsPress = React.useCallback(() => {
        handlePickerPress('permission');
    }, [handlePickerPress]);

    const handleWebActionMenuPress = React.useCallback(() => {
        hapticsLight();
        closePicker();
        closeWebAttachmentMenu();
        setWebActionMenuOpen((visible) => !visible);
    }, [closePicker, closeWebAttachmentMenu]);

    React.useEffect(() => {
        closeWebActionMenu();
        closeWebAttachmentMenu();
    }, [closeWebActionMenu, closeWebAttachmentMenu, props.sessionId]);

    React.useEffect(() => {
        if (
            !webActionMenu
            || !props.splitWebAttachmentActions
            || screenWidth > 700
            || !props.onPickImages
            || !props.onPickDeviceFiles
        ) closeWebAttachmentMenu();
    }, [closeWebAttachmentMenu, props.onPickDeviceFiles, props.onPickImages, props.splitWebAttachmentActions, screenWidth, webActionMenu]);

    const handleModelPress = React.useCallback(() => {
        if (!canOpenModelPicker) return;
        handlePickerPress('model');
    }, [canOpenModelPicker, handlePickerPress]);

    const handleEffortPress = React.useCallback(() => {
        if (!canOpenEffortPicker) return;
        handlePickerPress('effort');
    }, [canOpenEffortPicker, handlePickerPress]);

    // Handle settings selection
    const handleSettingsSelect = React.useCallback((mode: PermissionMode) => {
        hapticsLight();
        props.onPermissionModeChange?.(mode);
        closePicker();
    }, [closePicker, props.onPermissionModeChange]);

    // Handle abort button press
    const handleAbortPress = React.useCallback(async () => {
        if (!props.onAbort) return;

        hapticsError();
        setStopRequested(true);
        setIsAborting(true);
        const startTime = Date.now();

        try {
            await props.onAbort?.();

            // Ensure minimum 300ms loading time
            const elapsed = Date.now() - startTime;
            if (elapsed < 300) {
                await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
            }
        } catch (error) {
            // Shake on error
            setStopRequested(false);
            shakerRef.current?.shake();
            console.error('Abort RPC call failed:', error);
        } finally {
            setIsAborting(false);
        }
    }, [props.onAbort]);

    const handleBlockedSendAttempt = React.useCallback(() => {
        if (!isSendBlocked || !hasComposerContent || props.isSending) return;
        hapticsError();
        sendBlockShakerRef.current?.shake();
    }, [hasComposerContent, isSendBlocked, props.isSending]);

    const handleMicrophonePress = React.useCallback(() => {
        if (props.dictationPhase === 'transcribing') return;
        if (props.dictationPhase !== 'recording' && props.isSendDisabled) return;
        hapticsLight();
        props.onMicPress?.();
    }, [props.dictationPhase, props.isSendDisabled, props.onMicPress]);

    const handleSendPress = React.useCallback(() => {
        const liveHasContent = (inputRef.current?.getText() ?? '').trim().length > 0
            || hasImages
            || hasContextEntries;
        if (isSendBlocked) {
            handleBlockedSendAttempt();
            return;
        }
        if (props.isSendDisabled || (!compactMobileComposer && props.isSending)) return;

        // Live read avoids stalling behind the transitioned `hasText`.
        if (liveHasContent) {
            hapticsLight();
            setStopRequested(false);
            props.onSend();
        }
    }, [handleBlockedSendAttempt, hasContextEntries, hasImages, isSendBlocked, props.isSendDisabled, props.isSending, props.onSend]);

    // Mobile keeps Stop separate while Send remains a send-only control.
    // Live text is still read on press because transitioned `hasText` can lag
    // a fast type-then-tap.
    const handleMobilePrimaryPress = React.useCallback(() => {
        handleSendPress();
    }, [handleSendPress]);

    const permissionSettingsGroups = React.useMemo<NativeSettingsMenuGroup[]>(() => {
        if (!props.onPermissionModeChange || availableModes.length === 0) {
            return [];
        }
        return [{
            key: 'permission',
            label: isCodex
                ? t('agentInput.codexPermissionMode.title')
                : isGemini
                    ? t('agentInput.geminiPermissionMode.title')
                    : t('agentInput.permissionMode.title'),
            systemImage: 'shield',
            options: availableModes.map((mode) => ({
                key: mode.key,
                label: withSandboxSuffix(getPermissionModeMenuLabel(mode), mode.key),
                disabled: mode.disabled,
            })),
            selectedKey: permissionModeKey,
            onSelect: (key) => {
                const mode = availableModes.find((candidate) => candidate.key === key);
                if (mode) handleSettingsSelect(mode);
            },
        }];
    }, [availableModes, handleSettingsSelect, isCodex, isGemini, permissionModeKey, props.onPermissionModeChange, withSandboxSuffix]);

    const modelSettingsGroups = React.useMemo<NativeSettingsMenuGroup[]>(() => {
        const groups: NativeSettingsMenuGroup[] = [];
        if (availableModels.length > 0 && props.onModelModeChange) {
            groups.push({
                key: 'model',
                label: props.modelMode?.name ?? t('agentInput.model.title'),
                title: t('agentInput.model.title'),
                systemImage: 'cube',
                options: availableModels.map((model) => ({ key: model.key, label: model.name, disabled: model.disabled })),
                selectedKey: props.modelMode?.key,
                onSelect: (key) => {
                    const model = availableModels.find((candidate) => candidate.key === key);
                    if (!model) return;
                    hapticsLight();
                    props.onModelModeChange?.(model);
                },
            });
        }
        if (availableEffortLevels.length > 0 && props.onEffortLevelChange) {
            groups.push({
                key: 'effort',
                label: props.effortLevel?.name ?? t('agentInput.effort.title'),
                title: t('agentInput.effort.title'),
                systemImage: 'bolt',
                options: availableEffortLevels.map((level) => ({ key: level.key, label: level.name, disabled: level.disabled })),
                selectedKey: props.effortLevel?.key,
                onSelect: (key) => {
                    const level = availableEffortLevels.find((candidate) => candidate.key === key);
                    if (!level) return;
                    hapticsLight();
                    props.onEffortLevelChange?.(level);
                },
            });
        }
        return groups;
    }, [availableEffortLevels, availableModels, props.effortLevel?.key, props.modelMode?.key, props.onEffortLevelChange, props.onModelModeChange]);

    const modelSettingsGroup = modelSettingsGroups.find((group) => group.key === 'model');
    const effortSettingsGroup = modelSettingsGroups.find((group) => group.key === 'effort');
    const showPermissionSettingsSection = !webActionMenu || permissionSettingsGroups.length > 0;
    const showModelSettingsSection = !webActionMenu || Boolean(modelSettingsGroup);
    const showEffortSettingsSection = Boolean(effortSettingsGroup);

    const webComposerActions = React.useMemo(() => {
        const workspace = props.webWorkspaceActions;
        const actions: Array<{
            key: string;
            label: string;
            icon: React.ComponentProps<typeof Ionicons>['name'];
            onPress: () => void;
            disabled?: boolean;
            destructive?: boolean;
        }> = [];

        if (workspace) {
            actions.push({
                key: 'changes',
                label: t('files.changes'),
                icon: 'git-compare-outline',
                onPress: workspace.onOpenChanges,
            }, {
                key: 'workspace',
                label: t('workspace.title'),
                icon: 'desktop-outline',
                onPress: workspace.onOpenWorkspace,
            });
        }

        if (permissionSettingsGroups.length > 0 || modelSettingsGroups.length > 0) {
            actions.push({
                key: 'settings',
                label: t('settings.title'),
                icon: 'settings-outline',
                onPress: handleSettingsPress,
            });
        }
        if (shouldShowStopButton && props.onAbort) {
            actions.push({
                key: 'stop',
                label: t('happyHerd.composer.stop'),
                icon: 'stop-circle-outline',
                onPress: () => void handleAbortPress(),
                disabled: isAborting,
                destructive: true,
            });
        }
        if (props.onQueueMessage) {
            actions.push({
                key: 'queue',
                label: t('happyHerd.composer.queueMessage'),
                icon: 'list-outline',
                onPress: props.onQueueMessage,
                disabled: !hasComposerContent || props.isSendDisabled,
            });
        }
        const groupedAttachments = props.splitWebAttachmentActions
            && screenWidth <= 700
            && props.onPickImages
            && props.onPickDeviceFiles;
        if (props.onPickImages) {
            actions.push({
                key: groupedAttachments || !props.splitWebAttachmentActions ? 'attachments' : 'photos',
                label: groupedAttachments || !props.splitWebAttachmentActions
                    ? t('happyHerd.composer.attachments')
                    : t('happyHerd.composer.photos'),
                icon: 'images-outline',
                onPress: groupedAttachments ? openWebAttachmentMenu : props.onPickImages,
            });
        }
        if (props.splitWebAttachmentActions && !groupedAttachments && props.onPickDeviceFiles) {
            actions.push({
                key: 'device-files',
                label: t('happyHerd.composer.deviceFiles'),
                icon: 'document-outline',
                onPress: props.onPickDeviceFiles,
            });
        }
        return actions;
    }, [handleAbortPress, handleSettingsPress, hasComposerContent, isAborting, modelSettingsGroups.length, openWebAttachmentMenu, permissionSettingsGroups.length, props.isSendDisabled, props.webWorkspaceActions, props.onAbort, props.onPickDeviceFiles, props.onPickImages, props.onQueueMessage, props.splitWebAttachmentActions, screenWidth, shouldShowStopButton]);

    const invokeWebComposerAction = React.useCallback((action: (typeof webComposerActions)[number]) => {
        if (action.disabled) return;
        closeWebActionMenu();
        hapticsLight();
        action.onPress();
    }, [closeWebActionMenu]);

    const renderModelValue = () => (
        <Text style={styles.mobileModeText} numberOfLines={1}>
            {modelLabel}
        </Text>
    );

    const renderEffortValue = () => (
        <Text style={styles.mobileModeText} numberOfLines={1}>
            {effortLabel ?? t('agentInput.effort.title')}
        </Text>
    );

    // A session started in a mode this build no longer offers resolves to no
    // mode at all. Falling back to the shield keeps the picker reachable rather
    // than inventing a word for a state we cannot name.
    const renderPermissionValue = () => (permissionShortLabel ? (
        <Text style={styles.mobileModeText} numberOfLines={1}>
            {permissionShortLabel}
        </Text>
    ) : (
        <Ionicons name="shield-outline" size={18} color={theme.colors.text} />
    ));

    const renderReadOnlyPermissionMode = () => (
        <View
            accessibilityLabel={`${t('agentInput.permissionMode.title')}: ${permissionShortLabel}`}
            accessibilityRole="text"
            style={styles.mobilePermissionButton}
            testID="composer-permission-mode-readonly"
        >
            {renderPermissionValue()}
        </View>
    );

    // Handle keyboard navigation
    const handleKeyPress = React.useCallback((event: KeyPressEvent): boolean => {
        // Handle autocomplete navigation first
        if (suggestions.length > 0) {
            if (event.key === 'ArrowUp') {
                moveUp();
                return true;
            } else if (event.key === 'ArrowDown') {
                moveDown();
                return true;
            } else if ((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
                // Both Enter and Tab select the current suggestion
                // If none selected (selected === -1), select the first one
                const indexToSelect = selected >= 0 ? selected : 0;
                handleSuggestionSelect(indexToSelect);
                return true;
            } else if (event.key === 'Escape') {
                // Clear suggestions by collapsing selection (triggers activeWord to clear)
                if (inputRef.current) {
                    const cursorPos = inputState.selection.start;
                    inputRef.current.setTextAndSelection(inputState.text, {
                        start: cursorPos,
                        end: cursorPos
                    });
                }
                return true;
            }
        }

        // Handle Escape for abort when no suggestions are visible
        if (event.key === 'Escape' && props.showAbortButton && props.onAbort && !isAborting) {
            handleAbortPress();
            return true;
        }

        // Original key handling
        if (Platform.OS === 'web') {
            // On mobile web (touch devices), Enter should insert a newline since
            // there's no Shift key available. Users send via the send button instead.
            // Use pointer:coarse media query instead of ontouchstart/maxTouchPoints
            // to avoid false positives on Windows touch-screen laptops with keyboards.
            const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
            if (agentInputEnterToSend && event.key === 'Enter' && !event.shiftKey && !isTouchDevice) {
                // Read live text from the textarea — `hasText` is debounced via
                // startTransition and would lag behind a quick type-then-Enter.
                const liveText = inputRef.current?.getText() ?? '';
                if (liveText.trim()) {
                    if (isSendBlocked) {
                        handleBlockedSendAttempt();
                    } else if (!props.isSendDisabled) {
                        props.onSend();
                    }
                    return true; // Key was handled
                }
            }
            // Handle Shift+Tab for permission mode switching
            if (event.key === 'Tab' && event.shiftKey && props.onPermissionModeChange && availableModes.length > 0) {
                const currentIndex = availableModes.findIndex((mode) => mode.key === permissionModeKey);
                const nextIndex = ((currentIndex >= 0 ? currentIndex : 0) + 1) % availableModes.length;
                props.onPermissionModeChange(availableModes[nextIndex]);
                hapticsLight();
                return true; // Key was handled, prevent default tab behavior
            }

        }
        return false; // Key was not handled
    }, [suggestions, moveUp, moveDown, selected, handleSuggestionSelect, props.showAbortButton, props.onAbort, isAborting, handleAbortPress, agentInputEnterToSend, props.onSend, props.onPermissionModeChange, availableModes, permissionModeKey, isSendBlocked, handleBlockedSendAttempt, props.isSendDisabled]);

    const desktopActionControls = (
        <View style={styles.actionButtonsContainer}>
            <View style={{ flexDirection: 'column', flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    {props.zenMode && !webActionMenu && <View style={{ flex: 1 }} />}
                    {(!props.zenMode || webActionMenu) && <View style={styles.actionButtonsLeft}>
                        {webActionMenu ? (
                            <>
                                <BubblePressable
                                    accessibilityLabel={t('happyHerd.composer.moreActions')}
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded: webActionMenuOpen }}
                                    hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                    onPress={handleWebActionMenuPress}
                                    style={(pressedState) => [
                                        styles.mobileActionsTrigger,
                                        pressedState.pressed && { opacity: 0.7 },
                                    ]}
                                    testID="mobile-composer-actions-trigger"
                                >
                                    <Octicons
                                        name="plus"
                                        size={20}
                                        color={(props.selectedImages?.length ?? 0) > 0 || hasContextEntries
                                            ? theme.colors.radio.active
                                            : theme.colors.button.secondary.tint}
                                    />
                                </BubblePressable>
                                {showReadOnlyPermissionMode && renderReadOnlyPermissionMode()}
                            </>
                        ) : (
                            <>
                        {props.onPermissionModeChange && (
                            useNativeSettingsMenus ? (
                                <NativeSettingsMenu
                                    accessibilityLabel={t('settings.title')}
                                    groups={[...permissionSettingsGroups, ...modelSettingsGroups]}
                                    style={{ width: 40, height: 40 }}
                                >
                                    <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                                        <Octicons name="gear" size={16} color={theme.colors.button.secondary.tint} />
                                    </View>
                                </NativeSettingsMenu>
                            ) : (
                                <Pressable
                                    onPress={handleSettingsPress}
                                    hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                    style={(p) => ({
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        borderRadius: Platform.select({ default: 16, android: 20 }),
                                        paddingHorizontal: 8,
                                        paddingVertical: 6,
                                        justifyContent: 'center',
                                        height: 32,
                                        opacity: p.pressed ? 0.7 : 1,
                                    })}
                                >
                                    <Octicons name="gear" size={16} color={theme.colors.button.secondary.tint} />
                                </Pressable>
                            )
                        )}

                        {showReadOnlyPermissionMode && renderReadOnlyPermissionMode()}

                        {props.agentType && props.onAgentClick && (
                            <Pressable
                                onPress={() => {
                                    hapticsLight();
                                    props.onAgentClick?.();
                                }}
                                hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                style={(p) => ({
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    borderRadius: Platform.select({ default: 16, android: 20 }),
                                    paddingHorizontal: 10,
                                    paddingVertical: 6,
                                    justifyContent: 'center',
                                    height: 32,
                                    opacity: p.pressed ? 0.7 : 1,
                                    gap: 6,
                                })}
                            >
                                <Octicons name="cpu" size={14} color={theme.colors.button.secondary.tint} />
                                <Text style={{
                                    fontSize: 13,
                                    color: theme.colors.button.secondary.tint,
                                    fontWeight: '600',
                                    ...Typography.default('semiBold'),
                                }}>
                                    {props.agentType === 'claude'
                                        ? t('agentInput.agent.claude')
                                        : props.agentType === 'codex'
                                            ? t('agentInput.agent.codex')
                                            : props.agentType === 'grok'
                                                ? t('agentInput.agent.grok')
                                            : props.agentType === 'dsh'
                                                ? t('agentInput.agent.dsh')
                                            : t('agentInput.agent.gemini')}
                                </Text>
                            </Pressable>
                        )}

                        {props.onAbort && (
                            <Shaker ref={shakerRef}>
                                <Pressable
                                    style={(p) => ({
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        borderRadius: Platform.select({ default: 16, android: 20 }),
                                        paddingHorizontal: 8,
                                        paddingVertical: 6,
                                        justifyContent: 'center',
                                        height: 32,
                                        opacity: p.pressed ? 0.7 : 1,
                                    })}
                                    hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                    onPress={handleAbortPress}
                                    disabled={isAborting}
                                >
                                    {isAborting ? (
                                        <ActivityIndicator size="small" color={theme.colors.button.secondary.tint} />
                                    ) : (
                                        <Octicons name="stop" size={16} color={theme.colors.button.secondary.tint} />
                                    )}
                                </Pressable>
                            </Shaker>
                        )}

                        {props.onQueueMessage && (
                            <Pressable
                                onPress={props.onQueueMessage}
                                disabled={!hasComposerContent || props.isSendDisabled}
                                hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                style={(pressedState) => ({
                                    minHeight: 32,
                                    justifyContent: 'center',
                                    paddingHorizontal: 8,
                                    opacity: !hasComposerContent || props.isSendDisabled
                                        ? 0.42
                                        : pressedState.pressed ? 0.7 : 1,
                                })}
                                accessibilityRole="button"
                                accessibilityLabel={t('happyHerd.composer.queueMessage')}
                            >
                                <Text style={{
                                    color: theme.colors.button.secondary.tint,
                                    fontSize: 13,
                                    ...Typography.default('semiBold'),
                                }}>
                                    {t('happyHerd.composer.queueMessage')}
                                </Text>
                            </Pressable>
                        )}

                        {(props.onPickImages || props.onPickDeviceFiles) && (
                            <AttachmentInputButton
                                onPickPhotos={props.onPickImages}
                                onPickDeviceFiles={props.onPickDeviceFiles}
                                active={(props.selectedImages?.length ?? 0) > 0 || hasContextEntries}
                                color={theme.colors.button.secondary.tint}
                                activeColor={theme.colors.radio.active}
                                size={16}
                                hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                                style={(p) => ({
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    borderRadius: Platform.select({ default: 16, android: 20 }),
                                    paddingHorizontal: 8,
                                    paddingVertical: 6,
                                    justifyContent: 'center',
                                    height: 32,
                                    opacity: p.pressed ? 0.7 : 1,
                                })}
                            />
                        )}
                            </>
                        )}
                    </View>}

                    <VoiceDictationControls
                        phase={props.dictationPhase ?? 'idle'}
                        onPress={props.onMicPress ? handleMicrophonePress : undefined}
                        onCancel={props.onDictationCancel}
                        onRetry={props.onDictationRetry}
                        disabled={!!props.isSendDisabled || !!props.isSending}
                    />

                    <View
                        style={[
                            styles.sendButton,
                            primaryAction === 'blocked'
                                ? styles.sendButtonLocked
                                : (hasComposerContent || props.isSending)
                                    ? styles.sendButtonActive
                                    : styles.sendButtonInactive,
                        ]}
                    >
                        <Pressable
                            style={(p) => ({
                                width: '100%',
                                height: '100%',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: p.pressed ? 0.7 : 1,
                            })}
                            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
                            onPress={handleSendPress}
                            disabled={!desktopCanPressSendButton}
                            accessibilityRole="button"
                            accessibilityLabel={t('happyHerd.composer.send')}
                        >
                            {props.isSending ? (
                                <ActivityIndicator size="small" color={theme.colors.button.primary.tint} />
                            ) : primaryAction === 'blocked' ? (
                                <Ionicons name="lock-closed" size={15} color={theme.colors.textSecondary} />
                            ) : (
                                <Octicons
                                    name="arrow-up"
                                    size={16}
                                    color={theme.colors.button.primary.tint}
                                    style={[styles.sendButtonIcon, { marginTop: Platform.OS === 'web' ? 2 : 0 }]}
                                />
                            )}
                        </Pressable>
                    </View>
                </View>
            </View>
        </View>
    );

    const renderDesktopPickerOption = (
        key: string,
        selected: boolean,
        label: string,
        description: string | null | undefined,
        onPress: () => void,
    ) => (
        <Pressable
            key={key}
            onPress={onPress}
            style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'flex-start',
                paddingHorizontal: 16,
                paddingVertical: 8,
                backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
            })}
        >
            <View style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                borderWidth: 2,
                borderColor: selected ? theme.colors.radio.active : theme.colors.radio.inactive,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
                marginTop: 2,
            }}>
                {selected && <View style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: theme.colors.radio.dot,
                }} />}
            </View>
            <View style={{ flex: 1 }}>
                <Text style={{
                    fontSize: 14,
                    color: selected ? theme.colors.radio.active : theme.colors.text,
                    ...Typography.default(),
                }}>
                    {label}
                </Text>
                {!!description && (
                    <Text style={{
                        fontSize: 11,
                        color: theme.colors.textSecondary,
                        ...Typography.default(),
                    }}>
                        {description}
                    </Text>
                )}
            </View>
        </Pressable>
    );

    const desktopSettingsOverlay = !useNativeSettingsMenus && !compactMobileComposer && openPicker === 'permission' ? (
        <>
            <TouchableWithoutFeedback onPress={closePicker}>
                <View style={styles.overlayBackdrop} />
            </TouchableWithoutFeedback>
            <View style={[
                styles.settingsOverlay,
                { paddingHorizontal: screenWidth > 700 ? 0 : 8 },
            ]}>
                <FloatingOverlay maxHeight={400} keyboardShouldPersistTaps="always">
                    {showPermissionSettingsSection && (
                        <View style={styles.overlaySection}>
                            <Text style={styles.overlaySectionTitle}>
                                {isCodex
                                    ? t('agentInput.codexPermissionMode.title')
                                    : isGemini
                                        ? t('agentInput.geminiPermissionMode.title')
                                        : t('agentInput.permissionMode.title')}
                            </Text>
                            {availableModes.map((mode) => renderDesktopPickerOption(
                                mode.key,
                                permissionModeKey === mode.key,
                                withSandboxSuffix(mode.name, mode.key),
                                mode.description,
                                () => handleSettingsSelect(mode),
                            ))}
                        </View>
                    )}

                    {showPermissionSettingsSection && (showModelSettingsSection || showEffortSettingsSection) && (
                        <View style={{ height: 1, backgroundColor: theme.colors.divider, marginHorizontal: 16 }} />
                    )}

                    {(showModelSettingsSection || showEffortSettingsSection) && (
                        <View style={{ flexDirection: 'row' }}>
                            {showModelSettingsSection && (
                                <View style={{ paddingVertical: 8, flex: 1 }}>
                                    <Text style={{
                                        fontSize: 12,
                                        fontWeight: '600',
                                        color: theme.colors.textSecondary,
                                        paddingHorizontal: 16,
                                        paddingBottom: 4,
                                        ...Typography.default('semiBold'),
                                    }}>
                                        {t('agentInput.model.title')}
                                    </Text>
                                    {availableModels.length > 0 ? availableModels.map((model) => renderDesktopPickerOption(
                                        model.key,
                                        props.modelMode?.key === model.key,
                                        model.name,
                                        model.description,
                                        () => {
                                            hapticsLight();
                                            props.onModelModeChange?.(model);
                                            closePicker();
                                        },
                                    )) : (
                                        <Text style={{
                                            fontSize: 13,
                                            color: theme.colors.textSecondary,
                                            paddingHorizontal: 16,
                                            paddingVertical: 8,
                                            ...Typography.default(),
                                        }}>
                                            {t('agentInput.model.configureInCli')}
                                        </Text>
                                    )}
                                </View>
                            )}

                            {showModelSettingsSection && showEffortSettingsSection && (
                                <View style={{ width: 1, backgroundColor: theme.colors.divider, marginVertical: 8 }} />
                            )}

                            {showEffortSettingsSection && (
                                <View style={{ paddingVertical: 8, flex: 1 }}>
                                    <Text style={{
                                        fontSize: 12,
                                        fontWeight: '600',
                                        color: theme.colors.textSecondary,
                                        paddingHorizontal: 16,
                                        paddingBottom: 4,
                                        ...Typography.default('semiBold'),
                                    }}>
                                        {t('agentInput.effort.title')}
                                    </Text>
                                    {availableEffortLevels.map((level) => renderDesktopPickerOption(
                                        level.key,
                                        props.effortLevel?.key === level.key,
                                        level.name,
                                        level.description,
                                        () => {
                                            hapticsLight();
                                            props.onEffortLevelChange?.(level);
                                            closePicker();
                                        },
                                    ))}
                                </View>
                            )}
                        </View>
                    )}
                </FloatingOverlay>
            </View>
        </>
    ) : null;




    return (
        <View style={[
            styles.container,
            { paddingHorizontal: screenWidth > 700 ? 12 : 8 }
        ]}>
            <View style={[
                styles.innerContainer,
                { maxWidth: layout.maxWidth }
            ]}>
                {/* Autocomplete suggestions overlay */}
                {suggestions.length > 0 && (
                    <View style={[
                        styles.autocompleteOverlay,
                        { paddingHorizontal: screenWidth > 700 ? 0 : 8 }
                    ]}>
                        <AgentInputAutocomplete
                            suggestions={suggestions.map(s => {
                                const Component = s.component;
                                return <Component key={s.key} />;
                            })}
                            selectedIndex={selected}
                            onSelect={handleSuggestionSelect}
                            itemHeight={48}
                        />
                    </View>
                )}

                {webActionMenu && webActionMenuOpen && (
                    <>
                        <AnimatedClickAwayBackdrop
                            onPress={closeWebActionMenu}
                            style={styles.overlayBackdrop}
                        />
                        <View style={styles.mobileActionsOverlay}>
                            <FloatingOverlay
                                maxHeight={Math.max(160, Math.min(520, screenHeight - 180))}
                                showScrollIndicator
                                keyboardShouldPersistTaps="always"
                            >
                                <View
                                    accessibilityLabel={t('happyHerd.composer.moreActions')}
                                    accessibilityRole="menu"
                                    style={styles.mobileActionsMenu}
                                    testID="mobile-composer-actions-menu"
                                >
                                    {webComposerActions.map((action) => (
                                        <Pressable
                                            key={action.key}
                                            ref={action.key === 'attachments' && props.splitWebAttachmentActions && screenWidth <= 700
                                                ? webAttachmentActionRef
                                                : undefined}
                                            accessibilityLabel={action.label}
                                            accessibilityRole="menuitem"
                                            accessibilityState={{
                                                disabled: action.disabled,
                                                expanded: action.key === 'attachments'
                                                    && props.splitWebAttachmentActions
                                                    && screenWidth <= 700
                                                    ? webAttachmentMenuOpen
                                                    : undefined,
                                            }}
                                            disabled={action.disabled}
                                            onPress={() => invokeWebComposerAction(action)}
                                            style={({ pressed }) => [
                                                styles.mobileActionsRow,
                                                pressed && styles.mobileActionsRowPressed,
                                                action.disabled && styles.mobileActionsRowDisabled,
                                            ]}
                                            testID={`mobile-composer-action-${action.key}`}
                                        >
                                            <Ionicons
                                                name={action.icon}
                                                size={20}
                                                color={action.destructive
                                                    ? theme.colors.textDestructive
                                                    : theme.colors.text}
                                            />
                                            <Text style={[
                                                styles.mobileActionsLabel,
                                                action.destructive && styles.mobileActionsDestructiveLabel,
                                            ]}>
                                                {action.label}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </View>
                            </FloatingOverlay>
                        </View>
                    </>
                )}

                {webActionMenu
                    && props.splitWebAttachmentActions
                    && screenWidth <= 700
                    && props.onPickImages
                    && props.onPickDeviceFiles && (
                    <AttachmentInputMenu
                        anchor={webAttachmentMenuAnchor}
                        onClose={closeWebAttachmentMenu}
                        onPickDeviceFiles={props.onPickDeviceFiles}
                        onPickPhotos={props.onPickImages}
                        visible={webAttachmentMenuOpen}
                    />
                )}

                {desktopSettingsOverlay}

                {/* Permission, model, and effort pickers open independently
                    from their matching controls in the compact composer action row. */}
                {compactMobileComposer && !useNativeSettingsMenus && openPicker && (
                    <>
                        <AnimatedClickAwayBackdrop
                            onPress={closePicker}
                            style={styles.overlayBackdrop}
                        />
                        <View style={[
                            styles.settingsOverlay,
                            { paddingHorizontal: screenWidth > 700 ? 0 : 16 }
                        ]}>
                            <FloatingOverlay maxHeight={400} keyboardShouldPersistTaps="always">
                                {openPicker === 'permission' ? (
                                    <View style={styles.overlaySection}>
                                        <Text style={styles.overlaySectionTitle}>
                                            {isCodex ? t('agentInput.codexPermissionMode.title') : isGemini ? t('agentInput.geminiPermissionMode.title') : t('agentInput.permissionMode.title')}
                                        </Text>
                                        {availableModes.map((mode) => {
                                            const isSelected = permissionModeKey === mode.key;
                                            return (
                                                <BubblePressable
                                                    key={mode.key}
                                                    disabled={!props.onPermissionModeChange || mode.disabled}
                                                    onPress={() => handleSettingsSelect(mode)}
                                                    style={({ pressed }) => ({
                                                        flexDirection: 'row',
                                                        alignItems: 'flex-start',
                                                        paddingHorizontal: 16,
                                                        paddingVertical: 8,
                                                        marginHorizontal: 8,
                                                        borderRadius: 14,
                                                        backgroundColor: pressed
                                                            ? theme.colors.surfacePressedOverlay
                                                            : isSelected
                                                                ? theme.colors.glass.backgroundSubtle
                                                                : 'transparent',
                                                        opacity: (!props.onPermissionModeChange || mode.disabled) ? 0.55 : 1,
                                                    })}
                                                >
                                                    <View style={{
                                                        width: 16,
                                                        height: 16,
                                                        borderRadius: 8,
                                                        borderWidth: 2,
                                                        borderColor: isSelected ? theme.colors.radio.active : theme.colors.radio.inactive,
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        marginRight: 12,
                                                        marginTop: 2,
                                                    }}>
                                                        {isSelected && <View style={{
                                                            width: 6,
                                                            height: 6,
                                                            borderRadius: 3,
                                                            backgroundColor: theme.colors.radio.dot,
                                                        }} />}
                                                    </View>
                                                    <View style={{ flex: 1 }}>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                                            {mode.semanticKind && (
                                                                <Ionicons
                                                                    name={permissionKindIcon(mode.semanticKind)}
                                                                    size={13}
                                                                    color={isSelected ? theme.colors.radio.active : theme.colors.textSecondary}
                                                                />
                                                            )}
                                                            <Text style={{
                                                                fontSize: 14,
                                                                color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                                                ...Typography.default(),
                                                            }}>
                                                                {withSandboxSuffix(mode.name, mode.key)}
                                                            </Text>
                                                        </View>
                                                        {!!mode.description && (
                                                            <Text style={{
                                                                fontSize: 11,
                                                                color: theme.colors.textSecondary,
                                                                ...Typography.default(),
                                                            }}>
                                                                {mode.description}
                                                            </Text>
                                                        )}
                                                    </View>
                                                </BubblePressable>
                                            );
                                        })}
                                    </View>
                                ) : (
                                    <>
                                        {openPicker === 'model' && (
                                        <View style={styles.overlaySection}>
                                            <Text style={styles.overlaySectionTitle}>
                                                {props.modelMode?.name ?? t('agentInput.model.title')}
                                            </Text>
                                            {availableModels.length > 0 ? availableModels.map((model) => {
                                                const isSelected = props.modelMode?.key === model.key;
                                                return (
                                                    <BubblePressable
                                                        key={model.key}
                                                        disabled={!props.onModelModeChange || model.disabled}
                                                        onPress={() => {
                                                            hapticsLight();
                                                            props.onModelModeChange?.(model);
                                                            closePicker();
                                                        }}
                                                        style={({ pressed }) => ({
                                                            flexDirection: 'row',
                                                            alignItems: 'flex-start',
                                                            paddingHorizontal: 16,
                                                            paddingVertical: 8,
                                                            marginHorizontal: 8,
                                                            borderRadius: 14,
                                                            backgroundColor: pressed
                                                                ? theme.colors.surfacePressedOverlay
                                                                : isSelected
                                                                    ? theme.colors.glass.backgroundSubtle
                                                                    : 'transparent',
                                                            opacity: (!props.onModelModeChange || model.disabled) ? 0.55 : 1,
                                                        })}
                                                    >
                                                        <View style={{
                                                            width: 16,
                                                            height: 16,
                                                            borderRadius: 8,
                                                            borderWidth: 2,
                                                            borderColor: isSelected ? theme.colors.radio.active : theme.colors.radio.inactive,
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            marginRight: 12,
                                                            marginTop: 2,
                                                        }}>
                                                            {isSelected && <View style={{
                                                                width: 6,
                                                                height: 6,
                                                                borderRadius: 3,
                                                                backgroundColor: theme.colors.radio.dot,
                                                            }} />}
                                                        </View>
                                                        <View style={{ flex: 1 }}>
                                                            {model.providerName ? (
                                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                                                                    <ProviderIcon kind={model.providerKind} size={12} />
                                                                    <Text style={{
                                                                        fontSize: 14,
                                                                        color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                                                        ...Typography.default(),
                                                                    }}>
                                                                        {model.name}
                                                                    </Text>
                                                                </View>
                                                            ) : (
                                                                <Text style={{
                                                                    fontSize: 14,
                                                                    color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                                                    ...Typography.default(),
                                                                }}>
                                                                    {model.name}
                                                                </Text>
                                                            )}
                                                            {!!model.description && (
                                                                <Text style={{
                                                                    fontSize: 11,
                                                                    color: theme.colors.textSecondary,
                                                                    ...Typography.default(),
                                                                }}>
                                                                    {model.description}
                                                                </Text>
                                                            )}
                                                        </View>
                                                    </BubblePressable>
                                                );
                                            }) : (
                                                <Text style={{
                                                    fontSize: 13,
                                                    color: theme.colors.textSecondary,
                                                    paddingHorizontal: 16,
                                                    paddingVertical: 8,
                                                    ...Typography.default(),
                                                }}>
                                                    {t('agentInput.model.configureInCli')}
                                                </Text>
                                            )}
                                        </View>
                                        )}
                                        {openPicker === 'effort' && availableEffortLevels.length > 0 && props.onEffortLevelChange && (
                                                <View style={styles.overlaySection}>
                                                    <Text style={styles.overlaySectionTitle}>
                                                        {props.effortLevel?.name ?? t('agentInput.effort.title')}
                                                    </Text>
                                                    {availableEffortLevels.map((level) => {
                                                        const isSelected = props.effortLevel?.key === level.key;
                                                        return (
                                                            <BubblePressable
                                                                key={level.key}
                                                                onPress={() => {
                                                                    hapticsLight();
                                                                    props.onEffortLevelChange?.(level);
                                                                    closePicker();
                                                                }}
                                                                style={({ pressed }) => ({
                                                                    flexDirection: 'row',
                                                                    alignItems: 'flex-start',
                                                                    paddingHorizontal: 16,
                                                                    paddingVertical: 8,
                                                                    marginHorizontal: 8,
                                                                    borderRadius: 14,
                                                                    backgroundColor: pressed
                                                                        ? theme.colors.surfacePressedOverlay
                                                                        : isSelected
                                                                            ? theme.colors.glass.backgroundSubtle
                                                                            : 'transparent',
                                                                })}
                                                            >
                                                                <View style={{
                                                                    width: 16,
                                                                    height: 16,
                                                                    borderRadius: 8,
                                                                    borderWidth: 2,
                                                                    borderColor: isSelected ? theme.colors.radio.active : theme.colors.radio.inactive,
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    marginRight: 12,
                                                                    marginTop: 2,
                                                                }}>
                                                                    {isSelected && <View style={{
                                                                        width: 6,
                                                                        height: 6,
                                                                        borderRadius: 3,
                                                                        backgroundColor: theme.colors.radio.dot,
                                                                    }} />}
                                                                </View>
                                                                <View style={{ flex: 1 }}>
                                                                    <Text style={{
                                                                        fontSize: 14,
                                                                        color: isSelected ? theme.colors.radio.active : theme.colors.text,
                                                                        ...Typography.default(),
                                                                    }}>
                                                                        {level.name}
                                                                    </Text>
                                                                    {!!level.description && (
                                                                        <Text style={{
                                                                            fontSize: 11,
                                                                            color: theme.colors.textSecondary,
                                                                            ...Typography.default(),
                                                                        }}>
                                                                            {level.description}
                                                                        </Text>
                                                                    )}
                                                                </View>
                                                            </BubblePressable>
                                                        );
                                                    })}
                                                </View>
                                        )}
                                    </>
                                )}
                            </FloatingOverlay>
                        </View>
                    </>
                )}

                <AnimatedFade visible={props.showStatusDetails !== false}>
                    <AgentInputStatusRow
                        connectionStatus={props.connectionStatus}
                        gitBranch={props.sessionStatusGitBranch ?? null}
                        gitChanges={props.sessionStatusGitChanges ?? null}
                    />

                    <AgentInputContextChips
                        machineName={props.machineName}
                        onMachineClick={props.onMachineClick}
                        currentPath={props.currentPath}
                        onPathClick={props.onPathClick}
                    />
                </AnimatedFade>

                {/* Box 2: Action Area (Input + Send) */}
                <Shaker ref={sendBlockShakerRef} onLayout={handleActionAreaLayout}>
                    <View style={[
                        compactMobileComposer && styles.unifiedPanelShadow,
                        compactMobileComposer && styles.mobileUnifiedPanelShadow,
                    ]}>
                        <MobileGlassSurface
                            enabled={compactMobileComposer}
                            nativeEffect
                            material="frosted"
                            intensity={92}
                            style={[
                                styles.unifiedPanel,
                                compactMobileComposer && styles.mobileUnifiedPanel,
                            ]}
                        >
                    {/* Attachment preview strip */}
                    {props.selectedImages && props.selectedImages.length > 0 && (
                        <AgentInputAttachmentStrip
                            images={props.selectedImages}
                            onRemove={props.onRemoveImage ?? (() => {})}
                        />
                    )}
                    {props.selectedContextEntries && props.selectedContextEntries.length > 0 && (
                        <WorkspaceContextStrip
                            entries={props.selectedContextEntries}
                            onRemove={props.onRemoveContextEntry ?? (() => {})}
                        />
                    )}
                    {props.dictationPhase === 'error' && props.dictationError && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 8 }}>
                            <Ionicons name="alert-circle-outline" size={14} color={theme.colors.textDestructive} />
                            <Text style={{ flex: 1, fontSize: 12, color: theme.colors.textDestructive, ...Typography.default() }}>
                                {props.dictationError}
                            </Text>
                        </View>
                    )}
                    {/* Input field */}
                    <View style={[
                        styles.inputContainer,
                        compactMobileComposer && styles.mobileInputContainer,
                        props.minHeight ? { minHeight: props.minHeight } : undefined,
                    ]}>
                        <MultiTextInput
                            ref={inputRef}
                            defaultValue={props.initialValue}
                            paddingTop={compactMobileComposer
                                ? MOBILE_COMPOSER_METRICS.inputPaddingTop
                                : Platform.OS === 'web' ? 10 : 8}
                            paddingBottom={compactMobileComposer
                                ? MOBILE_COMPOSER_METRICS.inputPaddingBottom
                                : Platform.OS === 'web' ? 10 : 8}
                            onChangeText={handleTextChange}
                            placeholder={props.placeholder}
                            onKeyPress={handleKeyPress}
                            onStateChange={handleInputStateChange}
                            maxHeight={Platform.OS === 'web' ? 480 : MOBILE_COMPOSER_METRICS.inputMaxHeight}
                            lineHeight={compactMobileComposer ? MOBILE_COMPOSER_METRICS.inputLineHeight : undefined}
                        />
                    </View>

                    {compactMobileComposer ? (
                    /* Explicit queued follow-up precedes attachments; provider
                        settings, dedicated dictation, Stop, and Send follow. */
                    <View style={[
                        styles.actionButtonsContainer,
                        styles.mobileActionButtonsContainer,
                    ]}>
                        {!props.zenMode && props.onQueueMessage && (
                            <BubblePressable
                                onPress={props.onQueueMessage}
                                disabled={!hasComposerContent || props.isSendDisabled}
                                hitSlop={6}
                                style={(pressedState) => [
                                    styles.mobileQueueButton,
                                    {
                                        opacity: !hasComposerContent || props.isSendDisabled
                                            ? 0.42
                                            : pressedState.pressed ? 0.7 : 1,
                                    },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={t('happyHerd.composer.queueMessage')}
                            >
                                <Text style={styles.mobileQueueButtonText}>{t('happyHerd.composer.queueMessage')}</Text>
                            </BubblePressable>
                        )}

                        {!props.zenMode && (props.onPickImages || props.onPickDeviceFiles) && (
                            <AttachmentInputButton
                                onPickPhotos={props.onPickImages}
                                onPickDeviceFiles={props.onPickDeviceFiles}
                                active={(props.selectedImages?.length ?? 0) > 0 || hasContextEntries}
                                color={theme.colors.text}
                                activeColor={theme.colors.radio.active}
                                size={MOBILE_COMPOSER_METRICS.addIconSize}
                                hitSlop={6}
                                style={styles.mobileIconButton}
                            />
                        )}

                        {/* Named in words rather than hidden behind a gear: the
                            permission mode is the one control here that changes
                            what the agent may do to the machine. Matches the
                            same chip in the Home composer. */}
                        {!props.zenMode && (permissionSettingsGroups.length > 0 || showReadOnlyPermissionMode) && (
                            showReadOnlyPermissionMode ? renderReadOnlyPermissionMode() : useNativeSettingsMenus ? (
                                <NativeSettingsMenu
                                    accessibilityLabel={permissionSettingsGroups[0]?.label}
                                    groups={permissionSettingsGroups}
                                    flat
                                    triggerLabel={permissionShortLabel ?? undefined}
                                    triggerSystemImage={permissionShortLabel ? undefined : 'shield'}
                                    // Centered to agree with the React Native
                                    // chip underneath, which sizes the frame.
                                    triggerAlignment="center"
                                    style={styles.mobilePermissionMenuFrame}
                                >
                                    <View style={styles.mobilePermissionMenuContent}>
                                        {renderPermissionValue()}
                                    </View>
                                </NativeSettingsMenu>
                            ) : (
                                <BubblePressable
                                    onPress={handleSettingsPress}
                                    hitSlop={6}
                                    style={styles.mobilePermissionButton}
                                    accessibilityRole="button"
                                    accessibilityLabel={isCodex
                                        ? t('agentInput.codexPermissionMode.title')
                                        : t('agentInput.permissionMode.title')}
                                >
                                    {renderPermissionValue()}
                                </BubblePressable>
                            )
                        )}

                        {!props.zenMode ? (
                            <>
                                {/* Pushes model/effort right, so the effort chip
                                    sits against the send button and the pair does
                                    not drift when either label changes width. */}
                                <View style={{ flex: 1 }} />
                                {useNativeSettingsMenus && modelSettingsGroup ? (
                                    <NativeSettingsMenu
                                        accessibilityLabel={t('agentInput.model.title')}
                                        groups={[modelSettingsGroup]}
                                        flat
                                        triggerLabel={modelLabel}
                                        triggerAlignment="trailing"
                                        style={styles.mobileModelMenuFrame}
                                    >
                                        <View style={styles.mobileModelMenuContent}>
                                            {renderModelValue()}
                                        </View>
                                    </NativeSettingsMenu>
                                ) : (
                                    <BubblePressable
                                        onPress={handleModelPress}
                                        disabled={!canOpenModelPicker}
                                        hitSlop={6}
                                        style={(p) => [
                                            styles.mobileModeButton,
                                            { opacity: p.pressed && canOpenModelPicker ? 0.7 : canOpenModelPicker ? 1 : 0.58 },
                                        ]}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('agentInput.model.title')}
                                    >
                                        {renderModelValue()}
                                    </BubblePressable>
                                )}

                                {/* The separator lives between the two chips rather
                                    than inside the effort label, which would wrap
                                    it onto its own line in a narrow trigger. */}
                                {effortSettingsGroup && (
                                    <Text style={styles.mobileModeSeparator}>·</Text>
                                )}

                                {effortSettingsGroup && (
                                    useNativeSettingsMenus ? (
                                        <NativeSettingsMenu
                                            accessibilityLabel={t('agentInput.effort.title')}
                                            groups={[effortSettingsGroup]}
                                            flat
                                            triggerLabel={effortLabel ?? t('agentInput.effort.title')}
                                            triggerAlignment="leading"
                                            style={styles.mobileEffortMenuFrame}
                                        >
                                            <View style={styles.mobileEffortMenuContent}>
                                                {renderEffortValue()}
                                            </View>
                                        </NativeSettingsMenu>
                                    ) : (
                                        <BubblePressable
                                            onPress={handleEffortPress}
                                            disabled={!canOpenEffortPicker}
                                            hitSlop={6}
                                            style={(p) => [
                                                styles.mobileEffortButton,
                                                { opacity: p.pressed && canOpenEffortPicker ? 0.7 : canOpenEffortPicker ? 1 : 0.58 },
                                            ]}
                                            accessibilityRole="button"
                                            accessibilityLabel={t('agentInput.effort.title')}
                                        >
                                            {renderEffortValue()}
                                        </BubblePressable>
                                    )
                                )}
                            </>
                        ) : <View style={{ flex: 1 }} />}

                        {!compactMobileComposer && props.agentType && props.onAgentClick && (
                            <BubblePressable
                                onPress={() => {
                                    hapticsLight();
                                    props.onAgentClick?.();
                                }}
                                hitSlop={6}
                                style={styles.mobileIconButton}
                                accessibilityRole="button"
                                accessibilityLabel={props.agentType}
                            >
                                <Octicons name="cpu" size={14} color={theme.colors.text} />
                            </BubblePressable>
                        )}

                        {shouldShowStopButton && props.onAbort && (
                            <Shaker ref={shakerRef}>
                                <View
                                    style={[
                                        styles.sendButton,
                                        styles.mobilePrimaryButton,
                                        styles.mobileStopButton,
                                        { marginLeft: 0 },
                                    ]}
                                >
                                    <BubblePressable
                                        style={(p) => ({
                                            width: '100%',
                                            height: '100%',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            opacity: p.pressed ? 0.7 : 1,
                                        })}
                                        hitSlop={6}
                                        onPress={() => void handleAbortPress()}
                                        disabled={isAborting}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('happyHerd.composer.stop')}
                                    >
                                        {isAborting ? (
                                            <ActivityIndicator
                                                size="small"
                                                color={theme.dark ? '#000000' : '#FFFFFF'}
                                            />
                                        ) : (
                                            <Octicons
                                                name="stop"
                                                size={16}
                                                color={theme.dark ? '#000000' : '#FFFFFF'}
                                            />
                                        )}
                                    </BubblePressable>
                                </View>
                            </Shaker>
                        )}
                        <VoiceDictationControls
                            compact
                            phase={props.dictationPhase ?? 'idle'}
                            onPress={props.onMicPress ? handleMicrophonePress : undefined}
                            onCancel={props.onDictationCancel}
                            onRetry={props.onDictationRetry}
                            disabled={!!props.isSendDisabled || !!props.isSending}
                        />
                        <View
                            style={[
                                styles.sendButton,
                                styles.mobilePrimaryButton,
                                primaryAction === 'blocked' ? styles.sendButtonLocked
                                    : canSendMessage ? styles.mobilePrimaryButtonActive
                                        : styles.mobilePrimaryButtonInactive,
                            ]}
                        >
                            <BubblePressable
                                style={(p) => ({
                                    width: '100%',
                                    height: '100%',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: p.pressed ? 0.7 : 1,
                                })}
                                hitSlop={6}
                                onPress={handleMobilePrimaryPress}
                                disabled={!canPressSendButton}
                                accessibilityRole="button"
                                accessibilityLabel={t('happyHerd.composer.send')}
                            >
                                {props.isSending ? (
                                    <ActivityIndicator size="small" color={activeSendIconColor} />
                                ) : primaryAction === 'blocked' ? (
                                    <Ionicons
                                        name="lock-closed"
                                        size={14}
                                        color={theme.colors.textSecondary}
                                    />
                                ) : (
                                    <Octicons
                                        name="arrow-up"
                                        size={16}
                                        color={canPressSendButton ? activeSendIconColor : theme.colors.textSecondary}
                                        // The color has to travel in `style`, not just the
                                        // `color` prop: @expo/vector-icons builds
                                        // `[styleDefaults, style, ...]` (create-icon-set.js),
                                        // so a `style` entry always wins over `color`. With
                                        // styles.sendButtonIcon here — it hardcodes the
                                        // primary tint (white) — the computed color was
                                        // discarded and the arrow painted white on the
                                        // near-white glass composer, i.e. invisible.
                                        style={{
                                            color: canPressSendButton ? activeSendIconColor : theme.colors.textSecondary,
                                            marginTop: Platform.OS === 'web' ? 2 : 0,
                                        }}
                                    />
                                )}
                            </BubblePressable>
                        </View>
                    </View>
                    ) : desktopActionControls}
                        </MobileGlassSurface>
                    </View>
                </Shaker>

                <AnimatedFade visible={props.showStatusDetails !== false}>
                    <AgentInputUsageRow
                        contextStatus={contextStatus}
                        weekPercent={weekPercent}
                        usageMenuOptions={usageMenuOptions}
                    />
                </AnimatedFade>
            </View>
        </View>
    );
}));

function VoiceDictationControls({
    phase,
    onPress,
    onCancel,
    onRetry,
    disabled,
    compact = false,
}: {
    phase: VoiceDictationPhase;
    onPress?: () => void;
    onCancel?: () => void;
    onRetry?: () => void;
    disabled: boolean;
    compact?: boolean;
}) {
    const { theme } = useUnistyles();
    const control = resolveVoiceDictationControl({ phase, canRetry: !!onRetry, disabled });
    const actionPress = control.action === 'retry' ? onRetry : onPress;
    const visibility = resolveVoiceDictationControlVisibility({
        state: control,
        hasActionHandler: !!actionPress,
        hasCancelHandler: !!onCancel,
    });
    if (!visibility.shouldRender) return null;
    const buttonStyle = compact
        ? stylesheet.mobileIconButton
        : {
            width: 32,
            height: 32,
            flexShrink: 0,
            alignItems: 'center' as const,
            justifyContent: 'center' as const,
            borderRadius: 16,
        };
    const accessibilityLabel = control.action === 'finish'
        ? t('happyHerd.composer.finishVoice')
        : control.action === 'retry'
            ? t('happyHerd.composer.retryVoice')
            : control.action === 'transcribing'
                ? t('happyHerd.composer.transcribingVoice')
                : t('happyHerd.composer.startVoice');
    const tintColor = phase === 'recording'
        ? theme.colors.textDestructive
        : phase === 'error'
            ? theme.colors.textLink
            : compact
                ? theme.colors.text
                : theme.colors.button.secondary.tint;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 0 : 2 }}>
            {visibility.showCancel && (
                <BubblePressable
                    onPress={onCancel}
                    hitSlop={6}
                    style={buttonStyle}
                    testID="composer-dictation-cancel"
                    accessibilityRole="button"
                    accessibilityLabel={t('happyHerd.composer.cancelVoice')}
                >
                    <Ionicons name="close" size={compact ? 20 : 16} color={theme.colors.textSecondary} />
                </BubblePressable>
            )}
            {visibility.showAction && (
                <BubblePressable
                    onPress={actionPress}
                    disabled={control.disabled || !actionPress}
                    hitSlop={6}
                    style={(pressedState) => [
                        buttonStyle,
                        { opacity: control.disabled ? 0.58 : pressedState.pressed ? 0.7 : 1 },
                    ]}
                    testID="composer-dictation-button"
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    accessibilityState={{
                        disabled: control.disabled || !actionPress,
                        busy: control.action === 'transcribing',
                    }}
                >
                    {control.action === 'transcribing' ? (
                        <ActivityIndicator size="small" color={tintColor} />
                    ) : control.action === 'retry' ? (
                        <Ionicons name="refresh" size={compact ? 20 : 18} color={tintColor} />
                    ) : control.action === 'finish' ? (
                        <Ionicons name="stop" size={compact ? 20 : 18} color={tintColor} />
                    ) : (
                        <Ionicons name="mic" size={compact ? 20 : 18} color={tintColor} />
                    )}
                </BubblePressable>
            )}
        </View>
    );
}
