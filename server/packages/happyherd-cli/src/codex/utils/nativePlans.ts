import { createHash } from 'node:crypto';
import { createEnvelope, type SessionEnvelope } from '@slopus/happy-wire';
import { readPlanEntries } from '@/sessionProtocol/planEntries';

/** Native plan bodies are content, not ExitPlanMode permission requests. */
export function codexPlanBody(turn: string, item: { id: string; text: unknown }, time: number, completed = true): SessionEnvelope[] {
    const call = `${turn}:${item.id}:plan`;
    const opts = { turn, time };
    const digest = createHash('sha256').update(JSON.stringify(item.text) ?? 'null').digest('hex').slice(0, 16);
    return [
        createEnvelope('agent', {
            t: 'tool-call-start', call, name: 'CodexPlan', title: 'plan', description: 'plan',
            args: typeof item.text === 'string' ? { plan: item.text } : { item },
        }, { ...opts, id: `${call}:${completed ? 'final' : digest}` }),
        ...(completed ? [createEnvelope('agent', { t: 'tool-call-end', call }, { ...opts, id: `${call}:end`, time: time + 1 })] : []),
    ];
}

export function codexPlanSnapshot(message: Record<string, unknown>, time: number): SessionEnvelope[] {
    if (typeof message.turnId !== 'string') return [];
    const entries = Array.isArray(message.plan) ? message.plan.map(step => {
        if (!step || typeof step !== 'object') return step;
        return { content: step.step, status: step.status === 'inProgress' ? 'in_progress' : step.status };
    }) : undefined;
    const todos = readPlanEntries({ entries });
    const call = typeof message.snapshotId === 'string' ? message.snapshotId : `${message.turnId}:plan:${time}`;
    return [
        createEnvelope('agent', {
            t: 'tool-call-start', call, name: todos === null ? 'CodexPlan' : 'TodoWrite',
            title: 'plan', description: 'plan', args: todos === null ? { payload: message } : { todos },
        }, { id: `${call}:start`, turn: message.turnId, time }),
        createEnvelope('agent', { t: 'tool-call-end', call, ...(todos === null ? {} : { result: { newTodos: todos } }) },
            { id: `${call}:end`, turn: message.turnId, time: time + 1 }),
    ];
}
