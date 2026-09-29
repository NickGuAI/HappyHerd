import { describe, expect, it } from 'vitest';
import { normalizeSubagentRecords, replaySubagentRecords, subagentLifecycleFixture } from '../__testdata__/subagentLifecycle';
import type { Message, ToolCallMessage } from '../typesMessage';
import { createReducer, reducer } from './reducer';

function childCard(messages: Message[], child: string): ToolCallMessage {
    const card = messages.find((message): message is ToolCallMessage => (
        message.kind === 'tool-call' && message.tool.name === 'Subagent' && message.tool.callId === child
    ));
    expect(card).toBeDefined();
    return card!;
}

// Reducer row ids are ephemeral; provider call ids, content and timestamps survive replay.
const activity = (card: ToolCallMessage) => card.children.map(({ id: _id, ...message }) => message);

describe('background subagent wire lifecycle', () => {
    it('keeps the child running across parent completion, later activity and reconnect replay', () => {
        const fixture = subagentLifecycleFixture();
        const state = createReducer();
        const messages = new Map<string, Message>();
        for (const batch of [fixture.start, fixture.parentFinished, fixture.continuedActivity]) {
            const normalized = normalizeSubagentRecords(batch);
            expect(normalized).toHaveLength(batch.length);
            for (const message of reducer(state, normalized).messages) messages.set(message.id, message);
            expect(childCard([...messages.values()], fixture.child).tool).toMatchObject({
                state: 'running', completedAt: null,
            });
        }
        const card = childCard([...messages.values()], fixture.child);
        expect(card.tool.result).toBeUndefined();
        expect(card.children).toHaveLength(3);
        expect(card.children).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'agent-text', text: 'Still working after the parent turn' }),
            expect.objectContaining({ kind: 'tool-call', tool: expect.objectContaining({ name: 'Read', state: 'completed' }) }),
        ]));
        const replay = childCard(replaySubagentRecords(fixture.running), fixture.child);
        expect(replay.tool).toEqual(card.tool);
        expect(activity(replay)).toEqual(activity(card));
        expect(reducer(state, normalizeSubagentRecords(fixture.running)).messages).toEqual([]);
    });

    it.each(['completed', 'failed', 'cancelled'] as const)('applies only the matching child’s authoritative %s outcome and preserves activity on replay', (status) => {
        const fixture = subagentLifecycleFixture();
        const terminal = fixture.terminal(status);
        const normalized = normalizeSubagentRecords([terminal]);
        expect(normalized[0]).toMatchObject({
            isSidechain: false,
            content: [expect.objectContaining({
                type: 'tool-result', tool_use_id: fixture.child, authoritative: true,
                content: expect.objectContaining({ status }), is_error: status === 'failed',
            })],
        });

        const running = childCard(replaySubagentRecords(fixture.running), fixture.child);
        for (const records of [[...fixture.running, terminal], [terminal, ...fixture.running]]) {
            const messages = replaySubagentRecords(records);
            const card = childCard(messages, fixture.child);
            expect(card.tool).toMatchObject({
                state: status === 'failed' ? 'error' : 'completed',
                result: { status }, resultAuthoritative: true, completedAt: terminal.content.data.time,
            });
            expect(activity(card)).toEqual(activity(running));
            expect(childCard(messages, fixture.sibling).tool.state).toBe('running');
        }
    });
});
