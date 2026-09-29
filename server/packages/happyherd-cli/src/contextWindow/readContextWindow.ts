import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    ContextWindowRequestSchema,
    type ContextWindowEntry,
    type ContextWindowLimitation,
    type ContextWindowResponse,
} from '@happyherd/wire';
import { getProjectPath } from '@/claude/utils/path';
import { resolveCodexHomeForResume } from '@/resume/codexHome';

type TraceRecord = Record<string, unknown>;
type ContextWindowSuccess = Extract<ContextWindowResponse, { type: 'success' }>;

function record(value: unknown): TraceRecord | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as TraceRecord
        : undefined;
}

function readJsonl(text: string): TraceRecord[] {
    return text.split('\n').filter((line) => line.trim()).map((line) => {
        const value = record(JSON.parse(line));
        if (!value || typeof value.type !== 'string') throw new Error('Invalid provider trace record');
        return value;
    });
}

function entry(value: TraceRecord): ContextWindowEntry {
    const detail = value.type === 'message' ? value.role
        : value.type === 'attachment' ? record(value.attachment)?.type
            : value.subtype;
    return {
        kind: [value.type, detail].filter((part) => typeof part === 'string').join(':'),
        content: JSON.stringify(value, null, 2),
    };
}

/** Read recorded content, without applying the chat's message-kind filters. */
export function parseClaudeContextWindow(text: string): ContextWindowSuccess {
    const records = readJsonl(text);
    let boundary = -1;
    for (let index = 0; index < records.length; index++) {
        if (records[index].type === 'system' && records[index].subtype === 'compact_boundary') boundary = index;
    }
    let current = records.slice(Math.max(0, boundary));
    if (boundary >= 0) {
        const metadata = record(records[boundary].compactMetadata);
        const preservedMessages = record(metadata?.preservedMessages);
        const preservedSegment = record(metadata?.preservedSegment);
        const byUuid = new Map(records.filter((item) => typeof item.uuid === 'string').map((item) => [item.uuid, item]));
        let anchor: unknown;
        let preserved: TraceRecord[] = [];
        // Native Claude gives the explicit ordered UUID list precedence over
        // the older parent-linked segment. Do not invent content for missing IDs.
        if (preservedMessages) {
            anchor = preservedMessages.anchorUuid;
            if (!Array.isArray(preservedMessages.uuids)) throw new Error('Invalid preserved Claude messages');
            preserved = preservedMessages.uuids.map((uuid) => {
                const value = byUuid.get(uuid);
                if (!value) throw new Error('Preserved Claude message is not recorded');
                return value;
            });
        } else if (preservedSegment) {
            anchor = preservedSegment.anchorUuid;
            let uuid = preservedSegment.tailUuid;
            const visited = new Set();
            while (true) {
                const value = byUuid.get(uuid);
                if (!value || visited.has(uuid)) throw new Error('Preserved Claude segment is not recorded');
                visited.add(uuid);
                preserved.unshift(value);
                if (uuid === preservedSegment.headUuid) break;
                uuid = value.parentUuid;
            }
        }
        if (preserved.length > 0) {
            const preservedIds = new Set(preserved.map((value) => value.uuid));
            current = current.filter((value) => !preservedIds.has(value.uuid));
            const anchorIndex = current.findIndex((value) => value.uuid === anchor);
            if (anchorIndex < 0) throw new Error('Claude compaction anchor is not recorded');
            current.splice(anchorIndex + 1, 0, ...preserved);
        }
    }
    return {
        type: 'success',
        provider: 'claude',
        entries: current.map(entry),
        limitations: ['claude_system_prompt_unrecorded', 'claude_tool_definitions_unrecorded', 'provider_input_not_fully_recorded'],
    };
}

export function parseCodexContextWindow(text: string): ContextWindowSuccess {
    const records = readJsonl(text);
    let baseInstructions: string | undefined;
    let entries: ContextWindowEntry[] = [];
    let compactedHistoryUnrecorded = false;
    let historyUnavailable = false;
    for (const value of records) {
        const payload = record(value.payload);
        if (value.type === 'session_meta') {
            const instructions = payload?.base_instructions;
            const text = typeof instructions === 'string' ? instructions : record(instructions)?.text;
            if (typeof text === 'string') baseInstructions = text;
            // A paginated fork can reference inputs absent from this file.
            if (payload?.history_base) historyUnavailable = true;
        } else if (value.type === 'compacted') {
            // replacement_history is the history installed by native Codex,
            // including retained old inputs. The old response_item prefix is
            // no longer the current window after this checkpoint.
            const replacement = payload?.replacement_history;
            compactedHistoryUnrecorded = !Array.isArray(replacement);
            if (Array.isArray(replacement)) historyUnavailable = false;
            // Split the checkpoint into its full metadata and individual kept
            // items. Keep every recorded field, but do not duplicate a whole
            // window in the response just to display both boundary and items.
            const { replacement_history: _history, ...checkpointMetadata } = payload ?? {};
            entries = Array.isArray(replacement) ? [entry({ ...value, payload: checkpointMetadata }), ...replacement.map((item) => {
                const nativeItem = record(item);
                if (!nativeItem || typeof nativeItem.type !== 'string') throw new Error('Invalid Codex replacement history');
                return entry(nativeItem);
            })] : [entry(value)];
        } else if (value.type === 'response_item') {
            if (!payload || typeof payload.type !== 'string') throw new Error('Invalid Codex response item');
            // The outer envelope can include native provenance metadata; its
            // content is retained even though the kind comes from the item.
            entries.push({ kind: entry(payload).kind, content: JSON.stringify(value, null, 2) });
        } else if (value.type === 'event_msg' && payload?.type === 'thread_rolled_back') {
            // Native rollback removes real user turn segments, which are not
            // equivalent to role=user response items (injected context also
            // has that role). Until a complete checkpoint follows, this reader
            // cannot recover that window without inventing its turn boundaries.
            historyUnavailable = true;
        } else if (value.type === 'inter_agent_communication' || value.type === 'world_state' || value.type === 'turn_context') {
            // Preserve recorded injected input and context metadata under their
            // native kinds; never synthesize model messages from world state.
            entries.push(entry(value));
        }
    }
    if (historyUnavailable) throw new Error('Codex current history is not recoverable from this trace');
    const limitations: ContextWindowLimitation[] = ['provider_input_not_fully_recorded'];
    if (baseInstructions === undefined) limitations.push('codex_base_instructions_unrecorded');
    else entries.unshift({ kind: 'base_instructions', content: baseInstructions });
    if (compactedHistoryUnrecorded) limitations.push('codex_compacted_history_unrecorded');
    return { type: 'success', provider: 'codex', entries, limitations };
}

function isMissing(error: unknown): boolean {
    return record(error)?.code === 'ENOENT';
}

async function findCodexRollout(codexHome: string, threadId: string): Promise<string | undefined> {
    for (const directory of ['sessions', 'archived_sessions']) {
        const root = join(codexHome, directory);
        let names: string[];
        try {
            names = await readdir(root, { recursive: true });
        } catch (error) {
            if (isMissing(error)) continue;
            throw error;
        }
        const name = names.find((name) => name.endsWith(`-${threadId}.jsonl`));
        if (name) return join(root, name);
    }
    return undefined;
}

/** No provider process is started and no trace or session state is mutated. */
export async function readContextWindow(params: unknown): Promise<ContextWindowResponse> {
    const request = ContextWindowRequestSchema.safeParse(params);
    if (!request.success) return { type: 'error', reason: 'unreadable' };
    const input = request.data;
    if (input.provider !== 'claude' && input.provider !== 'codex') return { type: 'error', reason: 'unsupported' };
    try {
        let path: string | undefined;
        if (input.provider === 'claude') {
            if (!input.claudeSessionId) return { type: 'error', reason: 'missing' };
            // Match the existing rewind-point RPC's provider identity contract.
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.claudeSessionId)) {
                return { type: 'error', reason: 'unreadable' };
            }
            path = join(getProjectPath(input.directory), `${input.claudeSessionId}.jsonl`);
        } else {
            if (!input.codexThreadId) return { type: 'error', reason: 'missing' };
            const codexHome = await resolveCodexHomeForResume({
                codexThreadId: input.codexThreadId,
                codexHome: input.codexHome,
                homeDir: input.homeDir ?? homedir(),
            });
            if (codexHome) path = await findCodexRollout(codexHome, input.codexThreadId);
        }
        if (!path) return { type: 'error', reason: 'missing' };
        const text = await readFile(path, 'utf8');
        if (!text.trim()) return { type: 'error', reason: 'missing' };
        return input.provider === 'claude' ? parseClaudeContextWindow(text) : parseCodexContextWindow(text);
    } catch (error) {
        return { type: 'error', reason: isMissing(error) ? 'missing' : 'unreadable' };
    }
}
