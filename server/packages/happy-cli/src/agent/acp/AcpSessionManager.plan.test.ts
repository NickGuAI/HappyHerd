import { describe, expect, it, vi } from 'vitest';
import { AcpSessionManager } from './AcpSessionManager';
import { handlePlanUpdate, type HandlerContext } from './sessionUpdateHandlers';
import type { AgentMessage } from '@/agent/core';

vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/sessionProtocol/providerOutputImages', () => ({
    extractAcpContentImages: vi.fn(() => []),
    redactAcpImageDataForLogging: (value: unknown) => value,
}));

const entries = [
    { content: 'Inspect the failing test', status: 'completed', priority: 'high' },
    { content: 'Implement the fix', status: 'in_progress', priority: 'medium' },
    { content: 'Run regression checks', status: 'pending', priority: 'low' },
];

function nativePlan(update: Parameters<typeof handlePlanUpdate>[0]): AgentMessage[] {
    const messages: AgentMessage[] = [];
    const ctx: HandlerContext = {
        transport: { agentName: 'plan-fixture', getInitTimeout: () => 1_000, getToolPatterns: () => [] },
        activeToolCalls: new Set(),
        toolCallStartTimes: new Map(),
        toolCallTimeouts: new Map(),
        toolCallIdToNameMap: new Map(),
        toolCallDescriptors: new Map(),
        idleTimeout: null,
        toolCallCountSincePrompt: 0,
        emit: (message) => { messages.push(message); },
        emitIdleStatus: vi.fn(),
        clearIdleTimeout: vi.fn(),
        setIdleTimeout: vi.fn(),
    };
    expect(handlePlanUpdate(update, ctx)).toEqual({ handled: true });
    return messages;
}

describe('ACP native plan delivery', () => {
    it('admits the standard discriminated update, not only a legacy nested plan', () => {
        const update = { sessionUpdate: 'plan', entries };
        expect(nativePlan(update)).toEqual([{ type: 'event', name: 'plan', payload: update }]);
        expect(nativePlan({ plan: { entries } })).toEqual([
            { type: 'event', name: 'plan', payload: { entries } },
        ]);
    });

    it('emits a paired TodoWrite snapshot on the active turn after buffered output', () => {
        const mapper = new AcpSessionManager();
        const started = mapper.startTurn()[0];
        mapper.mapMessage({ type: 'model-output', textDelta: 'Here is the plan.' });
        const envelopes = nativePlan({ sessionUpdate: 'plan', entries })
            .flatMap(message => mapper.mapMessage(message));
        expect(envelopes).toHaveLength(3);
        expect(envelopes[0].ev).toEqual({ t: 'text', text: 'Here is the plan.' });
        expect(envelopes[1].ev).toMatchObject({
            t: 'tool-call-start', name: 'TodoWrite', args: { todos: entries },
        });
        expect(envelopes[2].ev).toMatchObject({ t: 'tool-call-end', result: { newTodos: entries } });
        if (envelopes[1].ev.t !== 'tool-call-start' || envelopes[2].ev.t !== 'tool-call-end') {
            throw new Error('Expected paired tool envelopes');
        }
        expect(envelopes[2].ev.call).toBe(envelopes[1].ev.call);
        expect(envelopes.every(envelope => envelope.turn === started.turn)).toBe(true);
        expect(envelopes[1].time).toBeGreaterThan(envelopes[0].time);
        expect(envelopes[2].time).toBeGreaterThan(envelopes[1].time);
    });

    it('replaces rather than merges successive snapshots and forwards empty clears', () => {
        const mapper = new AcpSessionManager();
        mapper.startTurn();
        const snapshots = [entries, [entries[2]], []];
        const calls: string[] = [];
        for (const snapshot of snapshots) {
            const envelopes = mapper.mapMessage({ type: 'event', name: 'plan', payload: { entries: snapshot } });
            expect(envelopes).toHaveLength(2);
            expect(envelopes[0].ev).toMatchObject({ args: { todos: snapshot } });
            expect(envelopes[1].ev).toMatchObject({ result: { newTodos: snapshot } });
            if (envelopes[0].ev.t === 'tool-call-start') calls.push(envelopes[0].ev.call);
        }
        expect(new Set(calls).size).toBe(3);
    });

    it('does not invent a turn for pre-turn or post-turn plan updates', () => {
        const mapper = new AcpSessionManager();
        const message: AgentMessage = { type: 'event', name: 'plan', payload: { entries } };
        expect(mapper.mapMessage(message)).toEqual([]);
        mapper.startTurn();
        mapper.endTurn('completed');
        expect(mapper.mapMessage(message)).toEqual([]);
    });

    it('does not turn malformed plan snapshots into an empty replacement', () => {
        const mapper = new AcpSessionManager();
        mapper.startTurn();
        mapper.mapMessage({ type: 'model-output', textDelta: 'Keep this output.' });
        for (const payload of [null, {}, { entries: null }, { entries: [null] },
            { entries: [{ content: 'Bad state', status: 'inProgress' }] }]) {
            expect(mapper.mapMessage({ type: 'event', name: 'plan', payload })).toEqual([]);
        }
        expect(mapper.endTurn('completed')[0].ev).toEqual({ t: 'text', text: 'Keep this output.' });
    });
});
