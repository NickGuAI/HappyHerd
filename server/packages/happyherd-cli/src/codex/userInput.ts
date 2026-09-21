import { createEnvelope } from '@happyherd/wire';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentCommunication, AgentQuestion, AgentQuestionAnswer } from '@/api/types';
import type { CodexAppServerClient, NativeUserInputRequest } from './codexAppServerClient';

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Codex 0.154 app-server ToolRequestUserInputQuestion, not an approval. */
export function readCodexQuestions(params: Record<string, unknown>): AgentQuestion[] | null {
    if (!Array.isArray(params.questions) || !params.questions.length) return null;
    const questions: AgentQuestion[] = [];
    const ids = new Set<string>();
    for (const q of params.questions) {
        if (!record(q) || typeof q.id !== 'string' || !q.id || ids.has(q.id)
            || typeof q.header !== 'string' || typeof q.question !== 'string' || !q.question.trim()
            || typeof q.isOther !== 'boolean' || typeof q.isSecret !== 'boolean'
            || (q.options !== null && !Array.isArray(q.options))) return null;
        const options: AgentQuestion['options'] = [];
        for (const option of q.options ?? []) {
            if (!record(option) || typeof option.label !== 'string' || !option.label
                || typeof option.description !== 'string') return null;
            options.push({ label: option.label, description: option.description });
        }
        ids.add(q.id);
        questions.push({ id: q.id, header: q.header, question: q.question, options, allowCustom: q.isOther || !options.length, isSecret: q.isSecret });
    }
    return questions;
}

export function registerCodexUserInput(client: Pick<CodexAppServerClient, 'setUserInputHandler'>,
    session: Pick<ApiSessionClient, 'updateAgentState' | 'sendSessionProtocolMessage'> & {
        rpcHandlerManager: Pick<ApiSessionClient['rpcHandlerManager'], 'registerHandler'>;
    }): void {
    const pending = new Map<string, { request: NativeUserInputRequest; communication: AgentCommunication }>();
    // A new runtime cannot answer requests retained from an earlier process.
    session.updateAgentState(state => {
        const completedCommunications = { ...state.completedCommunications };
        for (const [id, communication] of Object.entries(state.communications ?? {})) {
            completedCommunications[id] = { ...communication, completedAt: Date.now(), status: 'cancelled' };
        }
        return { ...state, communications: {}, completedCommunications };
    });

    const complete = async (id: string, status: 'answered' | 'cancelled', answers?: Record<string, AgentQuestionAnswer>) => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        const persisted = session.updateAgentState(state => {
            const communications = { ...state.communications };
            delete communications[id];
            return { ...state, communications, completedCommunications: {
                ...state.completedCommunications,
                [id]: { ...entry.communication, completedAt: Date.now(), status, ...(answers ? { answers } : {}) },
            } };
        });
        session.sendSessionProtocolMessage(createEnvelope('agent', {
            t: 'tool-call-end', call: id, result: { status, ...(answers ? { answers } : {}) },
        }, { id: `${id}:end`, turn: entry.request.params.turnId as string }));
        await persisted;
    };

    client.setUserInputHandler(request => {
        const questions = readCodexQuestions(request.params);
        const scoped = typeof request.params.threadId === 'string' && typeof request.params.turnId === 'string'
            && typeof request.params.itemId === 'string';
        const communication: AgentCommunication = {
            kind: questions && scoped ? 'form' : 'codex-unsupported-input',
            createdAt: Date.now(), toolUseId: request.id,
            ...(questions && scoped ? { form: { questions } } : {}),
        };
        pending.set(request.id, { request, communication });
        // Publish the transcript anchor before making the form actionable.
        session.sendSessionProtocolMessage(createEnvelope('agent', {
            t: 'tool-call-start', call: request.id, name: 'request_user_input',
            title: 'request_user_input', description: 'request_user_input',
            args: request.params,
        }, { id: `${request.id}:start`, turn: typeof request.params.turnId === 'string' ? request.params.turnId : request.id }));
        session.updateAgentState(state => ({ ...state, communications: { ...state.communications, [request.id]: communication } }));
        request.signal.addEventListener('abort', () => complete(request.id, 'cancelled'), { once: true });
        if (request.signal.aborted) complete(request.id, 'cancelled');
    });

    session.rpcHandlerManager.registerHandler('communication', async (reply: Record<string, unknown>) => {
        const id = typeof reply.id === 'string' ? reply.id : '';
        const entry = pending.get(id);
        if (!entry || entry.request.signal.aborted) throw new Error('Codex question is no longer pending');
        if (reply.kind !== entry.communication.kind) throw new Error('Question kind does not match');
        if (reply.status === 'cancelled') {
            entry.request.respond({});
            await complete(id, 'cancelled');
            return;
        }
        if (reply.status !== 'answered' || !entry.communication.form || !record(reply.answers)) {
            throw new Error('Unsupported question response');
        }
        const answers: Record<string, AgentQuestionAnswer> = {};
        const nativeAnswers: Record<string, { answers: string[] }> = {};
        for (const question of entry.communication.form.questions) {
            const answer = reply.answers[question.id];
            if (!record(answer) || !Array.isArray(answer.options)
                || answer.options.some(value => typeof value !== 'string' || !question.options.some(option => option.label === value))
                || answer.options.length > 1
                || (answer.custom != null && (typeof answer.custom !== 'string' || !question.allowCustom))) {
                throw new Error('Invalid question answer');
            }
            const custom = typeof answer.custom === 'string' ? answer.custom.trim() : '';
            const values = [...answer.options as string[], ...(custom ? [custom] : [])];
            if (!values.length) throw new Error('Missing question answer');
            Object.defineProperty(answers, question.id, { enumerable: true, value: { options: answer.options, ...(custom ? { custom } : {}) } });
            Object.defineProperty(nativeAnswers, question.id, { enumerable: true, value: { answers: values } });
        }
        entry.request.respond(nativeAnswers);
        await complete(id, 'answered', answers);
    });
}
