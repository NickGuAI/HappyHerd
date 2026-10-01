import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextWindowResponseSchema } from '@happyherd/wire';
import { getProjectPath } from '@/claude/utils/path';
import { parseClaudeContextWindow, parseCodexContextWindow, readContextWindow } from './readContextWindow';

const roots: string[] = [];
const fixture = (name: string) => readFile(fileURLToPath(new URL(`./fixtures/${name}.jsonl`, import.meta.url)), 'utf8');
const jsonl = (...records: object[]) => records.map((value) => JSON.stringify(value)).join('\n');

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
    const root = await mkdtemp(join(tmpdir(), 'happyherd-context-window-'));
    roots.push(root);
    return root;
}

describe('Claude recorded context window', () => {
    it('cuts at a real boundary, restores ordered preserved messages, and retains hidden/native records in full', async () => {
        const result = parseClaudeContextWindow(await fixture('claude-compacted'));
        expect(ContextWindowResponseSchema.parse(result)).toEqual(result);
        const records = result.entries.map((item) => JSON.parse(item.content));
        expect(records.map((item) => item.uuid ?? item.type)).toEqual([
            'boundary', 'compact-summary', 'kept-user', 'kept-attachment', 'environment',
            'session-context', 'deferred-tools', 'reminder', 'assistant', 'file-history-snapshot', 'summary',
        ]);
        expect(result.entries[0].kind).toBe('system:compact_boundary');
        expect(result.entries[3].kind).toBe('attachment:skill_listing');
        expect(records[5].attachment.content).toBe('Use this sanitized session context.\nKeep all lines intact.');
        expect(records[6].attachment.tools).toEqual([{ name: 'fixture_tool', description: 'A hidden deferred tool descriptor' }]);
        expect(JSON.stringify(result)).not.toContain('Old request no longer retained.');
        expect(result.limitations).toContain('claude_system_prompt_unrecorded');
        expect(result.limitations).toContain('claude_tool_definitions_unrecorded');
    });

    it('does not treat ordinary summary text as compaction and preserves unknown entry fields', () => {
        const result = parseClaudeContextWindow(jsonl(
            { type: 'user', uuid: 'u', message: { content: 'Still in context' }, nativeFutureField: [1, 2] },
            { type: 'summary', summary: 'A session label' },
        ));
        expect(result.entries.map((item) => item.kind)).toEqual(['user', 'summary']);
        expect(JSON.parse(result.entries[0].content).nativeFutureField).toEqual([1, 2]);
    });

    it('restores older preservedSegment chains at the native anchor without changing their raw payloads', () => {
        const old = { type: 'user', uuid: 'head', parentUuid: 'gone', message: { content: 'retained' } };
        const result = parseClaudeContextWindow(jsonl(
            old,
            { type: 'attachment', uuid: 'tail', parentUuid: 'head', attachment: { type: 'agent_listing', content: 'fixture agent' } },
            { type: 'system', subtype: 'compact_boundary', uuid: 'b', compactMetadata: { preservedSegment: { headUuid: 'head', tailUuid: 'tail', anchorUuid: 'summary' } } },
            { type: 'user', uuid: 'summary', parentUuid: 'b', isCompactSummary: true, message: { content: 'summary' } },
            { type: 'assistant', uuid: 'new', parentUuid: 'summary', message: { content: 'new reply' } },
        ));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid)).toEqual(['b', 'summary', 'head', 'tail', 'new']);
        expect(JSON.parse(result.entries[2].content)).toEqual(old);
    });

    it('does not claim a complete window when a preserved message is absent', () => {
        expect(() => parseClaudeContextWindow(jsonl({
            type: 'system', subtype: 'compact_boundary', uuid: 'b',
            compactMetadata: { preservedMessages: { anchorUuid: 'b', uuids: ['missing'] } },
        }))).toThrow('not recorded');
    });

    it('selects the latest mainline branch after rewind, keeping its hidden ancestors and trailing attachments', () => {
        const records = [
            { type: 'system', subtype: 'compact_boundary', uuid: 'boundary', parentUuid: null },
            { type: 'user', uuid: 'summary', parentUuid: 'boundary', isMeta: true, message: { content: 'summary' } },
            { type: 'user', uuid: 'u1', parentUuid: 'summary', message: { content: 'first request' } },
            { type: 'attachment', uuid: 'old-injection', parentUuid: 'u1', attachment: { type: 'environment', content: 'discarded context' } },
            { type: 'assistant', uuid: 'a1', parentUuid: 'old-injection', message: { content: 'discarded response' } },
            { type: 'summary', leafUuid: 'a1', summary: 'discarded branch title' },
            { type: 'user', uuid: 'u2', parentUuid: 'u1', message: { content: 'replacement after rewind' } },
            { type: 'attachment', uuid: 'current-injection', parentUuid: 'u2', attachment: { type: 'skill_listing', content: 'current hidden context' } },
            { type: 'assistant', uuid: 'a2', parentUuid: 'current-injection', message: { content: 'current response' } },
            { type: 'attachment', uuid: 'trailing-injection', parentUuid: 'a2', attachment: { type: 'system_reminder', content: 'current trailing context' } },
            { type: 'user', uuid: 'side-u', parentUuid: 'u1', isSidechain: true, message: { content: 'subagent request' } },
            { type: 'assistant', uuid: 'side-a', parentUuid: 'side-u', isSidechain: true, message: { content: 'subagent response' } },
            { type: 'file-history-snapshot', messageId: 'a2', snapshot: { trackedFileBackups: {} } },
        ];
        const result = parseClaudeContextWindow(jsonl(...records));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid ?? item.kind)).toEqual([
            'boundary', 'summary', 'u1', 'u2', 'current-injection', 'a2', 'trailing-injection', 'file-history-snapshot',
        ]);
        expect(JSON.stringify(result)).not.toContain('discarded');
        expect(JSON.stringify(result)).not.toContain('subagent');
    });

    it('recovers native assistant chunks with the same message ID and sibling tool results', () => {
        const chunk = (uuid: string, toolId: string) => ({
            type: 'assistant', uuid, parentUuid: 'u', timestamp: uuid,
            message: { id: 'same-native-message', role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'fixture_tool', input: {} }] },
        });
        const result = parseClaudeContextWindow(jsonl(
            { type: 'user', uuid: 'u', parentUuid: null, message: { content: 'run tools' } },
            chunk('a1', 'tool-1'),
            chunk('a2', 'tool-2'),
            { type: 'user', uuid: 'r1', parentUuid: 'a1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'first result' }] } },
            { type: 'user', uuid: 'r2', parentUuid: 'a2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'second result' }] } },
            { type: 'assistant', uuid: 'final', parentUuid: 'r2', message: { id: 'final-message', content: 'both tools completed' } },
        ));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid)).toEqual(['u', 'a2', 'a1', 'r1', 'r2', 'final']);
        expect(JSON.parse(result.entries[2].content).parentUuid).toBe('u');
    });

    it('cuts at the compaction on the selected branch rather than a later abandoned branch boundary', () => {
        const result = parseClaudeContextWindow(jsonl(
            { type: 'user', uuid: 'u', parentUuid: null, message: { content: 'original' } },
            { type: 'system', subtype: 'compact_boundary', uuid: 'abandoned-boundary', parentUuid: null },
            { type: 'user', uuid: 'abandoned-summary', parentUuid: 'abandoned-boundary', isMeta: true, message: { content: 'abandoned summary' } },
            { type: 'assistant', uuid: 'abandoned-reply', parentUuid: 'abandoned-summary', message: { content: 'abandoned reply' } },
            { type: 'user', uuid: 'resumed', parentUuid: 'u', message: { content: 'resumed before compaction' } },
        ));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid)).toEqual(['u', 'resumed']);
    });

    it('rejects cyclic ancestry but does not require ancestry preceding the selected compact boundary', () => {
        expect(() => parseClaudeContextWindow(jsonl(
            { type: 'user', uuid: 'cycle-a', parentUuid: 'cycle-b' },
            { type: 'assistant', uuid: 'cycle-b', parentUuid: 'cycle-a' },
        ))).toThrow('Invalid Claude parent chain');
        const result = parseClaudeContextWindow(jsonl(
            { type: 'system', subtype: 'compact_boundary', uuid: 'b', parentUuid: 'not-recorded-before-compaction' },
            { type: 'user', uuid: 'u', parentUuid: 'b', message: { content: 'current' } },
        ));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid)).toEqual(['b', 'u']);
    });

    it('uses a newly compacted summary before the next ordinary turn instead of the obsolete prior window', () => {
        const result = parseClaudeContextWindow(jsonl(
            { type: 'user', uuid: 'old-u', parentUuid: null, message: { content: 'old request' } },
            { type: 'assistant', uuid: 'old-a', parentUuid: 'old-u', message: { content: 'old answer' } },
            { type: 'system', subtype: 'compact_boundary', uuid: 'b', parentUuid: null, logicalParentUuid: 'old-a' },
            { type: 'user', uuid: 'summary', parentUuid: 'b', isMeta: true, isCompactSummary: true, message: { content: 'current compact summary' } },
            { type: 'attachment', uuid: 'current-attachment', parentUuid: 'summary', attachment: { type: 'environment', content: 'current environment' } },
        ));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid)).toEqual(['b', 'summary', 'current-attachment']);
        expect(JSON.stringify(result)).not.toContain('old answer');
    });

    it('does not show the obsolete window while the new compaction summary has not finished writing', () => {
        expect(() => parseClaudeContextWindow(jsonl(
            { type: 'user', uuid: 'old-u', parentUuid: null, message: { content: 'old request' } },
            { type: 'assistant', uuid: 'old-a', parentUuid: 'old-u', message: { content: 'old answer' } },
            { type: 'system', subtype: 'compact_boundary', uuid: 'b', parentUuid: null, logicalParentUuid: 'old-a' },
        ))).toThrow('compaction summary is not recorded');
    });

    it('keeps a current hidden mainline injection eligible when an abandoned ordinary branch also exists', () => {
        const result = parseClaudeContextWindow(jsonl(
            { type: 'user', uuid: 'u', parentUuid: null, message: { content: 'request' } },
            { type: 'assistant', uuid: 'abandoned', parentUuid: 'u', message: { content: 'abandoned reply' } },
            { type: 'user', uuid: 'current-u', parentUuid: 'u', message: { content: 'replacement request' } },
            { type: 'assistant', uuid: 'current-a', parentUuid: 'current-u', message: { content: 'current reply' } },
            { type: 'user', uuid: 'hidden', parentUuid: 'current-a', isMeta: true, origin: { kind: 'task-notification' }, message: { content: '<task-notification>Recorded background task result.</task-notification>' } },
        ));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid)).toEqual(['u', 'current-u', 'current-a', 'hidden']);
        expect(JSON.stringify(result)).toContain('Recorded background task result.');
        expect(JSON.stringify(result)).not.toContain('abandoned reply');
    });

    it.each([6, 7, 10])('reads completed retained-history compaction at fixture stage %i before another assistant reply', async (lineCount) => {
        const lines = (await fixture('claude-compacted')).trim().split('\n');
        const result = parseClaudeContextWindow(lines.slice(0, lineCount).join('\n'));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid)).toEqual([
            'boundary', 'compact-summary', 'kept-user', 'kept-attachment',
            ...['environment', 'session-context', 'deferred-tools', 'reminder'].slice(0, lineCount - 6),
        ]);
    });

    it.each([false, true])('ranks the new summary above abandoned conversations recorded after the retained old user (retained attachment: %s)', (hasAttachment) => {
        const result = parseClaudeContextWindow(jsonl(
            { type: 'user', uuid: 'retained', parentUuid: null, message: { content: 'retained request' } },
            ...(hasAttachment ? [{ type: 'attachment', uuid: 'retained-hidden', parentUuid: 'retained', attachment: { type: 'environment', content: 'retained environment' } }] : []),
            { type: 'user', uuid: 'abandoned', parentUuid: 'retained', message: { content: 'later abandoned request' } },
            { type: 'assistant', uuid: 'abandoned-answer', parentUuid: 'abandoned', message: { content: 'later abandoned answer' } },
            { type: 'system', subtype: 'compact_boundary', uuid: 'b', parentUuid: null, compactMetadata: { preservedMessages: { anchorUuid: 'summary', uuids: ['retained', ...(hasAttachment ? ['retained-hidden'] : [])] } } },
            { type: 'user', uuid: 'summary', parentUuid: 'b', isMeta: true, isCompactSummary: true, message: { content: 'new compact summary' } },
        ));
        expect(result.entries.map((item) => JSON.parse(item.content).uuid)).toEqual(['b', 'summary', 'retained', ...(hasAttachment ? ['retained-hidden'] : [])]);
    });
});

describe('Codex recorded context window', () => {
    it('shows actual base text and latest replacement history followed by all recorded input kinds', async () => {
        const result = parseCodexContextWindow(await fixture('codex-compacted'));
        expect(ContextWindowResponseSchema.parse(result)).toEqual(result);
        expect(result.entries.map((item) => item.kind)).toEqual([
            'base_instructions', 'session_meta', 'compacted', 'message:developer', 'message:user', 'compaction', 'world_state',
            'turn_context', 'reasoning', 'function_call', 'function_call_output', 'inter_agent_communication', 'message:assistant',
        ]);
        expect(result.entries[0].content).toBe('You are the fixture assistant.\nPreserve full native content.');
        expect(JSON.parse(result.entries[1].content).payload.dynamic_tools).toEqual([
            { name: 'fixture_dynamic_tool', description: 'Recorded native tool', input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
        ]);
        expect(JSON.parse(result.entries[1].content).payload.base_instructions).toBeUndefined();
        expect(JSON.parse(result.entries[2].content).payload.replacement_history_metadata).toEqual([
            { fixture_source: 'developer-injection' }, { fixture_source: 'retained-user' }, null,
        ]);
        expect(JSON.parse(result.entries[2].content).payload.replacement_history).toBeUndefined();
        expect(JSON.parse(result.entries[10].content).payload.output).toBe('Full first line\nFull second line\nFinal line');
        expect(JSON.parse(result.entries[10].content).metadata).toEqual({ fixture_source: 'tool-output' });
        expect(JSON.stringify(result)).not.toContain('old_tool');
        expect(JSON.stringify(result)).not.toContain('superseded compaction snapshot');
        expect(result.limitations).toEqual(['provider_input_not_fully_recorded']);
    });

    it('marks absent base instructions and unrecoverable legacy compaction instead of fabricating input', () => {
        const compacted = { type: 'compacted', payload: { message: 'Only this native summary was recorded' } };
        const result = parseCodexContextWindow(jsonl(
            { type: 'response_item', payload: { type: 'message', role: 'user', content: 'gone' } },
            compacted,
            { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'after' } },
        ));
        expect(result.limitations).toContain('codex_base_instructions_unrecorded');
        expect(result.limitations).toContain('codex_compacted_history_unrecorded');
        expect(result.entries.map((item) => item.kind)).toEqual(['compacted', 'message:assistant']);
        expect(JSON.parse(result.entries[0].content)).toEqual(compacted);
    });

    it('keeps an explicit empty checkpoint empty and preserves large content without truncation', () => {
        const content = 'Full fixture content.\n'.repeat(210_000);
        const result = parseCodexContextWindow(jsonl(
            { type: 'session_meta', payload: { base_instructions: { text: '' } } },
            { type: 'response_item', payload: { type: 'message', role: 'user', content: 'gone' } },
            { type: 'compacted', payload: { message: '', replacement_history: [] } },
            { type: 'response_item', payload: { type: 'function_call_output', call_id: 'large', output: content } },
        ));
        expect(result.entries).toHaveLength(4);
        expect(result.entries[0]).toEqual({ kind: 'base_instructions', content: '' });
        expect(JSON.parse(result.entries[3].content).payload.output).toBe(content);
        expect(result.limitations).not.toContain('codex_compacted_history_unrecorded');
    });

    it.each([
        { type: 'event_msg', payload: { type: 'thread_rolled_back', num_turns: 1 } },
        { type: 'session_meta', payload: { history_base: { id: 'inherited-shard' } } },
    ])('reports a window unavailable until a later complete checkpoint recovers it: %j', (unavailable) => {
        expect(() => parseCodexContextWindow(jsonl(unavailable))).toThrow('not recoverable');
        expect(parseCodexContextWindow(jsonl(unavailable,
            { type: 'compacted', payload: { replacement_history: [] } },
        )).entries.map((item) => item.kind)).toEqual(unavailable.type === 'session_meta' ? ['session_meta', 'compacted'] : ['compacted']);
    });
});

describe('read-only machine trace lookup', () => {
    it('reads Claude from its native project path without mutating the trace', async () => {
        const root = await temporaryRoot();
        vi.stubEnv('CLAUDE_CONFIG_DIR', root);
        const directory = '/fixture/project';
        const claudeSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const project = getProjectPath(directory);
        await mkdir(project, { recursive: true });
        const path = join(project, `${claudeSessionId}.jsonl`);
        const text = await fixture('claude-compacted');
        await writeFile(path, text);
        const before = await stat(path);
        const result = await readContextWindow({ provider: 'claude', directory, claudeSessionId });
        expect(result).toEqual(parseClaudeContextWindow(text));
        expect(await readFile(path, 'utf8')).toBe(text);
        expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
    });

    it('finds an archived Codex rollout in the original persisted runtime home', async () => {
        const root = await temporaryRoot();
        const codexHome = join(root, 'original-codex-home');
        const archived = join(codexHome, 'archived_sessions', '2026', '09');
        await mkdir(archived, { recursive: true });
        const codexThreadId = '019a0000-0000-7000-8000-000000000001';
        const text = await fixture('codex-compacted');
        await writeFile(join(archived, `rollout-date-${codexThreadId}.jsonl`), text);
        vi.stubEnv('CODEX_HOME', join(root, 'different-current-home'));
        expect(await readContextWindow({ provider: 'codex', directory: '/fixture/project', codexThreadId, codexHome })).toEqual(parseCodexContextWindow(text));
    });

    it('returns unsupported, missing, and unreadable receipts and succeeds after an incomplete append is retried', async () => {
        const root = await temporaryRoot();
        const directory = '/fixture/project';
        vi.stubEnv('CLAUDE_CONFIG_DIR', root);
        expect(await readContextWindow({ provider: 'dsh', directory })).toEqual({ type: 'error', reason: 'unsupported' });
        expect(await readContextWindow({ provider: 'claude', directory })).toEqual({ type: 'error', reason: 'missing' });
        const claudeSessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const request = { provider: 'claude', directory, claudeSessionId };
        expect(await readContextWindow(request)).toEqual({ type: 'error', reason: 'missing' });
        const project = getProjectPath(directory);
        await mkdir(project, { recursive: true });
        const path = join(project, `${claudeSessionId}.jsonl`);
        await writeFile(path, '{"type":"user"');
        expect(await readContextWindow(request)).toEqual({ type: 'error', reason: 'unreadable' });
        await writeFile(path, '{"type":"user","message":{"content":"Completed append"}}\n');
        expect((await readContextWindow(request)).type).toBe('success');
    });
});
