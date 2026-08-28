import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createId, isCuid } from '@paralleldrive/cuid2';
import { RawJSONLinesSchema } from '../types';
import {
    closeClaudeTurnWithStatus,
    mapClaudeLogMessageToSessionEnvelopes,
} from './sessionProtocolMapper';

describe('mapClaudeLogMessageToSessionEnvelopes', () => {
    it('maps user text to a user text envelope', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-1',
            message: {
                role: 'user',
                content: 'hello from user',
            },
            timestamp: '2025-01-01T00:00:00.000Z',
        } as any, { currentTurnId: null });

        expect(result.currentTurnId).toBeNull();
        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].role).toBe('user');
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'hello from user' });
    });

    it('maps non-tool user array text to user text without opening an agent turn', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-array-1',
            isSidechain: false,
            message: {
                role: 'user',
                content: [
                    { type: 'text', text: 'look at this image' },
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: 'iVBORw0KGgo=',
                        },
                    },
                ],
            },
            timestamp: '2025-01-01T00:00:00.000Z',
        } as any, { currentTurnId: null });

        expect(result.currentTurnId).toBeNull();
        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].role).toBe('user');
        expect(result.envelopes[0].turn).toBeUndefined();
        expect(result.envelopes[0].ev).toEqual({ t: 'text', text: 'look at this image' });
    });

    it('starts a turn and maps assistant text blocks', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-1',
            message: {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'working...' },
                    { type: 'thinking', thinking: 'internal' },
                ],
            },
            timestamp: '2025-01-01T00:00:01.000Z',
        } as any, { currentTurnId: null });

        expect(result.currentTurnId).not.toBeNull();
        expect(result.envelopes).toHaveLength(3);
        expect(result.envelopes[0].ev.t).toBe('turn-start');
        expect(result.envelopes[1].ev).toEqual({ t: 'text', text: 'working...' });
        expect(result.envelopes[2].ev).toEqual({ t: 'text', text: 'internal', thinking: true });
    });

    it('carries Claude usage on the last assistant content envelope', () => {
        const usage = {
            input_tokens: 1200,
            cache_creation_input_tokens: 40,
            cache_read_input_tokens: 500,
            output_tokens: 80,
        };
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-usage-1',
            message: {
                role: 'assistant',
                usage,
                content: [
                    { type: 'text', text: 'working...' },
                    { type: 'thinking', thinking: 'internal' },
                ],
            },
            timestamp: '2025-01-01T00:00:01.000Z',
        } as any, { currentTurnId: null });

        expect(result.envelopes).toHaveLength(3);
        expect(result.envelopes[0].ev.t).toBe('turn-start');
        expect(result.envelopes[0]).not.toHaveProperty('usage');
        expect(result.envelopes[1]).not.toHaveProperty('usage');
        expect(result.envelopes[2]).toMatchObject({ usage });
    });

    it('normalizes a synthetic API error null service tier before emitting an envelope', () => {
        const message = RawJSONLinesSchema.parse({
            type: 'assistant',
            uuid: 'a-api-error-1',
            message: {
                model: '<synthetic>',
                content: [{ type: 'text', text: "You've hit your limit" }],
                usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                    service_tier: null,
                },
            },
            isApiErrorMessage: true,
            apiErrorStatus: 429,
        });

        const result = mapClaudeLogMessageToSessionEnvelopes(message, { currentTurnId: null });
        const textEnvelope = result.envelopes.find((envelope) => envelope.ev.t === 'text');

        expect(textEnvelope).toMatchObject({
            ev: { t: 'text', text: "You've hit your limit" },
            usage: { input_tokens: 0, output_tokens: 0 },
        });
        expect(textEnvelope?.usage?.service_tier).toBeUndefined();
    });

    it('maps tool use and tool result blocks to tool-call lifecycle', () => {
        const usage = {
            input_tokens: 900,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 250,
            output_tokens: 25,
        };
        const started = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-2',
            message: {
                role: 'assistant',
                usage,
                content: [
                    { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
                ],
            },
        } as any, { currentTurnId: null });

        expect(started.envelopes.some((e) => e.ev.t === 'tool-call-start')).toBe(true);
        expect(started.envelopes.find((e) => e.ev.t === 'tool-call-start')).toMatchObject({ usage });

        const ended = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-2',
            message: {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' },
                ],
            },
        } as any, { currentTurnId: started.currentTurnId });

        expect(ended.currentTurnId).toBe(started.currentTurnId);
        expect(ended.envelopes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    ev: { t: 'tool-call-end', call: 'tool-1' },
                }),
            ]),
        );
    });

    it('hides the provider Agent parent and exposes a generic child lifecycle owner', () => {
        const state = { currentTurnId: null };
        const parent = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-1',
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tool-agent-1',
                        name: 'Agent',
                        input: {
                            description: 'Inspect translations',
                            prompt: 'Review all translation files',
                            mode: 'auto',
                        },
                    },
                ],
            },
        } as any, state);
        expect(parent.envelopes.some((envelope) => envelope.ev.t === 'tool-call-start')).toBe(false);
        const start = parent.envelopes.find((envelope) => envelope.ev.t === 'start');
        expect(start).toMatchObject({
            ev: { t: 'start', title: 'Inspect translations' },
            subagent: expect.any(String),
        });

        const child = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-1-child',
            parent_tool_use_id: 'tool-agent-1',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'child evidence' }],
            },
        } as any, state);
        expect(child.envelopes.some((envelope) => envelope.ev.t === 'start')).toBe(false);
        expect(child.envelopes[0]?.subagent).toBe(start?.subagent);
        expect(isCuid(String(start?.subagent))).toBe(true);
    });

    it('generates stable session subagent ids for the same provider tool id', () => {
        const firstState = { currentTurnId: null };
        const firstParent = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-stable-1',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-agent-stable',
                    name: 'Agent',
                    input: {
                        description: 'Inspect translations',
                        prompt: 'Review all translation files',
                    },
                }],
            },
        } as any, firstState);
        mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-stable-child-1',
            parent_tool_use_id: 'tool-agent-stable',
            message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
        } as any, firstState);

        const secondState = { currentTurnId: null };
        const secondParent = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-stable-2',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-agent-stable',
                    name: 'Agent',
                    input: {
                        description: 'Inspect translations',
                        prompt: 'Review all translation files',
                    },
                }],
            },
        } as any, secondState);
        mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-stable-child-2',
            parent_tool_use_id: 'tool-agent-stable',
            message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] },
        } as any, secondState);

        const firstStart = firstParent.envelopes.find((envelope) => envelope.ev.t === 'start');
        const secondStart = secondParent.envelopes.find((envelope) => envelope.ev.t === 'start');
        expect(firstStart?.subagent).toBe(secondStart?.subagent);
        expect(isCuid(String(firstStart?.subagent))).toBe(true);
    });

    it('stops visible Agent sidechains when the parent tool result arrives', () => {
        const state = { currentTurnId: null };
        const started = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-stop-1',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool-agent-stop',
                    name: 'Agent',
                    input: {
                        description: 'Inspect translations',
                        prompt: 'Review all translation files',
                    },
                }],
            },
        } as any, state);
        expect(started.envelopes.some((envelope) => envelope.ev.t === 'tool-call-start')).toBe(false);
        const sessionSubagent = started.envelopes.find((envelope) => envelope.ev.t === 'start')?.subagent;

        const child = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-agent-stop-child',
            parent_tool_use_id: 'tool-agent-stop',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'child result' }],
            },
        } as any, state);
        expect(child.envelopes.some((envelope) => {
            return envelope.ev.t === 'start' && envelope.subagent === sessionSubagent;
        })).toBe(false);

        const stopped = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-agent-stop-1',
            isSidechain: false,
            message: {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'tool-agent-stop', content: 'done' }],
            },
        } as any, state);

        expect(stopped.envelopes).toEqual(expect.arrayContaining([
            expect.objectContaining({
                subagent: sessionSubagent,
                ev: expect.objectContaining({ t: 'stop', status: 'completed' }),
            }),
        ]));
        expect(stopped.envelopes.some((envelope) => {
            return envelope.ev.t === 'tool-call-end'
                && envelope.ev.call === 'tool-agent-stop';
        })).toBe(false);
    });

    it('uses parent_tool_use_id as subagent and emits subagent start', () => {
        const mappedSubagent = createId();
        const state = {
            currentTurnId: 'turn-1',
            providerSubagentToSessionSubagent: new Map<string, string>([['task-1', mappedSubagent]]),
        };

        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-side-1',
            parent_tool_use_id: 'task-1',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'sidechain text' }],
            },
        } as any, state);

        expect(result.envelopes).toHaveLength(2);
        expect(result.envelopes[0].subagent).toBe(mappedSubagent);
        expect(result.envelopes[0].ev).toEqual({ t: 'start' });
        expect(result.envelopes[1].subagent).toBe(mappedSubagent);
        expect(result.envelopes[1].ev).toEqual({ t: 'text', text: 'sidechain text' });
    });

    it('buffers subagent messages until parent Task registration is known', () => {
        const state = { currentTurnId: null };

        const buffered = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-side-buffered-1',
            parent_tool_use_id: 'task-buffer-1',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'buffer me' }],
            },
        } as any, state);
        expect(buffered.envelopes).toHaveLength(0);

        const parent = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-parent-buffered-1',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'task-buffer-1',
                    name: 'Task',
                    input: { prompt: 'run side task' },
                }],
            },
        } as any, state);

        expect(parent.envelopes.some((envelope) => {
            return envelope.ev.t === 'tool-call-start'
                && envelope.ev.call === 'task-buffer-1';
        })).toBe(false);
        const bufferedText = parent.envelopes.find((envelope) => {
            return envelope.ev.t === 'text'
                && envelope.ev.text === 'buffer me';
        });
        expect(bufferedText?.subagent).toBeDefined();
        expect(isCuid(bufferedText!.subagent!)).toBe(true);
        expect(bufferedText?.subagent).not.toBe('task-buffer-1');
    });

    it('creates and tags subagent chain from Task prompt when parent_tool_use_id is absent', () => {
        const state = { currentTurnId: null };
        const prompt = 'Search for TypeScript 5.6 features';

        const taskToolUse = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'task-parent-assistant',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'task-call-1',
                    name: 'Task',
                    input: {
                        prompt,
                        description: 'Search TypeScript docs',
                    },
                }],
            },
        } as any, state);

        expect(taskToolUse.envelopes.some((envelope) => {
            return envelope.ev.t === 'tool-call-start'
                && envelope.ev.call === 'task-call-1';
        })).toBe(false);

        const sidechainRoot = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'sidechain-root',
            isSidechain: true,
            parentUuid: null,
            message: {
                role: 'user',
                content: prompt,
            },
        } as any, state);

        expect(sidechainRoot.envelopes).toHaveLength(1);
        const lifecycleStart = taskToolUse.envelopes.find((envelope) => envelope.ev.t === 'start');
        const mappedSubagent = lifecycleStart?.subagent;
        expect(mappedSubagent).toBeDefined();
        expect(isCuid(mappedSubagent!)).toBe(true);
        expect(mappedSubagent).not.toBe('task-call-1');
        expect(lifecycleStart?.role).toBe('agent');
        expect(lifecycleStart?.ev).toEqual({ t: 'start', title: 'Search TypeScript docs' });
        expect(sidechainRoot.envelopes[0].subagent).toBe(mappedSubagent);
        expect(sidechainRoot.envelopes[0].ev).toEqual({ t: 'text', text: prompt });

        const sidechainChild = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'sidechain-child',
            isSidechain: true,
            parentUuid: 'sidechain-root',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Subagent result' }],
            },
        } as any, state);

        expect(sidechainChild.envelopes).toHaveLength(1);
        expect(sidechainChild.envelopes[0].subagent).toBe(mappedSubagent);
        expect(sidechainChild.envelopes[0].ev).toEqual({ t: 'text', text: 'Subagent result' });
    });

    it('infers subagent for non-SDK sidechain fixture logs', () => {
        const fixturePath = join(__dirname, '__fixtures__', 'task_non_sdk.jsonl');
        const rows = readFileSync(fixturePath, 'utf8')
            .trim()
            .split('\n')
            .slice(0, 6)
            .map((line) => JSON.parse(line));

        const state = { currentTurnId: null };
        const envelopes = rows.flatMap((row) => {
            return mapClaudeLogMessageToSessionEnvelopes(row as any, state).envelopes;
        });

        const subagentRoot = envelopes.find((envelope) => {
            return envelope.ev.t === 'text'
                && envelope.ev.text.startsWith('Search the web for information about TypeScript 5.6');
        });
        expect(subagentRoot?.subagent).toBeDefined();
        expect(isCuid(subagentRoot!.subagent!)).toBe(true);
        expect(subagentRoot?.subagent).not.toBe('toolu_01EmKA8FJ7B2Ah9seGxK1Wct');

        const subagentChild = envelopes.find((envelope) => {
            return envelope.ev.t === 'text'
                && envelope.ev.text.includes("I'll search for information about TypeScript 5.6");
        });
        expect(subagentChild?.subagent).toBe(subagentRoot?.subagent);
    });

    it('emits stop for completed subagent when parent Task tool returns', () => {
        const mappedSubagent = createId();
        const state = {
            currentTurnId: 'turn-1',
            providerSubagentToSessionSubagent: new Map<string, string>([['task-2', mappedSubagent]]),
            hiddenParentToolCalls: new Set<string>(['task-2']),
        };

        const started = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'a-side-2',
            parent_tool_use_id: 'task-2',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'subagent running' }],
            },
        } as any, state);

        expect(started.envelopes.some((envelope) => {
            return envelope.ev.t === 'start' && envelope.subagent === mappedSubagent;
        })).toBe(true);

        const stopped = mapClaudeLogMessageToSessionEnvelopes({
            type: 'user',
            uuid: 'u-parent-2',
            isSidechain: false,
            message: {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'task-2', content: 'done' }],
            },
        } as any, state);

        expect(stopped.envelopes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    subagent: mappedSubagent,
                    ev: expect.objectContaining({ t: 'stop', status: 'completed' }),
                }),
            ]),
        );
        expect(stopped.envelopes.some((envelope) => {
            return envelope.ev.t === 'tool-call-end'
                && envelope.ev.call === 'task-2';
        })).toBe(false);
    });

    it('does not emit envelopes for summary messages', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'summary',
            summary: 'Done',
            leafUuid: 'leaf-1',
        } as any, { currentTurnId: 'turn-1' });

        expect(result.currentTurnId).toBe('turn-1');
        expect(result.envelopes).toHaveLength(0);
    });

    it('does not emit envelopes for compact summary assistant messages', () => {
        const result = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'compact-summary-1',
            isCompactSummary: true,
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Long compaction summary' }],
            },
        } as any, { currentTurnId: 'turn-1' });

        expect(result.currentTurnId).toBe('turn-1');
        expect(result.envelopes).toHaveLength(0);
    });
});

describe('closeClaudeTurnWithStatus', () => {
    it('emits turn-end with provided status when turn is active', () => {
        const result = closeClaudeTurnWithStatus({ currentTurnId: 'turn-1' }, 'cancelled');
        expect(result.currentTurnId).toBeNull();
        expect(result.envelopes).toHaveLength(1);
        expect(result.envelopes[0].ev).toEqual({ t: 'turn-end', status: 'cancelled' });
    });

    it('ends active child timing neutrally without inventing an interruption', () => {
        const subagent = createId();
        const state = {
            currentTurnId: 'turn-1',
            startedSubagents: new Set([subagent]),
            activeSubagents: new Set([subagent]),
            subagentTurnIds: new Map([[subagent, 'turn-1']]),
        };
        const result = closeClaudeTurnWithStatus(state, 'cancelled');

        expect(result.currentTurnId).toBeNull();
        expect(result.envelopes).toHaveLength(2);
        expect(result.envelopes[0]).toMatchObject({
            subagent,
            turn: 'turn-1',
            ev: { t: 'stop', status: 'unknown', authoritative: false },
        });
        expect(result.envelopes[1].ev).toEqual({ t: 'turn-end', status: 'cancelled' });
        expect(state.startedSubagents.has(subagent)).toBe(true);
        expect(state.subagentTurnIds.get(subagent)).toBe('turn-1');
        expect((state as any).subagentStops.get(subagent)).toEqual({ status: 'unknown', authoritative: false });
    });

    it('corrects a provisional close with a late provider tool result on the original turn', () => {
        const state = { currentTurnId: null };
        const parent = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'parent-tool-message',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'task-late-terminal',
                    name: 'Task',
                    input: { prompt: 'Inspect lifecycle' },
                }],
            },
        } as any, state);
        const start = parent.envelopes.find((envelope) => envelope.ev.t === 'start');
        expect(start?.turn).toBeDefined();

        const closed = closeClaudeTurnWithStatus(state, 'completed');
        expect(closed.envelopes[0]).toMatchObject({
            turn: start?.turn,
            subagent: start?.subagent,
            ev: { t: 'stop', status: 'unknown', authoritative: false },
        });

        const nextRoot = mapClaudeLogMessageToSessionEnvelopes({
            type: 'assistant',
            uuid: 'next-root-message',
            message: { role: 'assistant', content: [{ type: 'text', text: 'next root' }] },
        } as any, state);
        const nextTurn = nextRoot.envelopes.find((envelope) => envelope.ev.t === 'turn-start')?.turn;
        expect(nextTurn).not.toBe(start?.turn);

        const terminalMessage = {
            type: 'user',
            uuid: 'late-tool-result',
            isSidechain: false,
            message: {
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: 'task-late-terminal',
                    content: null,
                }],
            },
        } as any;
        const terminal = mapClaudeLogMessageToSessionEnvelopes(terminalMessage, state);
        expect(terminal.envelopes).toEqual([
            expect.objectContaining({
                turn: start?.turn,
                subagent: start?.subagent,
                ev: { t: 'stop', status: 'completed', authoritative: true },
            }),
        ]);
        expect(state.currentTurnId).toBe(nextTurn);

        expect(mapClaudeLogMessageToSessionEnvelopes(terminalMessage, state).envelopes).toEqual([]);
    });

    it('derives stable turn and child lifecycle ids when replaying Claude logs', () => {
        const rows = [{
            type: 'assistant',
            uuid: 'parent-stable-turn',
            message: {
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'task-stable-turn',
                    name: 'Task',
                    input: { prompt: 'Inspect lifecycle' },
                }],
            },
        }, {
            type: 'assistant',
            uuid: 'child-stable-turn',
            parent_tool_use_id: 'task-stable-turn',
            message: { role: 'assistant', content: [{ type: 'text', text: 'child evidence' }] },
        }] as any[];
        const replay = () => {
            const state = { currentTurnId: null };
            return rows.flatMap((row) => mapClaudeLogMessageToSessionEnvelopes(row, state).envelopes);
        };

        const first = replay();
        const second = replay();
        const firstStart = first.find((envelope) => envelope.ev.t === 'start');
        const secondStart = second.find((envelope) => envelope.ev.t === 'start');
        expect(secondStart).toMatchObject({
            id: firstStart?.id,
            turn: firstStart?.turn,
            subagent: firstStart?.subagent,
        });
    });
});
