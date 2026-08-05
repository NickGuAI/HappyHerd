import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import type { Message, ToolCallMessage } from '@/sync/typesMessage';
import type { ToolViewProps } from './_all';

type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';

function outcome(tool: ToolViewProps['tool']): { status: SubagentStatus; detail?: string } {
    const result = tool.result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        const status = (result as { status?: unknown }).status;
        const detail = (result as { detail?: unknown }).detail;
        if (status === 'completed' || status === 'failed' || status === 'cancelled'
            || status === 'interrupted' || status === 'unknown') {
            return {
                status,
                ...(typeof detail === 'string' && detail.trim().length > 0 ? { detail: detail.trim() } : {}),
            };
        }
    }
    return { status: tool.state === 'running' ? 'running' : 'unknown' };
}

function toolTitle(message: ToolCallMessage): string {
    if (message.tool.description?.trim()) {
        return message.tool.description.trim();
    }
    return message.tool.name;
}

export const SubagentView = React.memo<ToolViewProps>(({ tool, messages, sessionId }) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const state = outcome(tool);
    const visibleMessages = messages.filter((message) => (
        message.kind === 'agent-text' || message.kind === 'tool-call'
    ));
    const latestText = [...visibleMessages].reverse().find((message) => (
        message.kind === 'agent-text' && !message.isThinking
    ));
    const statusColor = state.status === 'completed'
        ? theme.colors.success
        : state.status === 'failed' || state.status === 'interrupted'
            ? theme.colors.textDestructive
            : state.status === 'cancelled'
                ? theme.colors.warning
                : theme.colors.textSecondary;

    return (
        <View style={styles.container}>
            <View style={styles.summaryRow}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.status, { color: statusColor }]}>{state.status.toUpperCase()}</Text>
                <Text style={styles.eventCount}>{visibleMessages.length} events</Text>
            </View>

            {state.detail ? (
                <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{state.detail}</Text>
                </View>
            ) : null}

            {!expanded && latestText?.kind === 'agent-text' ? (
                <View style={styles.preview}>
                    <MarkdownView markdown={latestText.text} sessionId={sessionId} />
                </View>
            ) : null}

            {expanded ? (
                <View style={styles.trace}>
                    {visibleMessages.map((message) => {
                        if (message.kind === 'agent-text') {
                            return (
                                <View key={message.id} style={message.isThinking ? styles.reasoning : styles.output}>
                                    {message.isThinking ? <Text style={styles.traceLabel}>REASONING</Text> : null}
                                    <MarkdownView markdown={message.text} sessionId={sessionId} />
                                </View>
                            );
                        }

                        return (
                            <View key={message.id} style={styles.toolRow}>
                                <Ionicons
                                    name={message.tool.state === 'error' ? 'alert-circle-outline' : message.tool.state === 'running' ? 'ellipse-outline' : 'checkmark-circle-outline'}
                                    size={16}
                                    color={message.tool.state === 'error' ? theme.colors.textDestructive : theme.colors.textSecondary}
                                />
                                <Text style={styles.toolText} numberOfLines={2}>{toolTitle(message)}</Text>
                            </View>
                        );
                    })}
                    {visibleMessages.length === 0 ? <Text style={styles.empty}>No child activity observed yet.</Text> : null}
                </View>
            ) : null}

            {visibleMessages.length > 0 ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={expanded ? 'Collapse sub-agent activity' : 'Expand sub-agent activity'}
                    onPress={() => setExpanded((value) => !value)}
                    style={styles.toggle}
                >
                    <Text style={styles.toggleText}>{expanded ? 'Hide activity' : 'View activity'}</Text>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={theme.colors.textSecondary} />
                </Pressable>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 12,
        gap: 10,
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    statusDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    status: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.7,
    },
    eventCount: {
        marginLeft: 'auto',
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    errorBox: {
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.textDestructive,
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    errorText: {
        color: theme.colors.textDestructive,
        fontSize: 13,
        lineHeight: 19,
    },
    preview: {
        opacity: 0.92,
    },
    trace: {
        gap: 8,
    },
    reasoning: {
        opacity: 0.72,
        borderLeftWidth: 1,
        borderLeftColor: theme.colors.divider,
        paddingLeft: 9,
    },
    output: {
        paddingVertical: 2,
    },
    traceLabel: {
        color: theme.colors.textSecondary,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.8,
        marginBottom: 3,
    },
    toolRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        minHeight: 26,
    },
    toolText: {
        flex: 1,
        color: theme.colors.textSecondary,
        fontSize: 13,
        fontFamily: 'monospace',
    },
    empty: {
        color: theme.colors.textSecondary,
        fontSize: 13,
    },
    toggle: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        paddingVertical: 3,
    },
    toggleText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: '600',
    },
}));
