import { Text } from '@/components/StyledText';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { VisibleAgentGoalStatus } from './agentGoalStatus';
import { herdWebClasses } from './herd/motion';
import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

export type AgentGoalAction = 'clear' | 'stop' | 'edit';

type AgentGoalBarProps = {
    goal: VisibleAgentGoalStatus;
    onAction?: (action: AgentGoalAction) => void;
    inFlightAction?: AgentGoalAction | null;
    onPressDetails?: () => void;
};

const ACTION_CONFIG: Array<{
    action: AgentGoalAction;
    capability: keyof NonNullable<VisibleAgentGoalStatus['capabilities']>;
    icon: keyof typeof Ionicons.glyphMap;
}> = [
    { action: 'edit', capability: 'edit', icon: 'create-outline' },
    { action: 'stop', capability: 'stop', icon: 'pause-outline' },
    { action: 'clear', capability: 'clear', icon: 'trash-outline' },
];

export function AgentGoalBar(props: AgentGoalBarProps) {
    const { theme } = useUnistyles();
    // UI overhaul: Web shows the goal on one line — a small molten caption,
    // the goal text and its actions.
    const web = Platform.OS === 'web';
    const actions = props.onAction
        ? ACTION_CONFIG.filter((item) => props.goal.capabilities?.[item.capability])
        : [];
    const actionLabels: Record<AgentGoalAction, string> = {
        edit: t('components.agentGoalBar.editGoal'),
        stop: t('components.agentGoalBar.stopGoal'),
        clear: t('components.agentGoalBar.clearGoal'),
    };

    return (
        <Pressable
            accessibilityLabel={t('components.agentGoalBar.accessibilityLabel', { goal: props.goal.text })}
            onPress={props.onPressDetails}
            style={({ pressed }) => ({
                backgroundColor: theme.colors.surfaceHigh,
                borderColor: theme.colors.divider,
                borderWidth: 1,
                borderRadius: theme.borderRadius.md,
                paddingLeft: 12,
                paddingRight: web ? 6 : 12,
                paddingVertical: web ? 3 : 10,
                minHeight: web ? 40 : undefined,
                marginBottom: web ? 6 : 8,
                opacity: pressed && props.onPressDetails ? 0.8 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                // Unistyles web reads `_web._classNames` from inline styles too.
                ...(web ? { _web: { _classNames: herdWebClasses('herd-rise-sm') } } as object : {}),
            })}
        >
            <Ionicons
                name="locate-outline"
                size={web ? 17 : 18}
                color={web ? theme.colors.textLink : theme.colors.textSecondary}
            />
            <View style={web
                ? { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }
                : { flex: 1, minWidth: 0 }}
            >
                <Text
                    style={web
                        ? {
                            color: theme.colors.textLink,
                            fontSize: 10.5,
                            lineHeight: 16,
                            letterSpacing: 1.26,
                            textTransform: 'uppercase',
                            flexShrink: 0,
                            ...Typography.mono(),
                        }
                        : {
                            color: theme.colors.textSecondary,
                            fontSize: 12,
                            lineHeight: 16,
                            fontWeight: '600',
                        }}
                    numberOfLines={1}
                >
                    {t('components.agentGoalBar.currentGoal')}
                </Text>
                <Text
                    style={{
                        color: theme.colors.text,
                        fontSize: 14,
                        lineHeight: 19,
                        ...(web ? { flex: 1, minWidth: 0 } : {}),
                    }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {props.goal.text}
                </Text>
            </View>
            {actions.length > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: web ? 2 : 4 }}>
                    {actions.map((item) => {
                        const disabled = props.inFlightAction === item.action;
                        return (
                            <Pressable
                                key={item.action}
                                accessibilityRole="button"
                                accessibilityLabel={actionLabels[item.action]}
                                accessibilityState={{ disabled }}
                                disabled={disabled}
                                onPress={() => props.onAction?.(item.action)}
                                hitSlop={8}
                                style={({ pressed }) => ({
                                    width: 30,
                                    height: 30,
                                    borderRadius: web ? theme.borderRadius.sm : 15,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
                                    opacity: disabled ? 0.6 : 1,
                                })}
                            >
                                {disabled ? (
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                ) : (
                                    <Ionicons name={item.icon} size={web ? 14 : 16} color={theme.colors.button.secondary.tint} />
                                )}
                            </Pressable>
                        );
                    })}
                </View>
            )}
        </Pressable>
    );
}
