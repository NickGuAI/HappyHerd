import * as React from 'react';

import { sessionAnswerQuestion, sessionCancelCommunication } from '@/sync/ops';
import { useSessionAgentFormCommunication } from '@/sync/storage';
import type { AgentQuestionAnswer } from '@/sync/storageTypes';
import { ToolViewProps } from './_all';
import { InlineQuestionForm, type InlineQuestionAnswers } from './InlineQuestionForm';

/** Inline renderer for Happy/Codex request_user_input communications. */
export const RequestUserInputView = React.memo<ToolViewProps>(({ tool, sessionId }) => {
    const communication = useSessionAgentFormCommunication(sessionId ?? '', tool.callId ?? '');

    const submittedAnswers = React.useMemo<InlineQuestionAnswers | null>(() => {
        if (!communication || communication.status === 'pending') return null;
        if (communication.status === 'cancelled' || !communication.answers) return {};
        const answers: InlineQuestionAnswers = {};
        for (const [questionId, answer] of Object.entries(communication.answers)) {
            const values = [...answer.options];
            if (answer.custom) values.push(answer.custom);
            answers[questionId] = values;
        }
        return answers;
    }, [communication]);

    const handleSubmit = React.useCallback(async (answers: InlineQuestionAnswers) => {
        if (!sessionId || !communication || communication.status !== 'pending') {
            throw new Error('Question is no longer pending');
        }
        const communicationAnswers: Record<string, AgentQuestionAnswer> = {};
        for (const question of communication.questions) {
            const selected = answers[question.id];
            if (!selected?.length) continue;
            const labels = new Set(question.options.map(option => option.label));
            const options = selected.filter(value => labels.has(value));
            const custom = selected.filter(value => !labels.has(value)).join('\n');
            communicationAnswers[question.id] = {
                options: question.multiSelect ? options : options.slice(0, 1),
                ...(custom && question.allowCustom !== false ? { custom } : {}),
            };
        }
        await sessionAnswerQuestion(sessionId, communication.id, communicationAnswers, communication.kind);
    }, [communication, sessionId]);

    const handleCancel = React.useCallback(async () => {
        if (!sessionId || !communication || communication.status !== 'pending') {
            throw new Error('Question is no longer pending');
        }
        await sessionCancelCommunication(sessionId, communication.id, communication.kind);
    }, [communication, sessionId]);

    // ToolView preserves the generic payload until a form can actually own it.
    if (!communication) return null;

    return (
        <InlineQuestionForm
            key={communication.id}
            questions={communication.questions}
            canInteract={tool.state === 'running' && communication.status === 'pending'}
            submittedAnswers={submittedAnswers}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
        />
    );
});
