import * as React from 'react';
import { View, Text, Platform } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { ToolViewProps } from "./_all";
import { knownTools } from '../../tools/knownTools';
import { ToolSectionView } from '../../tools/ToolSectionView';

export interface Todo {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority?: 'high' | 'medium' | 'low';
    id?: string;
}

function readTodos(tool: ToolViewProps['tool']): Todo[] {
    let todosList: Todo[] = [];

    // Try to get todos from input first
    const parsedArguments = knownTools.TodoWrite.input.safeParse(tool.input);
    if (parsedArguments.success && parsedArguments.data.todos) {
        todosList = parsedArguments.data.todos;
    }

    // If we have a properly structured result, use newTodos from there
    const parsed = knownTools.TodoWrite.result.safeParse(tool.result);
    if (parsed.success && parsed.data.newTodos) {
        todosList = parsed.data.newTodos;
    }
    return todosList;
}

export const TodoView = React.memo<ToolViewProps>(({ tool }) => {
    const todosList = readTodos(tool);
    if (todosList.length === 0) return null;
    if (Platform.OS === 'web') return <WebTodoCard todos={todosList} />;

    return (
        <ToolSectionView>
            <View style={styles.container}>
                {todosList.map((todo, index) => {
                    const isCompleted = todo.status === 'completed';
                    const isInProgress = todo.status === 'in_progress';
                    const isPending = todo.status === 'pending';

                    let textStyle: any = styles.todoText;
                    let icon = '☐';

                    if (isCompleted) {
                        textStyle = [styles.todoText, styles.completedText];
                        icon = '☑';
                    } else if (isInProgress) {
                        textStyle = [styles.todoText, styles.inProgressText];
                        icon = '☐';
                    } else if (isPending) {
                        textStyle = [styles.todoText, styles.pendingText];
                    }

                    return (
                        <View key={todo.id || `todo-${index}`} style={styles.todoItem}>
                            <Text style={textStyle}>
                                {icon} {todo.content}
                            </Text>
                        </View>
                    );
                })}
            </View>
        </ToolSectionView>
    );
});

/**
 * Web plan card (UI overhaul): a header with the checklist's progress bar and
 * count, then one row per item with a check box. Done items strike through,
 * the active item reads in the accent color.
 */
function WebTodoCard(props: { todos: Todo[] }) {
    const { theme } = useUnistyles();
    const done = props.todos.filter((todo) => todo.status === 'completed').length;
    const total = props.todos.length;
    const progress = total > 0 ? done / total : 0;
    return (
        <View style={styles.card} testID="todo-card">
            <View style={styles.cardHead}>
                <Octicons name="checklist" size={14} color={theme.colors.kilv.inkFaint} />
                <Text style={styles.cardTitle}>{t('tools.names.todoList')}</Text>
                <View
                    style={styles.progressTrack}
                    accessibilityRole="progressbar"
                    accessibilityValue={{ min: 0, max: total, now: done }}
                >
                    <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <Text style={styles.cardCount}>{`${done}/${total}`}</Text>
            </View>
            {props.todos.map((todo, index) => {
                const completed = todo.status === 'completed';
                const active = todo.status === 'in_progress';
                return (
                    <View key={todo.id || `todo-${index}`} style={styles.cardItem}>
                        <View style={[styles.check, completed && styles.checkDone, active && styles.checkActive]}>
                            {completed ? (
                                <Octicons name="check" size={11} color={theme.colors.button.primary.tint} />
                            ) : null}
                        </View>
                        <Text
                            style={[
                                styles.cardItemText,
                                completed && styles.cardItemDone,
                                active && styles.cardItemActive,
                            ]}
                        >
                            {todo.content}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        gap: 4,
    },
    todoItem: {
        paddingVertical: 2,
    },
    todoText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text,
        flex: 1,
    },
    completedText: {
        color: theme.colors.success,
        textDecorationLine: 'line-through',
    },
    inProgressText: {
        color: theme.colors.textLink,
    },
    pendingText: {
        color: theme.colors.textSecondary,
    },
    card: {
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.surfaceHigh,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 8,
    },
    cardHead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 6,
    },
    cardTitle: {
        fontSize: 13,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    progressTrack: {
        flex: 1,
        height: 3,
        borderRadius: theme.kilv.radiusPill,
        backgroundColor: theme.colors.divider,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: theme.kilv.radiusPill,
        backgroundColor: theme.colors.textLink,
        _web: {
            transition: `width ${theme.kilv.motionSlow}ms ${theme.kilv.easeOut}`,
            boxShadow: theme.kilv.glowMoltenSoft,
        },
    },
    cardCount: {
        fontSize: 13,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    cardItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 5,
    },
    check: {
        width: 16,
        height: 16,
        borderRadius: theme.borderRadius.sm,
        borderWidth: 2,
        borderColor: theme.colors.kilv.rimLine,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    checkDone: {
        backgroundColor: theme.colors.gitAddedText,
        borderColor: theme.colors.gitAddedText,
    },
    checkActive: {
        borderColor: theme.colors.textLink,
    },
    cardItemText: {
        flex: 1,
        fontSize: 14.5,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    cardItemDone: {
        color: theme.colors.kilv.inkFaint,
        textDecorationLine: 'line-through',
        textDecorationColor: theme.colors.gitAddedText,
    },
    cardItemActive: {
        color: theme.colors.textLink,
    },
}));
