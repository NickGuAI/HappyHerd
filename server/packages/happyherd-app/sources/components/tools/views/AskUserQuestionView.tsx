import * as React from 'react';

import { sessionAllow, sessionDeny } from '@/sync/ops';
import { useSession } from '@/sync/storage';
import { ToolViewProps } from './_all';
import { InlineQuestionForm, type InlineQuestionAnswers } from './InlineQuestionForm';
import { readClaudeAnswers, readClaudeQuestions } from './questionPresentation';

export const AskUserQuestionView = React.memo<ToolViewProps>(({ tool, sessionId }) => {
    const session = useSession(sessionId ?? '');
    const questions = React.useMemo(() => readClaudeQuestions(tool.input), [tool.input]);
    const permissionId = tool.permission?.id;
    const canInteract = Boolean(sessionId && permissionId
        && tool.state === 'running' && tool.permission?.status === 'pending');
    const completedArguments = permissionId
        ? session?.agentState?.completedRequests?.[permissionId]?.arguments
        : undefined;
    const submittedAnswers = React.useMemo(() => {
        if (!questions) return undefined;
        if (tool.permission?.status === 'denied' || tool.permission?.status === 'canceled') return {};
        // The native permission receipt keeps answers across reloads. Do not
        // overwrite a successful local submission with an empty completed form.
        return readClaudeAnswers(questions, completedArguments, tool.result, tool.input) ?? undefined;
    }, [questions, completedArguments, tool.result, tool.input, tool.permission?.status]);

    const handleSubmit = React.useCallback(async (answers: InlineQuestionAnswers) => {
        if (!sessionId || !permissionId || !canInteract || !questions) {
            throw new Error('Question is no longer pending');
        }
        const providerAnswers: Record<string, string> = {};
        for (const question of questions) {
            const selected = answers[question.id];
            if (selected?.length) providerAnswers[question.question] = selected.join(', ');
        }
        // Claude expects the exact original question text as each answer key.
        // Its callback merges these answers into the original tool input.
        await sessionAllow(sessionId, permissionId, undefined, undefined, 'approved', { answers: providerAnswers });
    }, [questions, sessionId, permissionId, canInteract]);

    const handleCancel = React.useCallback(async () => {
        if (!sessionId || !permissionId || !canInteract) throw new Error('Question is no longer pending');
        await sessionDeny(sessionId, permissionId, undefined, undefined, 'denied');
    }, [sessionId, permissionId, canInteract]);

    if (!questions) return null; // ToolView selects the generic fallback instead.

    return (
        <InlineQuestionForm
            key={tool.callId ?? permissionId}
            questions={questions}
            canInteract={canInteract}
            submittedAnswers={submittedAnswers}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
        />
    );
});
