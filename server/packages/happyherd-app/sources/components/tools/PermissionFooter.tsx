import { Text } from '@/components/StyledText';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
    Platform,
    useWindowDimensions,
    type StyleProp,
    type TextStyle,
    type ViewStyle,
} from 'react-native';
import { sessionAllow, sessionDeny, sessionSetAgentModes } from '@/sync/ops';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useHerdPhoneLayout } from '@/components/herd/mobile/useHerdPhone';
import { ProviderIcon } from '@/components/ProviderIcon';
import { Octicons } from '@expo/vector-icons';
import { usePermissionShortcuts } from '@/components/herd/session/permissionShortcuts';
import { Typography } from '@/constants/Typography';

interface PermissionActionButtonProps {
    label: string;
    loading: boolean;
    disabled: boolean;
    onPress: () => void;
    activeOpacity: number;
    buttonStyle: StyleProp<ViewStyle>;
    contentStyle: StyleProp<ViewStyle>;
    textStyle: StyleProp<TextStyle>;
    ringStyle: StyleProp<ViewStyle>;
    ringColor: string;
    numberOfLines?: number;
    leading?: React.ReactNode;
    trailing?: React.ReactNode;
}

const PermissionActionButton = React.memo(function PermissionActionButton({
    label,
    loading,
    disabled,
    onPress,
    activeOpacity,
    buttonStyle,
    contentStyle,
    textStyle,
    ringStyle,
    ringColor,
    numberOfLines = 1,
    leading,
    trailing,
}: PermissionActionButtonProps) {
    const pulse = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!loading) {
            pulse.stopAnimation();
            pulse.setValue(0);
            return;
        }

        pulse.setValue(0);
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 720,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 0,
                    duration: 720,
                    easing: Easing.inOut(Easing.quad),
                    useNativeDriver: true,
                }),
            ]),
        );
        animation.start();

        return () => {
            animation.stop();
        };
    }, [loading, pulse]);

    const ringOpacity = pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.18, 0.52],
    });

    return (
        <TouchableOpacity
            style={buttonStyle}
            onPress={onPress}
            disabled={disabled}
            activeOpacity={activeOpacity}
        >
            <View style={contentStyle}>
                {leading}
                <Text style={textStyle} numberOfLines={numberOfLines} ellipsizeMode="tail">
                    {label}
                </Text>
                {trailing}
            </View>
            {loading ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        ringStyle,
                        {
                            borderColor: ringColor,
                            opacity: ringOpacity,
                        },
                    ]}
                />
            ) : null}
        </TouchableOpacity>
    );
});

interface PermissionFooterProps {
    permission: {
        id: string;
        status: "pending" | "approved" | "denied" | "canceled";
        reason?: string;
        mode?: string;
        allowedTools?: string[];
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
    };
    sessionId: string;
    toolName: string;
    toolInput?: any;
    metadata?: any;
}

export const PermissionFooter: React.FC<PermissionFooterProps> = ({ permission, sessionId, toolName, toolInput, metadata }) => {
    const { theme } = useUnistyles();
    // The phone layout (UI overhaul) stretches the choices; wider layouts right-align them.
    const phoneLayout = useHerdPhoneLayout();
    const { height: windowHeight } = useWindowDimensions();
    const [loadingButton, setLoadingButton] = useState<'allow' | 'deny' | 'abort' | null>(null);
    const [loadingAllEdits, setLoadingAllEdits] = useState(false);
    const [loadingBypass, setLoadingBypass] = useState(false);
    const [loadingForSession, setLoadingForSession] = useState(false);
    
    // Check if this is a Codex session - check both metadata.flavor and tool name prefix
    const isCodex = metadata?.flavor === 'codex' || toolName.startsWith('Codex');
    const isGrok = metadata?.flavor === 'grok';

    const handleApprove = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingBypass || loadingForSession) return;

        setLoadingButton('allow');
        try {
            await sessionAllow(sessionId, permission.id);
            // Plain plan approval switches the CLI's live SDK query to
            // 'default' — mirror that here, otherwise the next message's meta
            // still carries the stale 'plan' and pushes the SDK back into
            // plan mode, undoing the approval.
            if (toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode') {
                sessionSetAgentModes(sessionId, { permissionMode: 'default' });
            }
        } catch (error) {
            console.error('Failed to approve permission:', error);
        } finally {
            setLoadingButton(null);
        }
    };

    const handleApproveAllEdits = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingBypass || loadingForSession) return;

        setLoadingAllEdits(true);
        try {
            await sessionAllow(sessionId, permission.id, 'acceptEdits');
            // Update the session permission mode to 'acceptEdits' for future permissions
            sessionSetAgentModes(sessionId, { permissionMode: 'acceptEdits' });
        } catch (error) {
            console.error('Failed to approve all edits:', error);
        } finally {
            setLoadingAllEdits(false);
        }
    };

    const handleBypassPermissions = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingBypass || loadingForSession) return;

        setLoadingBypass(true);
        try {
            await sessionAllow(sessionId, permission.id, 'bypassPermissions');
            sessionSetAgentModes(sessionId, { permissionMode: 'bypassPermissions' });
        } catch (error) {
            console.error('Failed to bypass permissions:', error);
        } finally {
            setLoadingBypass(false);
        }
    };

    const handleApproveForSession = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingBypass || loadingForSession || !toolName) return;

        setLoadingForSession(true);
        try {
            // Special handling for Bash tool - include exact command
            let toolIdentifier = toolName;
            if (toolName === 'Bash' && toolInput?.command) {
                const command = toolInput.command;
                toolIdentifier = `Bash(${command})`;
            }
            
            await sessionAllow(sessionId, permission.id, undefined, [toolIdentifier]);
        } catch (error) {
            console.error('Failed to approve for session:', error);
        } finally {
            setLoadingForSession(false);
        }
    };

    const handleDeny = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingAllEdits || loadingBypass || loadingForSession) return;

        setLoadingButton('deny');
        try {
            await sessionDeny(
                sessionId,
                permission.id,
                undefined,
                undefined,
                isGrok ? 'denied' : undefined,
            );
        } catch (error) {
            console.error('Failed to deny permission:', error);
        } finally {
            setLoadingButton(null);
        }
    };

    // Codex-specific handlers
    const handleCodexApprove = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;
        
        setLoadingButton('allow');
        try {
            await sessionAllow(sessionId, permission.id, undefined, undefined, 'approved');
        } catch (error) {
            console.error('Failed to approve permission:', error);
        } finally {
            setLoadingButton(null);
        }
    };
    
    const handleCodexApproveForSession = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;
        
        setLoadingForSession(true);
        try {
            await sessionAllow(sessionId, permission.id, undefined, undefined, 'approved_for_session');
        } catch (error) {
            console.error('Failed to approve for session:', error);
        } finally {
            setLoadingForSession(false);
        }
    };
    
    const handleCodexAbort = async () => {
        if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;
        
        setLoadingButton('abort');
        try {
            await sessionDeny(sessionId, permission.id, undefined, undefined, 'abort');
        } catch (error) {
            console.error('Failed to abort permission:', error);
        } finally {
            setLoadingButton(null);
        }
    };

    const isApproved = permission.status === 'approved';
    const isDenied = permission.status === 'denied';
    const isPending = permission.status === 'pending';

    // Helper function to check if tool matches allowed pattern
    const isToolAllowed = (toolName: string, toolInput: any, allowedTools: string[] | undefined): boolean => {
        if (!allowedTools) return false;
        
        // Direct match for non-Bash tools
        if (allowedTools.includes(toolName)) return true;
        
        // For Bash, check exact command match
        if (toolName === 'Bash' && toolInput?.command) {
            const command = toolInput.command;
            return allowedTools.includes(`Bash(${command})`);
        }
        
        return false;
    };

    // Detect which button was used based on mode (for Claude) or decision (for Codex)
    const isApprovedViaAllow = isApproved && permission.mode !== 'acceptEdits' && permission.mode !== 'bypassPermissions' && !isToolAllowed(toolName, toolInput, permission.allowedTools);
    const isApprovedViaAllEdits = isApproved && permission.mode === 'acceptEdits';
    const isApprovedViaBypass = isApproved && permission.mode === 'bypassPermissions';
    const isApprovedForSession = isApproved && isToolAllowed(toolName, toolInput, permission.allowedTools);
    
    // Codex-specific status detection with fallback
    const isCodexApproved = isCodex && isApproved && (permission.decision === 'approved' || !permission.decision);
    const isCodexApprovedForSession = isCodex && isApproved && permission.decision === 'approved_for_session';
    const isCodexAborted = isCodex && isDenied && permission.decision === 'abort';

    const styles = StyleSheet.create({
        container: {
            paddingHorizontal: 6,
            paddingTop: 4,
            paddingBottom: 8,
            justifyContent: 'center',
        },
        optionsScroll: {
            maxHeight: Math.min(260, Math.round(windowHeight * 0.35)),
        },
        buttonContainer: {
            flexDirection: 'column',
            gap: 7,
            alignItems: phoneLayout ? 'stretch' : 'flex-end',
        },
        providerHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: phoneLayout ? 'flex-start' : 'flex-end',
            gap: 6,
            paddingHorizontal: 4,
            paddingBottom: 7,
        },
        providerHeaderText: {
            color: theme.colors.textSecondary,
            fontSize: 13,
        },
        button: {
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: theme.borderRadius.sm,
            backgroundColor: Platform.select({ web: 'transparent', default: theme.colors.surface }),
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 34,
            maxWidth: '100%',
            borderWidth: 1,
            borderColor: Platform.select({ web: theme.colors.textSecondary, default: theme.colors.divider }),
            flexShrink: 1,
            opacity: Platform.select({ web: 0.62, default: 1 }),
            overflow: 'hidden',
            position: 'relative',
        },
        buttonAllow: {
            borderColor: Platform.select({ web: theme.colors.textSecondary, default: theme.colors.divider }),
        },
        buttonDeny: {
            borderColor: Platform.select({ web: theme.colors.textSecondary, default: theme.colors.divider }),
        },
        buttonAllowAll: {
            borderColor: Platform.select({ web: theme.colors.textSecondary, default: theme.colors.divider }),
        },
        buttonSelected: {
            backgroundColor: Platform.select({ web: 'transparent', default: theme.colors.surfaceHighest }),
            borderColor: Platform.select({ web: theme.colors.textSecondary, default: theme.colors.divider }),
            opacity: 1,
        },
        buttonInactive: {
            opacity: Platform.select({ web: 0.62, default: 0.52 }),
        },
        buttonContent: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: 18,
            minWidth: 0,
        },
        buttonRing: {
            ...StyleSheet.absoluteFillObject,
            top: -1,
            right: -1,
            bottom: -1,
            left: -1,
            borderRadius: theme.borderRadius.md,
            borderWidth: 2,
        },
        buttonLoading: {
            opacity: 1,
        },
        buttonText: {
            fontSize: 14,
            lineHeight: 18,
            fontWeight: '400',
            color: theme.colors.text,
        },
        buttonTextAllow: {
            color: theme.colors.text,
            fontWeight: '500',
        },
        buttonTextDeny: {
            color: theme.colors.text,
            fontWeight: '500',
        },
        buttonTextAllowAll: {
            color: theme.colors.text,
            fontWeight: '500',
        },
        buttonTextSelected: {
            color: theme.colors.text,
            fontWeight: '500',
        },
        buttonForSession: {
            borderColor: Platform.select({ web: theme.colors.textSecondary, default: theme.colors.divider }),
        },
        buttonTextForSession: {
            color: theme.colors.text,
            fontWeight: '500',
        },
    });

    const isWeb = Platform.OS === 'web';
    const webStyles = StyleSheet.create({
        stack: {
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 7,
        },
        button: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-start',
            minHeight: 40,
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: theme.borderRadius.md,
            borderWidth: 1,
            borderColor: theme.colors.kilv.rimLine,
            backgroundColor: 'transparent',
            position: 'relative',
            overflow: 'visible',
        },
        buttonPrimary: {
            backgroundColor: theme.colors.button.primary.background,
            borderColor: theme.colors.button.primary.background,
        },
        buttonChosen: {
            backgroundColor: theme.colors.input.background,
            borderColor: theme.colors.textLink,
        },
        buttonDecided: {
            opacity: 0.35,
        },
        content: {
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
        },
        text: {
            flex: 1,
            fontSize: 14,
            lineHeight: 19,
            color: theme.colors.textSecondary,
        },
        textPrimary: {
            color: theme.colors.button.primary.tint,
            fontWeight: '600',
        },
        textChosen: {
            color: theme.colors.text,
            fontWeight: '500',
        },
        kbd: {
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: theme.borderRadius.sm,
            borderWidth: 1,
            borderColor: theme.colors.divider,
            alignItems: 'center',
            justifyContent: 'center',
        },
        kbdPrimary: {
            borderColor: theme.colors.button.primary.tint,
            opacity: 0.6,
        },
        kbdText: {
            fontSize: 11,
            lineHeight: 14,
            color: theme.colors.kilv.inkFaint,
            ...Typography.mono(),
        },
        kbdTextPrimary: {
            color: theme.colors.button.primary.tint,
        },
        ring: {
            ...StyleSheet.absoluteFillObject,
            top: -3,
            right: -3,
            bottom: -3,
            left: -3,
            borderRadius: theme.borderRadius.md + 3,
            borderWidth: 3,
        },
    });

    type PermissionChoice = {
        key: string;
        label: string;
        loading: boolean;
        onPress: () => void;
        disabled: boolean;
        selected: boolean;
        inactive: boolean;
        primary?: boolean;
        numberOfLines?: number;
    };

    const renderChoice = (choice: PermissionChoice, index: number) => {
        if (!isWeb) {
            return (
                <PermissionActionButton
                    key={choice.key}
                    label={choice.label}
                    loading={choice.loading && isPending}
                    onPress={choice.onPress}
                    disabled={choice.disabled}
                    activeOpacity={isPending ? 0.7 : 1}
                    buttonStyle={[
                        styles.button,
                        isPending && styles.buttonAllow,
                        choice.selected && styles.buttonSelected,
                        choice.inactive && styles.buttonInactive,
                        choice.loading && isPending ? styles.buttonLoading : null,
                    ]}
                    contentStyle={styles.buttonContent}
                    textStyle={[
                        styles.buttonText,
                        isPending && styles.buttonTextAllow,
                        choice.selected && styles.buttonTextSelected,
                    ]}
                    ringStyle={styles.buttonRing}
                    ringColor={theme.colors.text}
                    numberOfLines={choice.numberOfLines}
                />
            );
        }
        // Web (UI overhaul): the first choice is the molten primary, every
        // pending choice shows its number key, and a decided card keeps the
        // chosen answer lit with a check while the rest recede.
        const primary = isPending && choice.primary === true;
        const chosen = !isPending && choice.selected;
        return (
            <PermissionActionButton
                key={choice.key}
                label={choice.label}
                loading={choice.loading && isPending}
                onPress={choice.onPress}
                disabled={choice.disabled}
                activeOpacity={isPending ? 0.8 : 1}
                buttonStyle={[
                    webStyles.button,
                    primary && webStyles.buttonPrimary,
                    chosen && webStyles.buttonChosen,
                    !isPending && !chosen && webStyles.buttonDecided,
                ]}
                contentStyle={webStyles.content}
                textStyle={[
                    webStyles.text,
                    primary && webStyles.textPrimary,
                    chosen && webStyles.textChosen,
                ]}
                ringStyle={webStyles.ring}
                ringColor={theme.colors.textLink}
                numberOfLines={choice.numberOfLines}
                leading={chosen ? <Octicons name="check" size={14} color={theme.colors.textLink} /> : null}
                trailing={isPending ? (
                    <View style={[webStyles.kbd, primary && webStyles.kbdPrimary]}>
                        <Text style={[webStyles.kbdText, primary && webStyles.kbdTextPrimary]}>{index + 1}</Text>
                    </View>
                ) : null}
            />
        );
    };

    const anyLoading = loadingButton !== null || loadingAllEdits || loadingBypass || loadingForSession;
    let choices: PermissionChoice[];
    if (isGrok) {
        choices = [
            {
                key: 'allow',
                label: t('common.yes'),
                loading: loadingButton === 'allow',
                onPress: handleApprove,
                disabled: !isPending || loadingButton !== null,
                selected: isApproved,
                inactive: isDenied,
                primary: true,
            },
            {
                key: 'deny',
                label: t('grok.permissions.noProvideFeedback'),
                loading: loadingButton === 'deny',
                onPress: handleDeny,
                disabled: !isPending || loadingButton !== null,
                selected: isDenied,
                inactive: isApproved,
                numberOfLines: 2,
            },
        ];
    } else if (isCodex) {
        const codexDisabled = !isPending || loadingButton !== null || loadingForSession;
        choices = [
            {
                key: 'allow',
                label: t('common.yes'),
                loading: loadingButton === 'allow',
                onPress: handleCodexApprove,
                disabled: codexDisabled,
                selected: isCodexApproved,
                inactive: isCodexAborted || isCodexApprovedForSession,
                primary: true,
            },
            {
                key: 'session',
                label: t('codex.permissions.yesForSession'),
                loading: loadingForSession,
                onPress: handleCodexApproveForSession,
                disabled: codexDisabled,
                selected: isCodexApprovedForSession,
                inactive: isCodexAborted || isCodexApproved,
                numberOfLines: 2,
            },
            {
                key: 'abort',
                label: t('codex.permissions.stopAndExplain'),
                loading: loadingButton === 'abort',
                onPress: handleCodexAbort,
                disabled: codexDisabled,
                selected: isCodexAborted,
                inactive: isCodexApproved || isCodexApprovedForSession,
                numberOfLines: 2,
            },
        ];
    } else {
        const claudeDisabled = !isPending || anyLoading;
        const isEditTool = toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write' || toolName === 'NotebookEdit';
        const isPlanTool = toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode';
        choices = [
            {
                key: 'allow',
                label: t('common.yes'),
                loading: loadingButton === 'allow',
                onPress: handleApprove,
                disabled: claudeDisabled,
                selected: isApprovedViaAllow,
                inactive: isDenied || isApprovedViaAllEdits || isApprovedViaBypass || isApprovedForSession,
                primary: true,
            },
            // Allow All Edits - only for edit tools and plan approval.
            ...((isEditTool || isPlanTool) ? [{
                key: 'all-edits',
                label: t('claude.permissions.yesAllowAllEdits'),
                loading: loadingAllEdits,
                onPress: handleApproveAllEdits,
                disabled: claudeDisabled,
                selected: isApprovedViaAllEdits,
                inactive: isDenied || isApprovedViaAllow || isApprovedViaBypass || isApprovedForSession,
                numberOfLines: 2,
            }] : []),
            // Bypass all permissions (yolo mode) - only for plan approval.
            ...(isPlanTool ? [{
                key: 'bypass',
                label: t('claude.permissions.yesAllowEverything'),
                loading: loadingBypass,
                onPress: handleBypassPermissions,
                disabled: claudeDisabled,
                selected: isApprovedViaBypass,
                inactive: isDenied || isApprovedViaAllow || isApprovedViaAllEdits || isApprovedForSession,
                numberOfLines: 2,
            }] : []),
            // Allow for session - only for non-edit, non-plan tools.
            ...(toolName && !isEditTool && !isPlanTool ? [{
                key: 'session',
                label: t('claude.permissions.yesForTool'),
                loading: loadingForSession,
                onPress: handleApproveForSession,
                disabled: claudeDisabled,
                selected: isApprovedForSession,
                inactive: isDenied || isApprovedViaAllow || isApprovedViaAllEdits || isApprovedViaBypass,
                numberOfLines: 2,
            }] : []),
            {
                key: 'deny',
                label: t('claude.permissions.noTellClaude'),
                loading: loadingButton === 'deny',
                onPress: handleDeny,
                disabled: claudeDisabled,
                selected: isDenied,
                inactive: isApproved,
                numberOfLines: 2,
            },
        ];
    }

    // Web: number keys 1..n answer the oldest visible pending card.
    const containerRef = useRef<View>(null);
    usePermissionShortcuts({
        id: permission.id,
        enabled: isPending,
        choices: choices.map((choice) => choice.onPress),
        nodeRef: containerRef,
    });

    return (
        <View ref={containerRef} style={[styles.container, isWeb && { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 12 }]}>
            {isGrok && (
                <View style={styles.providerHeader}>
                    <ProviderIcon kind="grok" size={15} />
                    <Text style={styles.providerHeaderText}>{t('agentInput.agent.grok')}</Text>
                </View>
            )}
            <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={isWeb ? webStyles.stack : styles.buttonContainer}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
            >
                {choices.map(renderChoice)}
            </ScrollView>
        </View>
    );
};
