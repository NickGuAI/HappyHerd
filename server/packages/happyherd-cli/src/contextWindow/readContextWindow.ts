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

/** Reconstruct native ancestry without changing the recorded payloads. */
function claudeCurrentBranch(records: TraceRecord[]): TraceRecord[] {
    const byUuid = new Map<string, TraceRecord>();
    const positions = new Map<string, number>();
    const parents = new Map<string, string | undefined>();
    records.forEach((item, index) => {
        if (typeof item.uuid !== 'string') return;
        byUuid.set(item.uuid, item);
        positions.set(item.uuid, index);
        parents.set(item.uuid, typeof item.parentUuid === 'string' ? item.parentUuid : undefined);
    });
    const incompleteBoundaries = new Set<string>();
    const retainedByBoundary = new Map<string, Set<string>>();
    for (const [uuid, item] of byUuid) {
        if (item.type !== 'system' || item.subtype !== 'compact_boundary') continue;
        retainedByBoundary.set(uuid, new Set());
        const metadata = record(item.compactMetadata);
        const preservedMessages = record(metadata?.preservedMessages);
        const preservedSegment = record(metadata?.preservedSegment);
        let anchor: unknown;
        let kept: unknown[] = [];
        if (preservedMessages) {
            anchor = preservedMessages.anchorUuid;
            kept = Array.isArray(preservedMessages.uuids) ? preservedMessages.uuids : [undefined];
        } else if (preservedSegment) {
            anchor = preservedSegment.anchorUuid;
            let cursor = preservedSegment.tailUuid;
            const visited = new Set();
            while (true) {
                if (typeof cursor !== 'string' || !byUuid.has(cursor) || visited.has(cursor)) {
                    kept = [undefined];
                    break;
                }
                visited.add(cursor);
                kept.unshift(cursor);
                if (cursor === preservedSegment.headUuid) break;
                cursor = parents.get(cursor);
            }
        }
        if (kept.length === 0) continue;
        if (typeof anchor !== 'string' || !byUuid.has(anchor) || kept.some((id) => typeof id !== 'string' || !byUuid.has(id))) {
            incompleteBoundaries.add(uuid);
            continue;
        }
        // Native preservedMessages supersedes preservedSegment. Reparent the
        // selected old records and then the other children of the summary.
        const ids = kept as string[];
        retainedByBoundary.set(uuid, new Set(ids));
        ids.forEach((id, index) => parents.set(id, index === 0 ? anchor : ids[index - 1]));
        for (const [child, parent] of parents) {
            if (parent === anchor && child !== ids[0]) parents.set(child, ids[ids.length - 1]);
        }
    }
    const isConversation = (item: TraceRecord) => item.type === 'user' || item.type === 'assistant';
    // isMeta controls chat visibility, not whether the model receives input.
    // Both compact summaries and later hidden injections can be the current
    // mainline leaf; filtering them would revive an abandoned ordinary branch.
    const isMainline = (item: TraceRecord) => !item.isSidechain && !item.teamName;
    const parentIds = new Set([...parents.values()].filter((id): id is string => id !== undefined));
    const leaves = [...byUuid.keys()].filter((id) => !parentIds.has(id));
    if (byUuid.size > 0 && leaves.length === 0) throw new Error('Invalid Claude parent chain');
    const candidates: Array<{ conversation: string; leaf: string; position: number }> = [];
    for (const leaf of leaves) {
        let cursor: string | undefined = leaf;
        let candidateLeaf = leaf;
        let conversation: string | undefined;
        let position = -1;
        const visited = new Set<string>();
        while (cursor && !visited.has(cursor)) {
            visited.add(cursor);
            const item = byUuid.get(cursor);
            if (!item) break;
            if (isConversation(item)) {
                conversation ??= cursor;
                // A retained old user can follow the freshly written summary
                // after native compaction relinking. Rank the reconstructed
                // window by its newest conversational ancestor, not just that
                // retained user's original physical position.
                position = Math.max(position, positions.get(cursor)!);
            }
            if (item.type === 'system' && item.subtype === 'compact_boundary') {
                const boundaryPosition = positions.get(cursor)!;
                const kept = retainedByBoundary.get(cursor)!;
                // Relinking a retained parent does not keep its discarded old
                // descendants. Only the native explicit keep set can cross
                // the physical compaction cut from the old window.
                const path = [...visited];
                let discardedThrough = -1;
                path.forEach((id, index) => {
                    if (positions.get(id)! < boundaryPosition && !kept.has(id)) discardedThrough = index;
                });
                if (discardedThrough >= 0) {
                    // Cutting a discarded child can make its kept parent the
                    // new leaf; do not lose that valid retained endpoint.
                    const retainedPath = path.slice(discardedThrough + 1);
                    candidateLeaf = retainedPath[0];
                    conversation = retainedPath.find((id) => isConversation(byUuid.get(id)!));
                    position = retainedPath.reduce((newest, id) => isConversation(byUuid.get(id)!)
                        ? Math.max(newest, positions.get(id)!) : newest, -1);
                }
                break;
            }
            cursor = parents.get(cursor);
        }
        if (conversation) candidates.push({ conversation, leaf: candidateLeaf, position });
    }
    const mainline = candidates.filter(({ conversation }) => isMainline(byUuid.get(conversation)!));
    const selected = (mainline.length ? mainline : candidates).sort((a, b) =>
        a.position - b.position
        || positions.get(a.leaf)! - positions.get(b.leaf)!,
    ).at(-1);
    for (const [uuid, item] of byUuid) {
        if (item.type === 'system' && item.subtype === 'compact_boundary' && !item.isSidechain && !item.teamName
            && positions.get(uuid)! > (selected?.position ?? -1)) {
            throw new Error('Claude compaction summary is not recorded');
        }
    }
    let cursor = selected?.leaf ?? leaves.at(-1);
    const chain: TraceRecord[] = [];
    const selectedIds = new Set<string>();
    while (cursor) {
        if (selectedIds.has(cursor)) throw new Error('Invalid Claude parent chain');
        const item = byUuid.get(cursor);
        if (!item) throw new Error('Claude parent message is not recorded');
        selectedIds.add(cursor);
        chain.unshift(item);
        if (item.type === 'system' && item.subtype === 'compact_boundary') break;
        cursor = parents.get(cursor);
    }
    // Native assistant streaming can persist parallel chunks with the same
    // message.id, and tool results can hang from those sibling UUIDs.
    const assistantId = (item: TraceRecord) => item.type === 'assistant' ? record(item.message)?.id : undefined;
    const groups = new Map<string, TraceRecord[]>();
    const toolResults = new Map<unknown, TraceRecord[]>();
    for (const item of byUuid.values()) {
        const id = assistantId(item);
        if (typeof id === 'string') {
            const siblings = groups.get(id) ?? [];
            siblings.push(item);
            groups.set(id, siblings);
        } else if (item.type === 'user' && Array.isArray(record(item.message)?.content)
            && (record(item.message)!.content as unknown[]).some((part) => record(part)?.type === 'tool_result')) {
            const results = toolResults.get(item.parentUuid) ?? [];
            results.push(item);
            toolResults.set(item.parentUuid, results);
        }
    }
    const activeGroups = new Map<string, TraceRecord>();
    for (const item of chain) {
        const id = assistantId(item);
        if (typeof id === 'string') activeGroups.set(id, item);
    }
    const extras = new Map<TraceRecord, TraceRecord[]>();
    for (const [id, active] of activeGroups) {
        const siblings = groups.get(id)!;
        const results = siblings.flatMap((item) => toolResults.get(item.uuid) ?? []);
        const byTime = (a: TraceRecord, b: TraceRecord) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? ''));
        const missing = [...siblings.filter((item) => !selectedIds.has(item.uuid as string)).sort(byTime),
            ...results.filter((item) => !selectedIds.has(item.uuid as string)).sort(byTime)];
        missing.forEach((item) => selectedIds.add(item.uuid as string));
        extras.set(active, missing);
    }
    let current = chain.flatMap((item) => [item, ...(extras.get(item) ?? [])]);
    let boundary = -1;
    current.forEach((item, index) => {
        if (item.type === 'system' && item.subtype === 'compact_boundary') boundary = index;
    });
    current = current.slice(Math.max(0, boundary));
    if (current.some((item) => incompleteBoundaries.has(item.uuid as string))) {
        throw new Error('Preserved Claude message is not recorded');
    }
    const currentIds = new Set(current.map((item) => item.uuid));
    const physicalStart = boundary >= 0 ? positions.get(current[0].uuid as string)! : 0;
    const metadataByParent = new Map<unknown, TraceRecord[]>();
    let previousUuid: unknown;
    let previousCurrentUuid: unknown;
    for (const item of records.slice(physicalStart)) {
        if (typeof item.uuid === 'string') {
            previousUuid = item.uuid;
            if (currentIds.has(item.uuid)) previousCurrentUuid = item.uuid;
            continue;
        }
        // Bookkeeping can name its owner even when it has no chain UUID.
        // Otherwise associate it only with the immediately preceding branch.
        const owner = item.messageId ?? item.leafUuid ?? item.parentUuid ?? record(item.snapshot)?.messageId ?? previousUuid;
        if (owner !== undefined && !currentIds.has(owner)) continue;
        metadataByParent.set(previousCurrentUuid, [...(metadataByParent.get(previousCurrentUuid) ?? []), item]);
    }
    return [...(metadataByParent.get(undefined) ?? []), ...current.flatMap((item) => [item, ...(metadataByParent.get(item.uuid) ?? [])])];
}

/** Read recorded content, without applying the chat's message-kind filters. */
export function parseClaudeContextWindow(text: string): ContextWindowSuccess {
    const records = readJsonl(text);
    return {
        type: 'success',
        provider: 'claude',
        entries: claudeCurrentBranch(records).map(entry),
        limitations: ['claude_system_prompt_unrecorded', 'claude_tool_definitions_unrecorded', 'provider_input_not_fully_recorded'],
    };
}

export function parseCodexContextWindow(text: string): ContextWindowSuccess {
    const records = readJsonl(text);
    let baseInstructions: string | undefined;
    let sessionMetadata: ContextWindowEntry | undefined;
    let entries: ContextWindowEntry[] = [];
    let compactedHistoryUnrecorded = false;
    let historyUnavailable = false;
    for (const value of records) {
        const payload = record(value.payload);
        if (value.type === 'session_meta') {
            const instructions = payload?.base_instructions;
            const text = typeof instructions === 'string' ? instructions : record(instructions)?.text;
            if (typeof text === 'string') baseInstructions = text;
            // Native dynamic_tools and other persisted configuration are part
            // of the recoverable context too. Keep the actual metadata across
            // compaction; show base text separately without duplicating it.
            const { base_instructions: _base, ...metadata } = payload ?? {};
            sessionMetadata = entry({ ...value, payload: metadata });
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
    if (sessionMetadata) entries.unshift(sessionMetadata);
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
