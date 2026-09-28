import { Text } from '@/components/StyledText';
import * as React from 'react';
import { ActivityIndicator, Platform, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { ToolSectionView } from '../ToolSectionView';
import { herdAlpha } from '@/components/herd/session/color';
import { herdWebClasses, herdStaggerClass } from '@/components/herd/motion';

/** Web draws the form as its own info-edged card (UI overhaul); native keeps the tool section. */
function FormFrame(props: { children: React.ReactNode; answered?: boolean }) {
    if (Platform.OS !== 'web') return <ToolSectionView>{props.children}</ToolSectionView>;
    return (
        <View
            style={[styles.webCard, props.answered ? styles.webCardAnswered : styles.webCardEntrance]}
            testID="question-form-card"
        >
            {props.children}
        </View>
    );
}

export interface InlineQuestionOption {
    label: string;
    description?: string | null;
}

export interface InlineQuestion {
    id: string;
    question: string;
    header: string;
    options: InlineQuestionOption[];
    multiSelect?: boolean | null;
    required?: boolean | null;
    allowCustom?: boolean | null;
    isSecret?: boolean | null;
}

export type InlineQuestionAnswers = Record<string, string[]>;

interface InlineQuestionFormProps {
    questions: InlineQuestion[];
    canInteract: boolean;
    submittedAnswers?: InlineQuestionAnswers | null;
    onSubmit: (answers: InlineQuestionAnswers) => Promise<void>;
    onCancel?: () => Promise<void>;
}

// Provider wrappers own transport and answer formats; this view owns the form.
export const InlineQuestionForm = React.memo<InlineQuestionFormProps>((props) => {
    const { questions, onSubmit, onCancel } = props;
    const { theme } = useUnistyles();
    const [selections, setSelections] = React.useState<Map<string, Set<number>>>(new Map());
    const [customAnswers, setCustomAnswers] = React.useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [submitFailed, setSubmitFailed] = React.useState(false);
    const [locallySubmittedAnswers, setLocallySubmittedAnswers] = React.useState<InlineQuestionAnswers | null>(null);
    const inFlight = React.useRef(false);
    const generation = React.useRef(0);
    const questionKey = JSON.stringify(questions);

    React.useEffect(() => {
        generation.current += 1;
        inFlight.current = false;
        setSelections(new Map());
        setCustomAnswers({});
        setLocallySubmittedAnswers(null);
        setIsSubmitting(false);
        setSubmitFailed(false);
        return () => { generation.current += 1; };
    }, [questionKey]);

    const submittedAnswers = props.submittedAnswers ?? locallySubmittedAnswers;
    const canInteract = props.canInteract && submittedAnswers === null;
    const allQuestionsAnswered = questions.every((question) => {
        if (question.required === false) return true;
        return (selections.get(question.id)?.size ?? 0) > 0
            || (question.allowCustom !== false && Boolean(customAnswers[question.id]?.trim()));
    });

    const handleOptionToggle = React.useCallback((question: InlineQuestion, optionIndex: number) => {
        if (!canInteract || inFlight.current) return;
        if (!question.multiSelect) {
            setCustomAnswers(previous => ({ ...previous, [question.id]: '' }));
        }
        setSelections(previous => {
            const next = new Map(previous);
            const current = previous.get(question.id) ?? new Set<number>();
            if (question.multiSelect) {
                const selected = new Set(current);
                if (selected.has(optionIndex)) selected.delete(optionIndex);
                else selected.add(optionIndex);
                next.set(question.id, selected);
            } else {
                next.set(question.id, new Set([optionIndex]));
            }
            return next;
        });
    }, [canInteract]);

    const send = async (answers: InlineQuestionAnswers, cancel = false) => {
        if (!canInteract || inFlight.current || (cancel && !onCancel)) return;
        inFlight.current = true;
        const currentGeneration = generation.current;
        setIsSubmitting(true);
        setSubmitFailed(false);
        try {
            if (cancel) await onCancel!();
            else await onSubmit(answers);
            // Only acknowledge success after the native reply RPC succeeds.
            if (currentGeneration === generation.current) setLocallySubmittedAnswers(answers);
        } catch {
            if (currentGeneration === generation.current) setSubmitFailed(true);
        } finally {
            if (currentGeneration === generation.current) {
                inFlight.current = false;
                setIsSubmitting(false);
            }
        }
    };

    const handleSubmit = () => {
        if (!allQuestionsAnswered) return;
        const answers: InlineQuestionAnswers = {};
        for (const question of questions) {
            const selected = Array.from(selections.get(question.id) ?? [])
                .map(index => question.options[index]?.label)
                .filter((label): label is string => typeof label === 'string');
            const custom = question.allowCustom !== false ? customAnswers[question.id]?.trim() : '';
            if (custom) selected.push(custom);
            if (selected.length) answers[question.id] = selected;
        }
        void send(answers);
    };

    if (submittedAnswers) {
        return (
            <FormFrame answered>
                <View style={styles.submittedContainer}>
                    {questions.map(question => (
                        <View key={question.id} style={styles.submittedItem}>
                            <Text style={styles.submittedHeader}>{question.header}:</Text>
                            <Text style={styles.submittedValue}>
                                {question.isSecret && submittedAnswers[question.id]?.length
                                    ? '••••'
                                    : submittedAnswers[question.id]?.join(', ') || '—'}
                            </Text>
                        </View>
                    ))}
                </View>
            </FormFrame>
        );
    }

    return (
        <FormFrame>
            <View style={styles.container}>
                {questions.map(question => {
                    const selectedOptions = selections.get(question.id) ?? new Set<number>();
                    return (
                        <View key={question.id} style={styles.questionSection}>
                            <View style={styles.headerChip}>
                                {Platform.OS === 'web' ? (
                                    <Ionicons name="help-circle-outline" size={13} color={theme.colors.status.connecting} />
                                ) : null}
                                <Text style={styles.headerText}>{question.header}</Text>
                            </View>
                            <Text style={styles.questionText}>{question.question}</Text>
                            <View style={styles.optionsContainer}>
                                {question.options.map((option, optionIndex) => {
                                    const isSelected = selectedOptions.has(optionIndex);
                                    return (
                                        <TouchableOpacity
                                            key={`${question.id}:${optionIndex}`}
                                            accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
                                            accessibilityState={{ checked: isSelected, disabled: !canInteract || isSubmitting }}
                                            aria-checked={isSelected}
                                            style={[
                                                styles.optionButton,
                                                styles.optionEntrance(optionIndex),
                                                isSelected && styles.optionButtonSelected,
                                                !canInteract && styles.optionButtonDisabled,
                                            ]}
                                            onPress={() => handleOptionToggle(question, optionIndex)}
                                            disabled={!canInteract || isSubmitting}
                                            activeOpacity={0.7}
                                        >
                                            {question.multiSelect ? (
                                                <View style={[
                                                    styles.checkboxOuter,
                                                    isSelected && styles.checkboxOuterSelected,
                                                ]}>
                                                    {isSelected && <Ionicons name="checkmark" size={14} color={theme.colors.button.primary.tint} />}
                                                </View>
                                            ) : (
                                                <View style={[
                                                    styles.radioOuter,
                                                    isSelected && styles.radioOuterSelected,
                                                ]}>
                                                    {isSelected && <View style={styles.radioInner} />}
                                                </View>
                                            )}
                                            <View style={styles.optionContent}>
                                                <Text style={styles.optionLabel}>{option.label}</Text>
                                                {option.description ? (
                                                    <Text style={styles.optionDescription}>{option.description}</Text>
                                                ) : null}
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                            {question.allowCustom !== false && (
                                <View style={styles.optionsContainer}>
                                    <Text style={[styles.optionLabel, styles.otherLabel]}>{t('tools.askUserQuestion.other')}</Text>
                                    <TextInput
                                        accessibilityLabel={t('tools.askUserQuestion.other') + ': ' + question.header}
                                        placeholder={t('tools.askUserQuestion.otherPlaceholder')}
                                        placeholderTextColor={theme.colors.textSecondary}
                                        style={styles.customInput}
                                        value={customAnswers[question.id] ?? ''}
                                        editable={canInteract && !isSubmitting}
                                        secureTextEntry={question.isSecret === true}
                                        onChangeText={text => {
                                            if (!canInteract || inFlight.current) return;
                                            setCustomAnswers(previous => ({ ...previous, [question.id]: text }));
                                            if (!question.multiSelect && text.trim()) setSelections(previous => {
                                                const next = new Map(previous);
                                                next.delete(question.id);
                                                return next;
                                            });
                                        }}
                                    />
                                </View>
                            )}
                        </View>
                    );
                })}

                {submitFailed && (
                    <Text accessibilityRole="alert" style={styles.optionDescription}>{t('agentQuestion.submitFailed')}</Text>
                )}
                {canInteract && (
                    <View style={styles.actionsContainer}>
                        {onCancel && (
                            <TouchableOpacity
                                accessibilityRole="button"
                                style={[styles.submitButton, styles.cancelButton]}
                                disabled={isSubmitting}
                                onPress={() => { void send({}, true); }}
                            >
                                <Text style={[styles.submitButtonText, styles.cancelButtonText]}>{t('common.cancel')}</Text>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            accessibilityRole="button"
                            style={[
                                styles.submitButton,
                                allQuestionsAnswered && !isSubmitting && styles.submitButtonReady,
                                (!allQuestionsAnswered || isSubmitting) && styles.submitButtonDisabled,
                            ]}
                            onPress={handleSubmit}
                            disabled={!allQuestionsAnswered || isSubmitting}
                            activeOpacity={0.7}
                        >
                            {isSubmitting ? (
                                <ActivityIndicator
                                    size="small"
                                    color={Platform.select({ web: theme.colors.button.primary.tint, default: theme.colors.text })}
                                />
                            ) : (
                                <Text style={styles.submitButtonText}>{t('tools.askUserQuestion.submit')}</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </FormFrame>
    );
});

const styles = StyleSheet.create((theme) => ({
    webCard: {
        borderWidth: 1,
        borderColor: theme.colors.status.connecting,
        borderRadius: theme.kilv.radiusCard,
        backgroundColor: theme.colors.surfaceHigh,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginVertical: 2,
        _web: {
            boxShadow: `0 0 0 1px ${herdAlpha(theme.colors.status.connecting, 0.15)} inset, 0 0 30px ${herdAlpha(theme.colors.status.connecting, 0.07)}`,
        },
    },
    webCardEntrance: {
        _web: {
            _classNames: herdWebClasses('herd-sheet'),
        },
    },
    webCardAnswered: {
        borderColor: theme.colors.divider,
        paddingVertical: 12,
        _web: {
            boxShadow: 'none',
        },
    },
    customInput: {
        borderWidth: 1,
        borderColor: theme.colors.divider,
        borderRadius: theme.borderRadius.md,
        padding: 12,
        fontSize: 16,
        color: theme.colors.text,
        minHeight: 44,
        backgroundColor: Platform.select({ web: theme.colors.input.background, default: undefined }),
        ...Typography.default(),
    },
    container: { gap: 16 },
    questionSection: { gap: 8 },
    headerChip: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: Platform.select({ web: 'transparent', default: theme.colors.surfaceHighest }),
        borderWidth: Platform.select({ web: 1, default: 0 }),
        borderColor: herdAlpha(theme.colors.status.connecting, 0.45),
        paddingHorizontal: 8,
        paddingVertical: Platform.select({ web: 2, default: 4 }),
        borderRadius: theme.borderRadius.sm,
        marginBottom: 4,
    },
    headerText: {
        fontSize: Platform.select({ web: 11.5, default: 12 }),
        fontWeight: Platform.select({ web: '400', default: '600' }),
        color: Platform.select({ web: theme.colors.status.connecting, default: theme.colors.textSecondary }),
        textTransform: Platform.select({ web: 'none', default: 'uppercase' }),
        ...(Platform.OS === 'web' ? Typography.mono() : {}),
    },
    questionText: {
        fontSize: Platform.select({ web: 16, default: 15 }),
        fontWeight: '500',
        color: theme.colors.text,
        marginBottom: 8,
        ...(Platform.OS === 'web' ? Typography.default('semiBold') : {}),
    },
    optionsContainer: { gap: Platform.select({ web: 8, default: 4 }) },
    optionEntrance: (index: number) => ({
        _web: {
            _classNames: herdWebClasses('herd-rise-sm', herdStaggerClass(index)),
        },
    }),
    optionButton: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: Platform.select({ web: 9, default: 12 }),
        paddingHorizontal: Platform.select({ web: 13, default: 12 }),
        borderRadius: theme.borderRadius.md,
        backgroundColor: Platform.select({ web: theme.colors.groupped.background, default: theme.colors.surface }),
        borderWidth: 1,
        borderColor: theme.colors.divider,
        gap: Platform.select({ web: 12, default: 10 }),
        minHeight: 44,
        _web: {
            transition: `border-color ${theme.kilv.motionFast}ms ${theme.kilv.easeOut}, background-color ${theme.kilv.motionFast}ms ${theme.kilv.easeOut}, box-shadow ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}`,
        },
    },
    optionButtonSelected: {
        backgroundColor: Platform.select({ web: theme.colors.selection.background, default: theme.colors.surfaceHighest }),
        borderColor: Platform.select({ web: theme.colors.selection.border, default: theme.colors.radio.active }),
        _web: {
            boxShadow: theme.colors.selection.ring,
        },
    },
    optionButtonDisabled: { opacity: 0.6 },
    radioOuter: {
        width: Platform.select({ web: 18, default: 20 }),
        height: Platform.select({ web: 18, default: 20 }),
        borderRadius: Platform.select({ web: theme.kilv.radiusPill, default: theme.borderRadius.sm }),
        borderWidth: 2,
        borderColor: Platform.select({ web: theme.colors.kilv.rimLine, default: theme.colors.textSecondary }),
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    radioOuterSelected: { borderColor: theme.colors.radio.active },
    radioInner: {
        width: Platform.select({ web: 8, default: 10 }),
        height: Platform.select({ web: 8, default: 10 }),
        borderRadius: Platform.select({ web: theme.kilv.radiusPill, default: theme.borderRadius.sm }),
        backgroundColor: theme.colors.radio.dot,
    },
    checkboxOuter: {
        width: 20, height: 20, borderRadius: theme.borderRadius.sm, borderWidth: 2,
        borderColor: Platform.select({ web: theme.colors.kilv.rimLine, default: theme.colors.textSecondary }),
        alignItems: 'center', justifyContent: 'center', marginTop: 2,
    },
    checkboxOuterSelected: { borderColor: theme.colors.radio.active, backgroundColor: theme.colors.radio.active },
    optionContent: { flex: 1 },
    optionLabel: { fontSize: Platform.select({ web: 14.5, default: 14 }), fontWeight: '500', color: theme.colors.text },
    otherLabel: {
        fontSize: Platform.select({ web: 13, default: 14 }),
        color: Platform.select({ web: theme.colors.textSecondary, default: theme.colors.text }),
    },
    optionDescription: { fontSize: 13, color: Platform.select({ web: theme.colors.kilv.inkFaint, default: theme.colors.textSecondary }), marginTop: 2 },
    actionsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: Platform.select({ web: 8, default: 12 }), marginTop: 8, justifyContent: 'flex-end' },
    submitButton: {
        backgroundColor: Platform.select({ web: theme.colors.button.primary.background, default: theme.colors.surfaceHighest }),
        borderWidth: Platform.select({ web: 0, default: 1 }),
        borderColor: theme.colors.divider,
        paddingHorizontal: Platform.select({ web: 16, default: 20 }),
        paddingVertical: Platform.select({ web: 10, default: 12 }),
        borderRadius: theme.borderRadius.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: Platform.select({ web: 40, default: 44 }),
    },
    // Web Cancel is a quiet outlined button beside the molten Submit.
    cancelButton: {
        backgroundColor: Platform.select({ web: 'transparent', default: theme.colors.surfaceHighest }),
        borderWidth: 1,
        borderColor: Platform.select({ web: theme.colors.kilv.rimLine, default: theme.colors.divider }),
    },
    cancelButtonText: {
        color: Platform.select({ web: theme.colors.text, default: theme.colors.text }),
    },
    submitButtonDisabled: { opacity: 0.5 },
    submitButtonReady: { borderColor: theme.colors.radio.active },
    submitButtonText: {
        color: Platform.select({ web: theme.colors.button.primary.tint, default: theme.colors.text }),
        fontSize: 14,
        fontWeight: '600',
    },
    submittedContainer: { gap: 8 },
    submittedItem: { flexDirection: 'row', gap: 8 },
    submittedHeader: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    submittedValue: { fontSize: 13, color: theme.colors.text, flex: 1 },
}));
