import { InvalidateSync } from "@/utils/sync";
import { RawJSONLines, RawJSONLinesSchema } from "../types";
import { parseClaudeGoalStatusTranscriptEvent, type ClaudeGoalStatusTranscriptEvent } from "../claudeGoalStatus";
import { join } from "node:path";
import { open, stat } from "node:fs/promises";
import { logger } from "@/ui/logger";
import { startFileWatcher } from "@/modules/watcher/startFileWatcher";
import { getProjectPath } from "./path";

/**
 * Known internal Claude Code event types that should be silently skipped.
 * These are written to session JSONL files by Claude Code but are not 
 * actual conversation messages - they're internal state/tracking events.
 */
const INTERNAL_CLAUDE_EVENT_TYPES = new Set([
    'file-history-snapshot',
    'change',
    'queue-operation',
]);

export type ScannerTranscriptEvent = ClaudeGoalStatusTranscriptEvent;

type SessionLogEntry =
    | { kind: 'message'; key: string; message: RawJSONLines }
    | { kind: 'transcript-event'; key: string; event: ScannerTranscriptEvent };

export async function createSessionScanner(opts: {
    sessionId: string | null,
    workingDirectory: string
    onMessage: (message: RawJSONLines) => void
    onTranscriptEvent?: (event: ScannerTranscriptEvent) => void
    /**
     * How long a session transcript may stay absent before its watcher gives
     * up and the session is dropped. Defaults to the startFileWatcher default
     * (60s). Exposed mainly so tests can exercise the drop path quickly.
     */
    missingFileTimeoutMs?: number
}) {

    // Resolve project directory
    const projectDir = getProjectPath(opts.workingDirectory);

    // Finished, pending finishing and current session
    let finishedSessions = new Set<string>();
    let pendingSessions = new Set<string>();
    let currentSessionId: string | null = null;
    let watchers = new Map<string, (() => void)>();
    let processedEntryKeys = new Set<string>();
    // How far each transcript has been read, so a pass parses only new lines
    let cursors = new Map<string, TranscriptCursor>();
    // Sessions whose transcript file never appeared. Their watcher gave up,
    // so we must stop re-reading them and never re-create a watcher for them
    // — otherwise a phantom session id (e.g. a remote launch whose .jsonl is
    // never written) keeps itself alive forever via the watchers map below
    // and spins the CPU / floods the log (the "dead HappyHerd instance" bug).
    let deadSessions = new Set<string>();

    // Mark existing entries as processed and start watching the initial session
    if (opts.sessionId) {
        let entries = await readNewSessionEntries(projectDir, opts.sessionId, cursors);
        logger.debug(`[SESSION_SCANNER] Marking ${entries.length} existing entries as processed from session ${opts.sessionId}`);
        for (let entry of entries) {
            processedEntryKeys.add(entry.key);
        }
        // IMPORTANT: Also start watching the initial session file because Claude Code
        // may continue writing to it even after creating a new session with --resume
        // (agent tasks and other updates can still write to the original session file)
        currentSessionId = opts.sessionId;
    }

    // Main sync function
    const sync = new InvalidateSync(async () => {

        // Collect session ids - include ALL sessions that have watchers
        // This ensures we continue processing sessions that Claude Code may still write to
        let sessions: string[] = [];
        for (let p of pendingSessions) {
            if (!deadSessions.has(p)) {
                sessions.push(p);
            }
        }
        if (currentSessionId && !pendingSessions.has(currentSessionId) && !deadSessions.has(currentSessionId)) {
            sessions.push(currentSessionId);
        }
        // Also process sessions that have active watchers (they may still receive updates)
        for (let [sessionId] of watchers) {
            if (!sessions.includes(sessionId) && !deadSessions.has(sessionId)) {
                sessions.push(sessionId);
            }
        }

        // Process sessions
        for (let session of sessions) {
            const sessionEntries = await readNewSessionEntries(projectDir, session, cursors);
            let skipped = 0;
            let sentMessages = 0;
            let sentTranscriptEvents = 0;
            for (let entry of sessionEntries) {
                if (processedEntryKeys.has(entry.key)) {
                    skipped++;
                    continue;
                }
                processedEntryKeys.add(entry.key);
                if (entry.kind === 'message') {
                    logger.debug(`[SESSION_SCANNER] Sending new message: type=${entry.message.type}, uuid=${entry.message.type === 'summary' ? entry.message.leafUuid : entry.message.uuid}`);
                    opts.onMessage(entry.message);
                    sentMessages++;
                } else {
                    logger.debug(`[SESSION_SCANNER] Sending new transcript event: type=${entry.event.type}, uuid=${entry.event.uuid}`);
                    opts.onTranscriptEvent?.(entry.event);
                    sentTranscriptEvents++;
                }
            }
            if (sessionEntries.length > 0) {
                logger.debug(`[SESSION_SCANNER] Session ${session}: found=${sessionEntries.length}, skipped=${skipped}, sentMessages=${sentMessages}, sentTranscriptEvents=${sentTranscriptEvents}`);
            }
        }

        // Move pending sessions to finished sessions (but keep processing them via watchers)
        for (let p of sessions) {
            if (pendingSessions.has(p)) {
                pendingSessions.delete(p);
                finishedSessions.add(p);
            }
        }

        // Update watchers for all sessions
        for (let p of sessions) {
            if (!watchers.has(p) && !deadSessions.has(p)) {
                logger.debug(`[SESSION_SCANNER] Starting watcher for session: ${p}`);
                watchers.set(p, startFileWatcher(
                    join(projectDir, `${p}.jsonl`),
                    () => { sync.invalidate(); },
                    {
                        missingFileTimeoutMs: opts.missingFileTimeoutMs,
                        onGaveUp: () => {
                            // The transcript for this session never appeared.
                            // Tear the watcher down and blacklist the session
                            // so the collection loop above stops resurrecting
                            // it. Without this the phantom session would keep
                            // itself in `watchers` forever.
                            logger.debug(`[SESSION_SCANNER] Session ${p} transcript never appeared — dropping it`);
                            watchers.get(p)?.();
                            watchers.delete(p);
                            deadSessions.add(p);
                            pendingSessions.delete(p);
                        },
                    },
                ));
            }
        }
    });
    await sync.invalidateAndAwait();

    // Periodic sync
    const intervalId = setInterval(() => { sync.invalidate(); }, 3000);

    // Public interface
    return {
        cleanup: async () => {
            clearInterval(intervalId);
            for (let w of watchers.values()) {
                w();
            }
            watchers.clear();
            await sync.invalidateAndAwait();
            sync.stop();
        },
        onNewSession: async (sessionId: string, options?: { treatExistingAsProcessed?: boolean }) => {
            if (currentSessionId === sessionId) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is the same as the current session, skipping`);
                return;
            }
            // The caller explicitly re-announces this session, so give a
            // previously-dropped id another chance (its file may exist now).
            if (deadSessions.delete(sessionId)) {
                logger.debug(`[SESSION_SCANNER] Reviving previously-dropped session: ${sessionId}`);
            }
            if (finishedSessions.has(sessionId)) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already finished, skipping`);
                return;
            }
            if (pendingSessions.has(sessionId)) {
                logger.debug(`[SESSION_SCANNER] New session: ${sessionId} is already pending, skipping`);
                return;
            }
            // When the caller already has these messages (typical for
            // happyherd-reconnect — the server holds the history from prior
            // turns and metadata.claudeSessionId simply hadn't propagated
            // by the time we built the scanner), pre-mark whatever is on
            // disk so the first invalidate() does not replay the entire
            // file as fresh user prompts. Without this, every previous
            // user message re-appears in the chat after reconnect.
            if (options?.treatExistingAsProcessed) {
                const existing = await readNewSessionEntries(projectDir, sessionId, cursors);
                logger.debug(`[SESSION_SCANNER] Pre-marking ${existing.length} existing entries as processed for new session ${sessionId}`);
                for (const entry of existing) {
                    processedEntryKeys.add(entry.key);
                }
            }
            if (currentSessionId) {
                pendingSessions.add(currentSessionId);
            }
            logger.debug(`[SESSION_SCANNER] New session: ${sessionId}`)
            currentSessionId = sessionId;
            sync.invalidate();
        },
    }
}

export type SessionScanner = ReturnType<typeof createSessionScanner>;


//
// Helpers
//

function messageKey(message: RawJSONLines): string {
    if (message.type === 'user') {
        return message.uuid;
    } else if (message.type === 'assistant') {
        return message.uuid;
    } else if (message.type === 'summary') {
        return 'summary: ' + message.leafUuid + ': ' + message.summary;
    } else if (message.type === 'system') {
        return message.uuid;
    } else {
        throw Error() // Impossible
    }
}

function transcriptEventKey(event: ScannerTranscriptEvent): string {
    return `event:${event.uuid}`;
}

type TranscriptCursor = { offset: number; ino: number };

/**
 * Read and parse the part of a session log file written since the last read.
 * Transcripts are append-only JSONL, so the cursor only advances past
 * complete lines; a replaced or truncated file is read again from the start
 * and its already-processed entries are skipped by key.
 * Returns only valid conversation messages and recognized side-channel events,
 * silently skipping internal events.
 */
async function readNewSessionEntries(projectDir: string, sessionId: string, cursors: Map<string, TranscriptCursor>): Promise<SessionLogEntry[]> {
    const expectedSessionFile = join(projectDir, `${sessionId}.jsonl`);
    let fileStat;
    try {
        fileStat = await stat(expectedSessionFile);
    } catch (error) {
        logger.debug(`[SESSION_SCANNER] Session file not found: ${expectedSessionFile}`);
        return [];
    }
    let cursor = cursors.get(sessionId);
    if (!cursor || cursor.ino !== fileStat.ino || fileStat.size < cursor.offset) {
        cursor = { offset: 0, ino: fileStat.ino };
    }
    if (fileStat.size === cursor.offset) {
        cursors.set(sessionId, cursor);
        return [];
    }

    logger.debug(`[SESSION_SCANNER] Reading session file: ${expectedSessionFile} from byte ${cursor.offset}`);
    let chunk: Buffer;
    try {
        const handle = await open(expectedSessionFile, 'r');
        try {
            const buffer = Buffer.alloc(fileStat.size - cursor.offset);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, cursor.offset);
            chunk = buffer.subarray(0, bytesRead);
        } finally {
            await handle.close();
        }
    } catch (error) {
        logger.debug(`[SESSION_SCANNER] Session file not found: ${expectedSessionFile}`);
        return [];
    }

    // Parse complete lines only; a final line without a newline is used once
    // it is valid JSON, otherwise it is still being written.
    let end = chunk.lastIndexOf(0x0a) + 1;
    const lines = chunk.subarray(0, end).toString('utf-8').split('\n');
    const tail = chunk.subarray(end).toString('utf-8');
    if (tail.trim() !== '' && isCompleteJson(tail)) {
        lines.push(tail);
        end = chunk.length;
    }
    cursors.set(sessionId, { offset: cursor.offset + end, ino: fileStat.ino });

    let entries: SessionLogEntry[] = [];
    for (let l of lines) {
        try {
            if (l.trim() === '') {
                continue;
            }
            let message = JSON.parse(l);
            
            // Silently skip known internal Claude Code events
            // These are state/tracking events, not conversation messages
            if (message.type && INTERNAL_CLAUDE_EVENT_TYPES.has(message.type)) {
                continue;
            }

            const transcriptEvent = parseClaudeGoalStatusTranscriptEvent(message);
            if (transcriptEvent) {
                entries.push({
                    kind: 'transcript-event',
                    key: transcriptEventKey(transcriptEvent),
                    event: transcriptEvent,
                });
                continue;
            }
            
            // Interactive Claude stores child activity inside agent_progress
            // rows in the parent transcript. Feed the native child message to
            // the same mapper used by SDK sidechains, keeping its UUID for replay.
            if (message.type === 'progress' && message.data?.type === 'agent_progress'
                && typeof message.parentToolUseID === 'string'
                && (message.data.message?.type === 'assistant' || message.data.message?.type === 'user')) {
                message = {
                    ...message.data.message,
                    isSidechain: true,
                    parent_tool_use_id: message.parentToolUseID,
                };
            }
            let parsed = RawJSONLinesSchema.safeParse(message);
            if (!parsed.success) {
                // Unknown message types are silently skipped
                continue;
            }
            entries.push({
                kind: 'message',
                key: messageKey(parsed.data),
                message: parsed.data,
            });
        } catch (e) {
            logger.debug(`[SESSION_SCANNER] Error processing message: ${e}`);
            continue;
        }
    }
    return entries;
}

function isCompleteJson(text: string): boolean {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}
