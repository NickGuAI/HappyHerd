import { describe, expect, it } from 'vitest';
import type { RawJSONLines } from '../types';
import { SDKToLogConverter } from './sdkToLogConverter';
import { closeClaudeTurnWithStatus, mapClaudeLogMessageToSessionEnvelopes, type ClaudeSessionProtocolState } from './sessionProtocolMapper';

function launch(id = 'agent-call', background = true) {
    return { type: 'assistant', uuid: `launch-${id}`, message: { content: [{
        type: 'tool_use', id, name: 'Agent', input: { description: id, prompt: 'Inspect the workspace', run_in_background: background },
    }] } };
}
function ack(id = 'agent-call', taskId = 'task-1') {
    return { type: 'user', uuid: `ack-${id}`, tool_use_result: {
        status: 'async_launched', isAsync: true, agentId: taskId,
        description: id, prompt: 'Inspect the workspace', outputFile: '/tmp/task.output',
    }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Agent launched successfully.' }] } };
}
function lifecycle(subtype: string, extra: Record<string, unknown> = {}) {
    return { type: 'system', uuid: `${subtype}-${JSON.stringify(extra)}`, subtype, task_id: 'task-1', ...extra };
}
function map(state: ClaudeSessionProtocolState, row: unknown) {
    return mapClaudeLogMessageToSessionEnvelopes(row as RawJSONLines, state).envelopes;
}

describe('Claude background child lifecycle (#344)', () => {
    it('preserves the SDK structured launch result before mapping it', () => {
        const converter = new SDKToLogConverter({ sessionId: 'session', cwd: '/tmp', version: 'test', gitBranch: 'main' });
        const row = ack();
        expect(converter.convert(row as any)).toMatchObject({ tool_use_result: row.tool_use_result });
    });

    it.each(['completed', 'failed', 'stopped'] as const)('keeps Running through launch return and parent end until %s', (status) => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        const start = map(state, launch()).find(e => e.ev.t === 'start')!;
        map(state, lifecycle('task_started', { tool_use_id: 'agent-call', task_type: 'local_agent', is_backgrounded: true }));
        expect(map(state, ack())).toEqual([]);
        expect(closeClaudeTurnWithStatus(state, 'completed').envelopes.map(e => e.ev.t)).toEqual(['turn-end']);
        const progress = map(state, lifecycle('task_progress', { description: 'Reading files', summary: 'Still inspecting files' }));
        expect(progress).toEqual([expect.objectContaining({ turn: start.turn, subagent: start.subagent, ev: { t: 'text', text: 'Still inspecting files' } })]);
        expect(state.currentTurnId).toBeNull();
        const notification = lifecycle('task_notification', { status, summary: 'Child outcome', output_file: '/tmp/task.output' });
        expect(map(state, notification)).toEqual([expect.objectContaining({
            turn: start.turn, subagent: start.subagent,
            ev: { t: 'stop', status: status === 'stopped' ? 'cancelled' : status, authoritative: true, detail: 'Child outcome' },
        })]);
        expect(map(state, notification)).toEqual([]);
        expect(map(state, ack())).toEqual([]);
    });

    it('correlates an out-of-order notification by task ID when the launch receipt arrives later', () => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        const start = map(state, launch()).find(e => e.ev.t === 'start')!;
        expect(map(state, lifecycle('task_notification', { status: 'failed', summary: 'Child failed' }))).toEqual([]);
        expect(map(state, ack())).toEqual([expect.objectContaining({ subagent: start.subagent, ev: { t: 'stop', status: 'failed', authoritative: true, detail: 'Child failed' } })]);
    });

    it('buffers task events until their Agent descriptor and keeps unrelated tasks out of cards', () => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        expect(map(state, lifecycle('task_started', { tool_use_id: 'agent-call', is_backgrounded: true }))).toEqual([]);
        expect(map(state, lifecycle('task_progress', { summary: 'Child is working' }))).toEqual([]);
        const events = map(state, launch());
        const start = events.find(e => e.ev.t === 'start')!;
        expect(events).toContainEqual(expect.objectContaining({ subagent: start.subagent, ev: { t: 'text', text: 'Child is working' } }));
        const bash = { type: 'assistant', uuid: 'bash', message: { content: [{ type: 'tool_use', id: 'bash-call', name: 'Bash', input: { command: 'echo hi' } }] } };
        map(state, bash);
        expect(map(state, lifecycle('task_started', { task_id: 'bash-task', tool_use_id: 'bash-call', task_type: 'local_bash' }))).toEqual([]);
        expect(map(state, lifecycle('task_notification', { task_id: 'bash-task', status: 'completed', summary: 'done' }))).toEqual([]);
    });

    it('handles foreground agents moved to the background without replacing the original turn', () => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        const start = map(state, launch('agent-call', false)).find(e => e.ev.t === 'start')!;
        map(state, lifecycle('task_started', { tool_use_id: 'agent-call', is_backgrounded: false }));
        map(state, lifecycle('task_updated', { patch: { is_backgrounded: true } }));
        const receipt = ack();
        delete (receipt as any).tool_use_result;
        expect(map(state, receipt)).toEqual([]);
        expect(closeClaudeTurnWithStatus(state, 'completed').envelopes.map(e => e.ev.t)).toEqual(['turn-end']);
        map(state, launch('other-agent'));
        const terminal = map(state, lifecycle('task_notification', { status: 'completed', summary: 'done' }));
        expect(terminal[0]).toMatchObject({ turn: start.turn, subagent: start.subagent });
        expect(state.currentTurnId).not.toBe(start.turn);
    });

    it('replays stable child association and activity across a parent boundary', () => {
        const replay = () => {
            const state: ClaudeSessionProtocolState = { currentTurnId: null };
            return [launch(), ack(), { type: 'user', uuid: 'next-user', message: { content: 'Next turn' } },
                lifecycle('task_progress', { summary: 'Still working' }),
                lifecycle('task_notification', { status: 'completed', summary: 'done' }),
            ].flatMap(row => map(state, row));
        };
        const first = replay();
        const second = replay();
        expect(second.filter(e => ['start', 'stop'].includes(e.ev.t))).toMatchObject(first.filter(e => ['start', 'stop'].includes(e.ev.t)).map(({ id, turn, subagent, ev }) => ({ id, turn, subagent, ev })));
        expect(first.filter(e => e.ev.t === 'stop')).toHaveLength(1);
        expect(first.find(e => e.ev.t === 'text' && e.ev.text === 'Still working')?.subagent).toBe(first.find(e => e.ev.t === 'start')?.subagent);
    });

    it.each(['completed', 'failed', 'killed'])('replays native JSONL launch and meta task notification: %s', (status) => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        const start = map(state, launch('agent-call', false)).find(e => e.ev.t === 'start')!;
        const { tool_use_result, ...receipt } = ack();
        expect(map(state, { ...receipt, toolUseResult: tool_use_result })).toEqual([]);
        expect(closeClaudeTurnWithStatus(state, 'completed').envelopes.map(e => e.ev.t)).toEqual(['turn-end']);
        const content = `[SYSTEM NOTIFICATION - NOT USER INPUT]\n<task-notification>\n<task-id>task-1</task-id>\n<status>${status}</status>\n<summary>Native child outcome</summary>\n</task-notification>`;
        const notification = { type: 'user', uuid: 'native-notification', isMeta: true, origin: { kind: 'task-notification' }, message: { content: [{ type: 'text', text: content }] } };
        expect(map(state, notification)).toEqual([expect.objectContaining({ turn: start.turn, subagent: start.subagent,
            ev: { t: 'stop', status: status === 'killed' ? 'cancelled' : status, authoritative: true, detail: 'Native child outcome' },
        })]);
        expect(map(state, notification)).toEqual([]);
    });

    it('uses a launch failure as failure, but does not infer completion from background input alone', () => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        map(state, launch());
        const failure = ack();
        delete (failure as any).tool_use_result;
        Object.assign(failure.message.content[0], { is_error: true, content: 'Could not launch child' });
        expect(map(state, failure)[0].ev).toEqual({ t: 'stop', status: 'failed', authoritative: true, detail: 'Could not launch child' });
    });

    it('correlates a remote launch and a resumed task ID with each distinct call', () => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        const first = map(state, launch()).find(e => e.ev.t === 'start')!;
        expect(map(state, { ...ack(), tool_use_result: { status: 'remote_launched', taskId: 'task-1' } })).toEqual([]);
        map(state, lifecycle('task_notification', { status: 'completed', summary: 'First outcome' }));
        const resumed = map(state, launch('resume-call')).find(e => e.ev.t === 'start')!;
        expect(resumed.subagent).not.toBe(first.subagent);
        map(state, lifecycle('task_started', { tool_use_id: 'resume-call', is_backgrounded: true }));
        expect(map(state, ack('resume-call'))).toEqual([]);
        expect(map(state, lifecycle('task_notification', { status: 'failed', summary: 'Resumed outcome' }))[0])
            .toMatchObject({ subagent: resumed.subagent, ev: { t: 'stop', status: 'failed' } });
    });

    it('retains late activity without reopening a terminal child or letting a result replace its failure', () => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        map(state, launch());
        map(state, lifecycle('task_notification', { tool_use_id: 'agent-call', status: 'failed', summary: 'failed' }));
        const progress = map(state, lifecycle('task_progress', { description: 'Earlier child activity' }));
        expect(progress[0].ev).toEqual({ t: 'text', text: 'Earlier child activity' });
        expect(map(state, { ...ack(), tool_use_result: { status: 'completed', agentId: 'task-1' } })).toEqual([]);
        expect([...state.subagentStops!.values()]).toEqual([{ status: 'failed', authoritative: true }]);
    });

    it('decodes native notification summaries without treating ordinary user text as lifecycle', () => {
        const state: ClaudeSessionProtocolState = { currentTurnId: null };
        map(state, launch());
        map(state, ack());
        const notification = { type: 'user', uuid: 'encoded-native', isMeta: true, message: {
            content: '<task-notification><task-id>task-1</task-id><status>failed</status><summary>A &lt; B &amp; C</summary></task-notification>',
        } };
        expect(map(state, notification)[0].ev).toMatchObject({ t: 'stop', status: 'failed', detail: 'A < B & C' });
        expect(map({ currentTurnId: null }, { ...notification, isMeta: false }).some(e => e.ev.t === 'stop')).toBe(false);
    });
});
