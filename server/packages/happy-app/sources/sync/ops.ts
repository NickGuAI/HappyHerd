/**
 * Session operations for remote procedure calls
 * Provides strictly typed functions for all session-related RPC operations
 */

import { apiSocket } from './apiSocket';
import { sync } from './sync';
import { storage } from './storage';
import type { AgentQuestionAnswer, MachineMetadata, SessionAgentModesPatch } from './storageTypes';
import { markAgentModePushPending, clearAgentModePushPending, type AgentModeField } from './agentModesPending';
import {
    isRigMetadata,
    rigCanAbort,
    rigCanReadFiles,
    rigCanSearchFiles,
    rigCanUseShell,
    rigCanWriteFiles,
    rigHasRpcMethod,
    sessionCanDeleteFiles,
} from './rig';
import type { HappyAgentSpawnTarget } from './happyAgentSpawn';
import {
    MAX_WORKSPACE_UPLOAD_BYTES,
    MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH,
    WorkspaceFileHashResponseSchema,
} from '@slopus/happy-wire';
import type {
    GrokPermissionModeTransitionReceipt,
    HappyHerdAutomation,
    HappyHerdAutomationCreateInput,
    HappyHerdAutomationHistoryResponse,
    HappyHerdAutomationListResponse,
    HappyHerdAutomationRun,
    HappyHerdAutomationUpdateInput,
    HappyHerdHeartbeatControlInput,
    HappyHerdHeartbeatControlResponse,
    HappyHerdCommanderListResponse,
    HappyHerdMachineSessionSettings,
    WorkspaceFileHashRequest,
    WorkspaceFileHashResponse,
    WorkspaceUploadAbortResponse,
    WorkspaceUploadChunkRequest,
    WorkspaceUploadChunkResponse,
    WorkspaceUploadFinishRequest,
    WorkspaceUploadRequest,
    WorkspaceUploadResponse,
    WorkspaceUploadStartRequest,
    WorkspaceUploadStartResponse,
} from '@slopus/happy-wire';
import { GrokPermissionModeTransitionReceiptSchema } from '@slopus/happy-wire';

export type { SessionAgentModesPatch };

// Strict type definitions for all operations

// Permission operation types
interface SessionPermissionRequest {
    id: string;
    approved: boolean;
    reason?: string;
    mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    allowTools?: string[];
    updatedInput?: Record<string, unknown>;
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
}

/**
 * Reply to an agent-to-user communication. Separate from the permission channel
 * on purpose: nothing here approves or denies an action, it carries information
 * the agent asked for. `kind` mirrors the request so the agent can route the
 * reply once other kinds of communication exist.
 */
interface SessionCommunicationReply {
    id: string;
    kind: string;
    status: 'answered' | 'cancelled';
    answers?: Record<string, AgentQuestionAnswer>;
}

// Mode change operation types
interface SessionModeChangeRequest {
    to: 'remote' | 'local';
}

interface SessionGoalActionRequest {
    action: 'clear' | 'stop' | 'edit';
    objective?: string;
}

// Bash operation types
interface SessionBashRequest {
    command: string;
    cwd?: string;
    timeout?: number;
}

interface SessionBashResponse {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: string;
}

// Read file operation types
interface SessionReadFileRequest {
    path: string;
}

interface MachineReadFileWithinRootRequest {
    path: string;
    rootPath: string;
}

interface SessionReadFileResponse {
    success: boolean;
    content?: string; // base64 encoded
    error?: string;
}

// Write file operation types
interface SessionWriteFileRequest {
    path: string;
    content: string; // base64 encoded
    expectedHash?: string | null;
}

interface SessionWriteFileResponse {
    success: boolean;
    hash?: string;
    error?: string;
}

interface SessionDeleteFileRequest {
    path: string;
}

interface SessionDeleteFileResponse {
    success: boolean;
    error?: string;
}

function base64CharacterValue(code: number): number {
    if (code >= 65 && code <= 90) return code - 65;
    if (code >= 97 && code <= 122) return code - 71;
    if (code >= 48 && code <= 57) return code + 4;
    if (code === 43) return 62;
    if (code === 47) return 63;
    return -1;
}

function isCanonicalBase64Content(content: string): boolean {
    if (content.length % 4 !== 0) return false;
    const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
    const dataLength = content.length - padding;
    for (let index = 0; index < dataLength; index += 1) {
        if (base64CharacterValue(content.charCodeAt(index)) < 0) return false;
    }
    if (content.indexOf('=') !== (padding > 0 ? dataLength : -1)) return false;
    if (padding === 2 && (base64CharacterValue(content.charCodeAt(dataLength - 1)) & 0x0f) !== 0) return false;
    if (padding === 1 && (base64CharacterValue(content.charCodeAt(dataLength - 1)) & 0x03) !== 0) return false;
    return true;
}

// List directory operation types
interface SessionListDirectoryRequest {
    path: string;
}

interface DirectoryEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    size?: number;
    modified?: number;
}

interface SessionListDirectoryResponse {
    success: boolean;
    entries?: DirectoryEntry[];
    error?: string;
}

// Directory tree operation types
interface SessionGetDirectoryTreeRequest {
    path: string;
    maxDepth: number;
}

export interface DirectoryTreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: number;
    children?: DirectoryTreeNode[];
}

export interface DirectoryTreeResponse {
    success: boolean;
    tree?: DirectoryTreeNode;
    error?: string;
}

interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: number;
    children?: TreeNode[];
}

interface SessionGetDirectoryTreeResponse {
    success: boolean;
    tree?: TreeNode;
    error?: string;
}

// Ripgrep operation types
interface SessionRipgrepRequest {
    args: string[];
    cwd?: string;
}

interface SessionRipgrepResponse {
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
}

// Kill session operation types
interface SessionKillRequest {
    // No parameters needed
}

interface SessionKillResponse {
    success: boolean;
    message: string;
}

// Response types for spawn session
export type SpawnSessionResult =
    | { type: 'success'; sessionId: string; settings?: HappyHerdMachineSessionSettings }
    | { type: 'pending'; clientRequestId: string; retryAfterMs: number }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string };

export type SideChatCreateReceipt = {
    schemaVersion: 1;
    type: 'side-chat';
    action: 'create';
    success: boolean;
    parentSessionId: string | null;
    sessionId: string | null;
    phases: Array<{
        phase: string;
        status: 'succeeded' | 'skipped' | 'failed';
        message?: string;
    }>;
};

// Options for spawning a session
export interface SpawnSessionOptions {
    machineId: string;
    directory: string;
    approvedNewDirectoryCreation?: boolean;
    token?: string;
    agent?: 'codex' | 'claude' | 'grok' | 'gemini' | 'agy' | 'rig';
    permissionMode?: string;
    modelMode?: string;
    effortLevel?: string;
    commanderId?: string;
    /** Stable idempotency key required by Rig's machine RPC. */
    clientRequestId?: string;
    /** Rig-native provider/model selection. */
    providerId?: string;
    modelId?: string;
    effort?: string;
    /** Durable project/workspace destination for Happy Agent's native RPC. */
    happyAgentTarget?: HappyAgentSpawnTarget;
    /**
     * If set, the daemon spawns the agent with `--resume <id>` so the new
     * Happy session attaches to a pre-existing on-disk Claude conversation
     * file. Used by the session fork / duplicate flow.
     */
    resumeClaudeSessionId?: string;
    /**
     * If set, the daemon spawns Codex with `--resume <id>` so the new Happy
     * session attaches to an app-server thread created by fork / duplicate.
     */
    resumeCodexThreadId?: string;
    /** Happy session id this fork was branched from (lineage). */
    parentSessionId?: string;
    /** Happy message id used as the rewind point (only set for "duplicate"). */
    forkedFromMessageId?: string;
    /** Source Happy session for a fresh cross-provider continuation. */
    continuedFromSessionId?: string;
}

// Options for forking a Claude session on a machine
export interface ClaudeForkSessionOptions {
    machineId: string;
    /** Working directory of the source session — used to derive the Claude project dir. */
    directory: string;
    /** Source Claude session UUID (Session.metadata.claudeSessionId on the parent). */
    claudeSessionId: string;
}

export type ClaudeForkSessionResult =
    | { type: 'success'; newClaudeSessionId: string }
    | { type: 'error'; errorMessage: string };

export interface ClaudeRewindPoint {
    uuid: string;
    text: string;
    timestamp: number;
}

export type ClaudeListRewindPointsResult =
    | { type: 'success'; points: ClaudeRewindPoint[] }
    | { type: 'error'; errorMessage: string };

export interface CodexForkThreadOptions {
    machineId: string;
    /** Working directory of the source session, passed to Codex thread/fork. */
    directory: string;
    /** Source Codex app-server thread id (Session.metadata.codexThreadId). */
    codexThreadId: string;
}

export type CodexForkThreadResult =
    | { type: 'success'; newCodexThreadId: string }
    | { type: 'error'; errorMessage: string };

export interface CodexRewindPoint {
    itemId: string;
    text: string;
    timestamp: number;
}

export type CodexListRewindPointsResult =
    | { type: 'success'; points: CodexRewindPoint[] }
    | { type: 'error'; errorMessage: string };

export interface ResumeSessionOptions {
    machineId: string;
    sessionId: string;
    /** Existing queued user record that reconnect catch-up must deliver. */
    replayQueueMessageId?: string;
}

// Exported session operation functions

/**
 * Spawn a new remote session on a specific machine
 */
export async function machineSpawnNewSession(options: SpawnSessionOptions): Promise<SpawnSessionResult> {

    const { machineId, directory, approvedNewDirectoryCreation = false, token, agent, permissionMode, modelMode, effortLevel, commanderId, clientRequestId, providerId, modelId, effort, happyAgentTarget, resumeClaudeSessionId, resumeCodexThreadId, parentSessionId, forkedFromMessageId, continuedFromSessionId } = options;

    try {
        if (agent === 'rig' && !clientRequestId) {
            throw new Error('Rig session creation requires a client request ID');
        }
        if (happyAgentTarget && agent !== 'rig') {
            throw new Error('Happy Agent catalog targets require the Happy Agent harness');
        }
        type DirectorySpawnRequest = {
            type: 'spawn-in-directory'
            directory: string
            approvedNewDirectoryCreation?: boolean,
            token?: string,
            agent?: 'codex' | 'claude' | 'grok' | 'gemini' | 'agy' | 'rig',
            permissionMode?: string,
            modelMode?: string,
            effortLevel?: string,
            commanderId?: string,
            clientRequestId?: string,
            providerId?: string,
            modelId?: string,
            effort?: string,
            resumeClaudeSessionId?: string,
            resumeCodexThreadId?: string,
            parentSessionId?: string,
            forkedFromMessageId?: string,
            continuedFromSessionId?: string,
        };
        type HappyAgentSpawnRequest = {
            type: 'happy-agent-spawn';
            clientRequestId: string;
            target: HappyAgentSpawnTarget;
            agentConfiguration: {
                type: 'happy-agent';
                permissionMode?: string;
                providerId?: string;
                modelId?: string;
                effort?: string;
            };
        };
        type SpawnRequest = DirectorySpawnRequest | HappyAgentSpawnRequest;
        const request: SpawnRequest = agent === 'rig' && happyAgentTarget
            ? {
                type: 'happy-agent-spawn',
                clientRequestId: clientRequestId!,
                target: happyAgentTarget,
                agentConfiguration: {
                    type: 'happy-agent',
                    ...(permissionMode ? { permissionMode } : {}),
                    ...(providerId ? { providerId } : {}),
                    ...(modelId ? { modelId } : {}),
                    ...((effort ?? effortLevel) ? { effort: effort ?? effortLevel } : {}),
                },
            }
            : agent === 'rig'
            ? {
                type: 'spawn-in-directory',
                agent: 'rig',
                directory,
                approvedNewDirectoryCreation,
                ...(clientRequestId ? { clientRequestId } : {}),
                ...(permissionMode ? { permissionMode } : {}),
                ...(providerId ? { providerId } : {}),
                ...(modelId ? { modelId } : {}),
                ...((effort ?? effortLevel) ? { effort: effort ?? effortLevel } : {}),
            }
            : { type: 'spawn-in-directory', directory, approvedNewDirectoryCreation, token, agent, permissionMode, modelMode, effortLevel, commanderId, resumeClaudeSessionId, resumeCodexThreadId, parentSessionId, forkedFromMessageId, continuedFromSessionId };
        const result = await apiSocket.machineRPC<SpawnSessionResult, SpawnRequest>(
            machineId,
            'spawn-happy-session',
            request,
        );
        return result;
    } catch (error) {
        // Handle RPC errors
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to spawn session'
        };
    }
}

export async function machineListCommanders(machineId: string): Promise<HappyHerdCommanderListResponse> {
    return apiSocket.machineRPC<HappyHerdCommanderListResponse, Record<string, never>>(
        machineId,
        'happyherd-list-commanders',
        {},
    );
}

/** Create an empty durable child for the Human through the dedicated daemon lifecycle. */
export async function machineCreateSideChat(
    machineId: string,
    parentSessionId: string,
): Promise<SideChatCreateReceipt> {
    const receipt = await apiSocket.machineRPC<SideChatCreateReceipt, {
        parentSessionId: string;
    }>(machineId, 'happyherd-side-chat-create', { parentSessionId });
    if (receipt.success && receipt.sessionId) {
        // The receipt is authoritative. A websocket hydration failure must not
        // turn an already-created child into a false creation failure.
        try {
            await sync.refreshSessions();
        } catch {
            // The normal websocket session event can still hydrate the child.
        }
    }
    return receipt;
}

async function machineAutomationRPC<T>(machineId: string, method: string, params: unknown): Promise<T> {
    const result = await apiSocket.machineRPC<T | { error: string }, unknown>(machineId, method, params);
    if (result && typeof result === 'object' && 'error' in result && typeof result.error === 'string') {
        throw new Error(result.error);
    }
    return result as T;
}

export async function machineListAutomations(machineId: string): Promise<HappyHerdAutomationListResponse> {
    return machineAutomationRPC(machineId, 'happyherd-automations-list', {});
}

export async function machineCreateAutomation(
    machineId: string,
    input: HappyHerdAutomationCreateInput,
): Promise<HappyHerdAutomation> {
    return machineAutomationRPC(machineId, 'happyherd-automations-create', input);
}

export async function machineUpdateAutomation(
    machineId: string,
    id: string,
    patch: HappyHerdAutomationUpdateInput,
): Promise<HappyHerdAutomation> {
    return machineAutomationRPC(machineId, 'happyherd-automations-update', { id, patch });
}

export async function machinePauseAutomation(machineId: string, id: string): Promise<HappyHerdAutomation> {
    return machineAutomationRPC(machineId, 'happyherd-automations-pause', { id });
}

export async function machineResumeAutomation(machineId: string, id: string): Promise<HappyHerdAutomation> {
    return machineAutomationRPC(machineId, 'happyherd-automations-resume', { id });
}

export async function machineDeleteAutomation(machineId: string, id: string): Promise<void> {
    await machineAutomationRPC(machineId, 'happyherd-automations-delete', { id });
}

export async function machineRunAutomationNow(machineId: string, id: string): Promise<HappyHerdAutomationRun> {
    return machineAutomationRPC(machineId, 'happyherd-automations-run-now', { id });
}

export async function machineAutomationHistory(
    machineId: string,
    id: string,
): Promise<HappyHerdAutomationHistoryResponse> {
    return machineAutomationRPC(machineId, 'happyherd-automations-history', { id });
}

export async function machineControlHeartbeat(
    machineId: string,
    input: HappyHerdHeartbeatControlInput,
): Promise<HappyHerdHeartbeatControlResponse> {
    return machineAutomationRPC(machineId, 'happyherd-heartbeat-control', input);
}

/**
 * Copy the source session's Claude JSONL on the daemon machine and return
 * the new Claude session UUID. Caller then spawns a fresh Happy session
 * with `resumeClaudeSessionId` set to that UUID to attach a new Happy
 * session row to the copied conversation.
 */
export async function claudeForkSession(options: ClaudeForkSessionOptions): Promise<ClaudeForkSessionResult> {
    const { machineId, directory, claudeSessionId } = options;
    try {
        const result = await apiSocket.machineRPC<ClaudeForkSessionResult, {
            directory: string;
            claudeSessionId: string;
        }>(
            machineId,
            'claude-fork-session',
            { directory, claudeSessionId },
        );
        return result;
    } catch (error) {
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to fork session',
        };
    }
}

/**
 * Read the on-disk Claude JSONL on the daemon machine and return user-text
 * messages with their underlying claudeUuid + timestamp. Disk is the
 * source of truth for the rewind picker — server-side envelopes miss
 * claudeUuid for any user message that travelled via the legacy
 * `sentFrom: 'web'` path.
 */
export async function claudeListRewindPoints(
    options: ClaudeForkSessionOptions,
): Promise<ClaudeListRewindPointsResult> {
    const { machineId, directory, claudeSessionId } = options;
    try {
        const result = await apiSocket.machineRPC<ClaudeListRewindPointsResult, {
            directory: string;
            claudeSessionId: string;
        }>(
            machineId,
            'claude-list-rewind-points',
            { directory, claudeSessionId },
        );
        return result;
    } catch (error) {
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to list rewind points',
        };
    }
}

/**
 * Same as claudeForkSession, but truncates the copied JSONL right after the
 * line with `cutAfterUuid` (keeping the chosen message as the last entry,
 * dropping every line after — including the agent's response). Use this
 * for "rewind to message N and try again" flows. Daemon hard-fails if the
 * UUID isn't present in the source — never silently produces a
 * non-truncated copy.
 */
export async function claudeDuplicateSession(
    options: ClaudeForkSessionOptions & { cutAfterUuid: string },
): Promise<ClaudeForkSessionResult> {
    const { machineId, directory, claudeSessionId, cutAfterUuid } = options;
    try {
        const result = await apiSocket.machineRPC<ClaudeForkSessionResult, {
            directory: string;
            claudeSessionId: string;
            cutAfterUuid: string;
        }>(
            machineId,
            'claude-duplicate-session',
            { directory, claudeSessionId, cutAfterUuid },
        );
        return result;
    } catch (error) {
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to duplicate session',
        };
    }
}

export async function codexForkThread(options: CodexForkThreadOptions): Promise<CodexForkThreadResult> {
    const { machineId, directory, codexThreadId } = options;
    try {
        const result = await apiSocket.machineRPC<CodexForkThreadResult, {
            directory: string;
            codexThreadId: string;
        }>(
            machineId,
            'codex-fork-thread',
            { directory, codexThreadId },
        );
        return result;
    } catch (error) {
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to fork Codex thread',
        };
    }
}

export async function codexDuplicateThread(
    options: CodexForkThreadOptions & { cutAfterItemId: string },
): Promise<CodexForkThreadResult> {
    const { machineId, directory, codexThreadId, cutAfterItemId } = options;
    try {
        const result = await apiSocket.machineRPC<CodexForkThreadResult, {
            directory: string;
            codexThreadId: string;
            cutAfterItemId: string;
        }>(
            machineId,
            'codex-duplicate-thread',
            { directory, codexThreadId, cutAfterItemId },
        );
        return result;
    } catch (error) {
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to duplicate Codex thread',
        };
    }
}

export async function codexListRewindPoints(
    options: CodexForkThreadOptions,
): Promise<CodexListRewindPointsResult> {
    const { machineId, directory, codexThreadId } = options;
    try {
        const result = await apiSocket.machineRPC<CodexListRewindPointsResult, {
            directory: string;
            codexThreadId: string;
        }>(
            machineId,
            'codex-list-rewind-points',
            { directory, codexThreadId },
        );
        return result;
    } catch (error) {
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to list Codex rewind points',
        };
    }
}

export async function machineResumeSession(options: ResumeSessionOptions & {
    model?: string;
    effortLevel?: string;
    permissionMode?: string;
}): Promise<SpawnSessionResult> {
    const { machineId, sessionId, model, effortLevel, permissionMode, replayQueueMessageId } = options;

    try {
        const result = await apiSocket.machineRPC<SpawnSessionResult, {
            sessionId: string;
            model?: string;
            effortLevel?: string;
            permissionMode?: string;
            replayQueueMessageId?: string;
        }>(
            machineId,
            'resume-happy-session',
            { sessionId, model, effortLevel, permissionMode, replayQueueMessageId },
        );
        return result;
    } catch (error) {
        return {
            type: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to resume session',
        };
    }
}

export async function machineTransitionGrokPermissionMode(
    machineId: string,
    sessionId: string,
    permissionMode: string,
): Promise<GrokPermissionModeTransitionReceipt> {
    const receipt = await apiSocket.machineRPC<GrokPermissionModeTransitionReceipt, {
        sessionId: string;
        permissionMode: string;
    }>(
        machineId,
        'grok-permission-mode-transition',
        { sessionId, permissionMode },
    );
    return GrokPermissionModeTransitionReceiptSchema.parse(receipt);
}

/**
 * Permanently remove a machine from the server. Sessions spawned by the
 * machine are preserved; only the Machine row and its AccessKeys are deleted.
 */
export async function machineDelete(machineId: string): Promise<{ success: boolean; message?: string }> {
    try {
        const response = await apiSocket.request(`/v1/machines/${machineId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            return { success: true };
        }
        const error = await response.text();
        return { success: false, message: error || 'Failed to delete machine' };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Ask the daemon that started a session to stop it, by SIGTERM to the process
 * it is tracking.
 *
 * This is the only stop that reaches a session which has only just been
 * spawned. `sessionKill` talks to the session's own RPC handler, which does not
 * exist until that process is up and has registered it, and it needs the
 * session's encryption key, which arrives with the sessions list — so for the
 * first seconds of a session's life it fails on both counts. The daemon's
 * socket, by contrast, is the one we just spawned through.
 */
export async function machineStopSession(
    machineId: string,
    sessionId: string,
): Promise<{ success: boolean; message?: string }> {
    try {
        const result = await apiSocket.machineRPC<{ message: string }, { sessionId: string }>(
            machineId,
            'stop-session',
            { sessionId },
        );
        return { success: true, message: result?.message };
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Failed to stop session',
        };
    }
}

/**
 * Stop the daemon on a specific machine
 */
export async function machineStopDaemon(machineId: string): Promise<{ message: string }> {
    const result = await apiSocket.machineRPC<{ message: string }, {}>(
        machineId,
        'stop-daemon',
        {}
    );
    return result;
}

/**
 * Browse the filesystem exposed by a machine daemon. Machine RPC handlers are
 * intentionally registered without a workspace root, so the daemon OS user's
 * own filesystem permissions are the only boundary.
 */
export async function machineGetDirectoryTree(
    machineId: string,
    path: string,
    maxDepth = 1,
): Promise<DirectoryTreeResponse> {
    try {
        return await apiSocket.machineRPC<DirectoryTreeResponse, { path: string; maxDepth: number }>(
            machineId,
            'getDirectoryTree',
            { path, maxDepth },
        );
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to browse machine directory',
        };
    }
}

/**
 * Read a file through the machine daemon rather than an agent session. This is
 * the transport used by the independent Machine Workspace, so browsing and
 * previewing do not require a running session.
 */
export async function machineReadFile(machineId: string, path: string): Promise<SessionReadFileResponse> {
    try {
        return await apiSocket.machineRPC<SessionReadFileResponse, SessionReadFileRequest>(
            machineId,
            'readFile',
            { path },
        );
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to read machine file',
        };
    }
}

/**
 * Read a file only when its machine-resolved path remains inside the supplied
 * machine-resolved root. This distinct method intentionally has no readFile
 * fallback: older daemons must fail closed instead of ignoring the root.
 */
export async function machineReadFileWithinRoot(
    machineId: string,
    path: string,
    rootPath: string,
): Promise<SessionReadFileResponse> {
    try {
        return await apiSocket.machineRPC<SessionReadFileResponse, MachineReadFileWithinRootRequest>(
            machineId,
            'readFileWithinRoot',
            { path, rootPath },
        );
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to read machine file within root',
        };
    }
}

/**
 * Read only a bounded regular file's size and SHA-256 identity. Newer daemon
 * support for this RPC is also the capability preflight for safe replacement.
 */
export async function machineHashFile(
    machineId: string,
    path: string,
    maxBytes: number,
): Promise<WorkspaceFileHashResponse> {
    try {
        const response = await apiSocket.machineRPC<WorkspaceFileHashResponse, WorkspaceFileHashRequest>(
            machineId,
            'hashFile',
            { path, maxBytes },
        );
        const parsed = WorkspaceFileHashResponseSchema.safeParse(response);
        if (!parsed.success) {
            return {
                success: false,
                code: 'unavailable',
                error: 'Machine runtime returned an unsupported file hash response',
            };
        }
        return parsed.data;
    } catch (error) {
        return {
            success: false,
            code: 'unavailable',
            error: error instanceof Error ? error.message : 'Machine runtime does not support file hashing',
        };
    }
}

/** Write a file through the machine daemon with optimistic hash protection. */
export async function machineWriteFile(
    machineId: string,
    path: string,
    content: string,
    expectedHash?: string | null,
): Promise<SessionWriteFileResponse> {
    try {
        return await apiSocket.machineRPC<SessionWriteFileResponse, SessionWriteFileRequest>(
            machineId,
            'writeFile',
            { path, content, expectedHash },
        );
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to write machine file',
        };
    }
}

/** Delete a machine-wide file when the connected daemon advertises the RPC. */
export async function machineDeleteFile(machineId: string, path: string): Promise<SessionDeleteFileResponse> {
    try {
        return await apiSocket.machineRPC<SessionDeleteFileResponse, SessionDeleteFileRequest>(
            machineId,
            'deleteFile',
            { path },
        );
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete machine file',
        };
    }
}

/** Upload one local client file, optionally replacing the expected current version atomically. */
export async function machineUploadFile(
    machineId: string,
    request: WorkspaceUploadRequest,
): Promise<WorkspaceUploadResponse> {
    let uploadId: string | undefined;
    try {
        const content = request.content.replace(/\s/g, '');
        if (!isCanonicalBase64Content(content)) {
            return { success: false, code: 'write-failed', error: 'File content is not valid base64' };
        }
        const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
        const size = (content.length / 4) * 3 - padding;
        if (size > MAX_WORKSPACE_UPLOAD_BYTES) {
            return { success: false, code: 'too-large', error: 'File is too large to upload (limit 20 MiB)' };
        }

        const start = await apiSocket.machineRPC<WorkspaceUploadStartResponse, WorkspaceUploadStartRequest>(
            machineId,
            'uploadFileStart',
            {
                directory: request.directory,
                fileName: request.fileName,
                size,
                ...(request.expectedHash ? { expectedHash: request.expectedHash } : {}),
            },
        );
        if (!start.success || !start.uploadId) {
            return {
                success: false,
                code: start.code ?? 'write-failed',
                error: start.error ?? 'Failed to start machine file upload',
            };
        }
        uploadId = start.uploadId;

        let offset = 0;
        for (let index = 0; index < content.length; index += MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH) {
            const chunkContent = content.slice(index, index + MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH);
            const chunk = await apiSocket.machineRPC<WorkspaceUploadChunkResponse, WorkspaceUploadChunkRequest>(
                machineId,
                'uploadFileChunk',
                { uploadId, offset, content: chunkContent },
            );
            const chunkPadding = chunkContent.endsWith('==') ? 2 : chunkContent.endsWith('=') ? 1 : 0;
            const expectedReceived = offset + (chunkContent.length / 4) * 3 - chunkPadding;
            if (!chunk.success || chunk.received !== expectedReceived) {
                await apiSocket.machineRPC<WorkspaceUploadAbortResponse, WorkspaceUploadFinishRequest>(
                    machineId,
                    'uploadFileAbort',
                    { uploadId },
                ).catch(() => undefined);
                uploadId = undefined;
                return {
                    success: false,
                    code: chunk.code === 'too-large' ? 'too-large' : 'write-failed',
                    error: chunk.error ?? 'Failed to upload machine file chunk',
                };
            }
            offset = chunk.received;
        }

        const finished = await apiSocket.machineRPC<WorkspaceUploadResponse, WorkspaceUploadFinishRequest>(
            machineId,
            'uploadFileFinish',
            { uploadId },
        );
        uploadId = undefined;
        return finished;
    } catch (error) {
        if (uploadId) {
            await apiSocket.machineRPC<WorkspaceUploadAbortResponse, WorkspaceUploadFinishRequest>(
                machineId,
                'uploadFileAbort',
                { uploadId },
            ).catch(() => undefined);
        }
        return {
            success: false,
            code: 'write-failed',
            error: error instanceof Error ? error.message : 'Failed to upload machine file',
        };
    }
}

/** Create exactly one child folder in an existing machine directory. */
export async function machineCreateDirectory(
    machineId: string,
    request: import('@slopus/happy-wire').WorkspaceCreateDirectoryRequest,
): Promise<import('@slopus/happy-wire').WorkspaceCreateDirectoryResponse> {
    try {
        return await apiSocket.machineRPC<
            import('@slopus/happy-wire').WorkspaceCreateDirectoryResponse,
            import('@slopus/happy-wire').WorkspaceCreateDirectoryRequest
        >(machineId, 'createDirectory', request);
    } catch (error) {
        return {
            success: false,
            code: 'write-failed',
            error: error instanceof Error ? error.message : 'Failed to create machine folder',
        };
    }
}

/** List one machine directory without tying the request to an agent session. */
export async function machineListDirectory(
    machineId: string,
    path: string,
): Promise<SessionListDirectoryResponse> {
    try {
        return await apiSocket.machineRPC<SessionListDirectoryResponse, SessionListDirectoryRequest>(
            machineId,
            'listDirectory',
            { path },
        );
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to list machine directory',
        };
    }
}

/**
 * Execute a bash command on a specific machine
 */
export async function machineBash(
    machineId: string,
    command: string,
    cwd: string
): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}> {
    try {
        const result = await apiSocket.machineRPC<{
            success: boolean;
            stdout: string;
            stderr: string;
            exitCode: number;
        }, {
            command: string;
            cwd: string;
        }>(
            machineId,
            'bash',
            { command, cwd }
        );
        return result;
    } catch (error) {
        return {
            success: false,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'Unknown error',
            exitCode: -1
        };
    }
}

/**
 * Update machine metadata with optimistic concurrency control and automatic retry
 */
export async function machineUpdateMetadata(
    machineId: string,
    metadata: MachineMetadata,
    expectedVersion: number,
    maxRetries: number = 3
): Promise<{ version: number; metadata: string }> {
    let currentVersion = expectedVersion;
    let currentMetadata = { ...metadata };
    let retryCount = 0;

    const machineEncryption = sync.encryption.getMachineEncryption(machineId);
    if (!machineEncryption) {
        throw new Error(`Machine encryption not found for ${machineId}`);
    }

    while (retryCount < maxRetries) {
        const encryptedMetadata = await machineEncryption.encryptRaw(currentMetadata);

        const result = await apiSocket.emitWithAck<{
            result: 'success' | 'version-mismatch' | 'error';
            version?: number;
            metadata?: string;
            message?: string;
        }>('machine-update-metadata', {
            machineId,
            metadata: encryptedMetadata,
            expectedVersion: currentVersion
        });

        if (result.result === 'success') {
            return {
                version: result.version!,
                metadata: result.metadata!
            };
        } else if (result.result === 'version-mismatch') {
            // Get the latest version and metadata from the response
            currentVersion = result.version!;
            const latestMetadata = await machineEncryption.decryptRaw(result.metadata!) as MachineMetadata;

            // Merge our changes with the latest metadata
            // Preserve the displayName we're trying to set, but use latest values for other fields
            currentMetadata = {
                ...latestMetadata,
                displayName: metadata.displayName // Keep our intended displayName change
            };

            retryCount++;

            // If we've exhausted retries, throw error
            if (retryCount >= maxRetries) {
                throw new Error(`Failed to update after ${maxRetries} retries due to version conflicts`);
            }

            // Otherwise, loop will retry with updated version and merged metadata
        } else {
            throw new Error(result.message || 'Failed to update machine metadata');
        }
    }

    throw new Error('Unexpected error in machineUpdateMetadata');
}

type SessionMetadataMerger = (
    latest: Record<string, unknown>,
    afterVersionConflict: boolean,
) => Record<string, unknown> | null;

const SESSION_ARCHIVE_METADATA_ACK_TIMEOUT_MS = 10_000;
const SESSION_ARCHIVE_READBACK_TIMEOUT_MS = 10_000;

async function withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    timeoutError: () => Error,
): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => reject(timeoutError()), timeoutMs);
        operation.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeout);
                reject(error);
            },
        );
    });
}

/** Schema-free encrypted metadata read-modify-write with conflict retry. */
async function sessionUpdateMetadata(
    sessionId: string,
    merge: SessionMetadataMerger,
    maxRetries: number = 3,
    ackTimeoutMs?: number,
): Promise<void> {
    const encryption = sync.encryption.getSessionEncryption(sessionId);
    const session = storage.getState().sessions[sessionId];
    if (!encryption || !session?.metadata) {
        throw new Error(`Session ${sessionId} is not ready for metadata updates`);
    }

    let currentVersion = session.metadataVersion;
    let latestMetadata: Record<string, unknown> = { ...session.metadata };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const currentMetadata = merge(latestMetadata, attempt > 0);
        if (!currentMetadata) {
            return;
        }
        const encrypted = await encryption.encryptRaw(currentMetadata);
        const result = await apiSocket.emitWithAck<{
            result: 'success' | 'version-mismatch' | 'error';
            version?: number;
            metadata?: string;
        }>('update-metadata', {
            sid: sessionId,
            metadata: encrypted,
            expectedVersion: currentVersion
        }, ackTimeoutMs);

        if (result.result === 'success') {
            return;
        }
        if (result.result === 'version-mismatch' && result.version !== undefined && result.metadata) {
            const latest = await encryption.decryptRaw(result.metadata);
            if (!latest || typeof latest !== 'object' || Array.isArray(latest)) {
                throw new Error('Failed to decrypt latest session metadata');
            }
            currentVersion = result.version;
            latestMetadata = latest as Record<string, unknown>;
            continue;
        }
        throw new Error('Failed to update session metadata');
    }

    throw new Error(`Failed to update session metadata after ${maxRetries} retries due to version conflicts`);
}

/**
 * Persist per-session mode picks into synced session metadata with optimistic
 * concurrency and automatic retry. On version conflict the latest metadata is
 * taken from the server via the schema-free raw decrypt, so fields this app
 * version doesn't know about survive the read-modify-write.
 */
async function sessionUpdateAgentModesMetadata(
    sessionId: string,
    patch: SessionAgentModesPatch,
    maxRetries: number = 3
): Promise<void> {
    // Defensive copy: retries drop fields from the patch (see below).
    const pendingPatch: SessionAgentModesPatch = { ...patch };
    await sessionUpdateMetadata(sessionId, (latest, afterVersionConflict) => {
        if (afterVersionConflict) {
            // A newer local action (another pick, an abort clearing modes) may
            // have changed the mirror since this push started — that action
            // owns the field now, and blindly replaying the original patch
            // would resurrect a pick the user already cleared.
            const liveSession = storage.getState().sessions[sessionId];
            for (const field of Object.keys(pendingPatch) as (keyof SessionAgentModesPatch)[]) {
                if ((liveSession?.[field] ?? null) !== (pendingPatch[field] ?? null)) {
                    delete pendingPatch[field];
                }
            }
        }
        return Object.keys(pendingPatch).length > 0
            ? { ...latest, ...pendingPatch }
            : null;
    }, maxRetries);
}

/**
 * Apply a per-session model / effort pick: updates local state immediately for
 * a snappy UI and pushes the pick into synced session metadata so other
 * devices receive it through the update-session broadcast. Never throws — a
 * failed push leaves the optimistic local value, and the next inbound
 * metadata update reconciles the UI.
 */
export function sessionSetAgentModes(sessionId: string, patch: SessionAgentModesPatch): void {
    const state = storage.getState();
    const session = state.sessions[sessionId];

    // Only touch fields that actually change — clearing modes on a session
    // with no picks (e.g. every abort) must not cost a metadata round-trip.
    // A pick counts as changed when it differs from the local mirror OR from
    // synced metadata: a local-only value (e.g. the EnterPlanMode auto-switch
    // writes the mirror without metadata) must still be pushed when the user
    // picks it explicitly, or other devices never see it.
    const isChanged = (value: string | null, field: keyof SessionAgentModesPatch): boolean => {
        const mirror = session?.[field] ?? null;
        const metaRaw = session?.metadata?.[field];
        const meta = metaRaw === undefined ? null : (metaRaw ?? null);
        return value !== mirror || value !== meta;
    };
    const changed: SessionAgentModesPatch = {};
    if (patch.permissionMode !== undefined && isChanged(patch.permissionMode, 'permissionMode')) {
        changed.permissionMode = patch.permissionMode;
    }
    if (patch.modelMode !== undefined && isChanged(patch.modelMode, 'modelMode')) {
        changed.modelMode = patch.modelMode;
    }
    if (patch.effortLevel !== undefined && isChanged(patch.effortLevel, 'effortLevel')) {
        changed.effortLevel = patch.effortLevel;
    }
    if (Object.keys(changed).length === 0) {
        return;
    }

    state.updateSessionAgentModes(sessionId, changed);

    // While the push is in flight, inbound updates still carry the OLD
    // metadata; mark the fields pending so applySessions keeps the fresher
    // local mirror instead of bouncing the pick back.
    const changedFields = Object.keys(changed) as AgentModeField[];
    markAgentModePushPending(sessionId, changedFields);
    sessionUpdateAgentModesMetadata(sessionId, changed)
        .catch((error) => {
            console.error(`Failed to sync agent modes for session ${sessionId}`, error);
        })
        .finally(() => {
            clearAgentModePushPending(sessionId, changedFields);
        });
}

/**
 * Abort the current session operation
 */
export async function sessionAbort(sessionId: string): Promise<void> {
    const metadata = storage.getState().sessions[sessionId]?.metadata;
    if (!rigCanAbort(metadata)) {
        throw new Error('Abort is not available for this session');
    }
    await apiSocket.sessionRPC(sessionId, 'abort', isRigMetadata(metadata) ? {} : {
        reason: `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`
    });
}

/**
 * Allow a permission request
 */
export async function sessionAllow(sessionId: string, id: string, mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan', allowedTools?: string[], decision?: 'approved' | 'approved_for_session', updatedInput?: Record<string, unknown>): Promise<void> {
    const request: SessionPermissionRequest = { id, approved: true, mode, allowTools: allowedTools, decision, updatedInput };
    await apiSocket.sessionRPC(sessionId, 'permission', request);
}

/**
 * Answer a question the agent asked. The reply carries back the same `kind` the
 * agent published, so the agent can route it without guessing.
 */
export async function sessionAnswerQuestion(
    sessionId: string,
    id: string,
    answers: Record<string, AgentQuestionAnswer>,
    kind: string = 'form',
): Promise<void> {
    const reply: SessionCommunicationReply = { id, kind, status: 'answered', answers };
    await apiSocket.sessionRPC(sessionId, 'communication', reply);
}

/**
 * Dismiss a communication without answering it.
 */
export async function sessionCancelCommunication(
    sessionId: string,
    id: string,
    kind: string = 'form',
): Promise<void> {
    const reply: SessionCommunicationReply = { id, kind, status: 'cancelled' };
    await apiSocket.sessionRPC(sessionId, 'communication', reply);
}

/**
 * Deny a permission request
 */
export async function sessionDeny(sessionId: string, id: string, mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan', allowedTools?: string[], decision?: 'denied' | 'abort'): Promise<void> {
    const request: SessionPermissionRequest = { id, approved: false, mode, allowTools: allowedTools, decision };
    await apiSocket.sessionRPC(sessionId, 'permission', request);
}

/**
 * Request mode change for a session
 */
export async function sessionSwitch(sessionId: string, to: 'remote' | 'local'): Promise<boolean> {
    const request: SessionModeChangeRequest = { to };
    const response = await apiSocket.sessionRPC<boolean, SessionModeChangeRequest>(
        sessionId,
        'switch',
        request,
    );
    return response;
}

/**
 * Request an agent-owned goal action.
 */
export async function sessionGoalAction(
    sessionId: string,
    action: SessionGoalActionRequest['action'],
    objective?: string,
): Promise<void> {
    await apiSocket.sessionRPC(sessionId, 'goal-action', {
        action,
        ...(objective !== undefined ? { objective } : {}),
    } satisfies SessionGoalActionRequest);
}

/**
 * Execute a bash command in the session
 */
export async function sessionBash(sessionId: string, request: SessionBashRequest): Promise<SessionBashResponse> {
    try {
        const metadata = storage.getState().sessions[sessionId]?.metadata;
        if (!rigCanUseShell(metadata)) {
            throw new Error('Shell access is not available for this session');
        }
        const response = await apiSocket.sessionRPC<SessionBashResponse, SessionBashRequest>(
            sessionId,
            'bash',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            stdout: '',
            stderr: error instanceof Error ? error.message : 'Unknown error',
            exitCode: -1,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Read a file from the session
 */
export async function sessionReadFile(sessionId: string, path: string): Promise<SessionReadFileResponse> {
    try {
        const metadata = storage.getState().sessions[sessionId]?.metadata;
        if (!rigCanReadFiles(metadata)) {
            throw new Error('File reading is not available for this session');
        }
        const request: SessionReadFileRequest = { path };
        const response = await apiSocket.sessionRPC<SessionReadFileResponse, SessionReadFileRequest>(
            sessionId,
            'readFile',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Write a file to the session
 */
export async function sessionWriteFile(
    sessionId: string,
    path: string,
    content: string,
    expectedHash?: string | null
): Promise<SessionWriteFileResponse> {
    try {
        const metadata = storage.getState().sessions[sessionId]?.metadata;
        if (!rigCanWriteFiles(metadata)) {
            throw new Error('File writing is not available for this session');
        }
        const request: SessionWriteFileRequest = { path, content, expectedHash };
        const response = await apiSocket.sessionRPC<SessionWriteFileResponse, SessionWriteFileRequest>(
            sessionId,
            'writeFile',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Delete a file from the session workspace.
 */
export async function sessionDeleteFile(sessionId: string, path: string): Promise<SessionDeleteFileResponse> {
    try {
        const state = storage.getState();
        const metadata = state.sessions[sessionId]?.metadata;
        if (isRigMetadata(metadata)) {
            if (!sessionCanDeleteFiles(metadata)) {
                throw new Error('File deletion is not advertised by this Rig session');
            }
            return await apiSocket.sessionRPC<SessionDeleteFileResponse, SessionDeleteFileRequest>(
                sessionId,
                'deleteFile',
                { path },
            );
        }

        const machineId = metadata?.machineId;
        const machineMetadata = machineId ? state.machines[machineId]?.metadata : null;
        if (!machineId || !sessionCanDeleteFiles(metadata, machineMetadata)) {
            throw new Error('File deletion is not available for this session');
        }
        return await apiSocket.machineRPC<SessionDeleteFileResponse, SessionDeleteFileRequest>(
            machineId,
            'deleteFile',
            { path },
        );
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * List directory contents in the session
 */
export async function sessionListDirectory(sessionId: string, path: string): Promise<SessionListDirectoryResponse> {
    try {
        const metadata = storage.getState().sessions[sessionId]?.metadata;
        if (isRigMetadata(metadata) && !rigHasRpcMethod(metadata, 'listDirectory')) {
            throw new Error('Directory listing is not advertised by this Rig session');
        }
        const request: SessionListDirectoryRequest = { path };
        const response = await apiSocket.sessionRPC<SessionListDirectoryResponse, SessionListDirectoryRequest>(
            sessionId,
            'listDirectory',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Get directory tree from the session
 */
export async function sessionGetDirectoryTree(
    sessionId: string,
    path: string,
    maxDepth: number
): Promise<SessionGetDirectoryTreeResponse> {
    try {
        const metadata = storage.getState().sessions[sessionId]?.metadata;
        if (isRigMetadata(metadata) && !rigHasRpcMethod(metadata, 'getDirectoryTree')) {
            throw new Error('Directory tree is not advertised by this Rig session');
        }
        const request: SessionGetDirectoryTreeRequest = { path, maxDepth };
        const response = await apiSocket.sessionRPC<SessionGetDirectoryTreeResponse, SessionGetDirectoryTreeRequest>(
            sessionId,
            'getDirectoryTree',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Run ripgrep in the session
 */
export async function sessionRipgrep(
    sessionId: string,
    args: string[],
    cwd?: string
): Promise<SessionRipgrepResponse> {
    try {
        const metadata = storage.getState().sessions[sessionId]?.metadata;
        if (!rigCanSearchFiles(metadata)) {
            throw new Error('File search is not available for this session');
        }
        const request: SessionRipgrepRequest = { args, cwd };
        const response = await apiSocket.sessionRPC<SessionRipgrepResponse, SessionRipgrepRequest>(
            sessionId,
            'ripgrep',
            request
        );
        return response;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Kill the session process immediately
 */
export async function sessionKill(sessionId: string): Promise<SessionKillResponse> {
    try {
        const response = await apiSocket.sessionRPC<SessionKillResponse, {}>(
            sessionId,
            'killSession',
            {}
        );
        return response;
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

async function sessionPersistArchivedLifecycle(
    sessionId: string,
    archivedAt: number,
    maxRetries: number = 3,
): Promise<void> {
    const archivePatch = {
        lifecycleState: 'archived',
        lifecycleStateSince: archivedAt,
        archivedBy: 'app',
        archiveReason: 'User archived',
    } as const;
    await sessionUpdateMetadata(
        sessionId,
        (latest) => ({ ...latest, ...archivePatch }),
        maxRetries,
        SESSION_ARCHIVE_METADATA_ACK_TIMEOUT_MS,
    );
}

/**
 * Archive a session recoverably: deactivate it, then persist the durable
 * encrypted lifecycle marker.
 *
 * `active=false` alone means stopped/disconnected and remains resumable. The
 * encrypted lifecycle marker is the canonical explicit archive signal used by
 * session selectors; the server POST separately guarantees inactivity when
 * the provider process is already unreachable.
 */
export async function sessionArchive(sessionId: string): Promise<{ success: boolean; message?: string }> {
    try {
        const response = await apiSocket.request(`/v1/sessions/${sessionId}/archive`, {
            method: 'POST'
        });
        if (!response.ok) {
            return { success: false, message: `Server error: ${response.status}` };
        }
    } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Deactivate first: if either operation fails, the child remains without
    // an archived marker and therefore visible/retryable under its parent.
    try {
        await sessionPersistArchivedLifecycle(sessionId, Date.now());
        return { success: true };
    } catch (error) {
        // The server can commit the encrypted update and then lose its ack or
        // fail while publishing the follow-up event. Refetch after every
        // negative persistence receipt before claiming the tab is retryable.
        try {
            await withTimeout(
                sync.refreshSessions(),
                SESSION_ARCHIVE_READBACK_TIMEOUT_MS,
                () => new Error('Session archive read-back timed out'),
            );
        } catch {
            // Fall through to the local read. A concurrent broadcast may
            // still have reconciled the metadata while refresh failed.
        }
        if (storage.getState().sessions[sessionId]?.metadata?.lifecycleState === 'archived') {
            return { success: true };
        }
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Failed to archive session metadata',
        };
    }
}

/**
 * Permanently delete a session from the server
 * This will remove the session and all its associated data (messages, usage reports, access keys)
 * The session should be inactive/archived before deletion
 */
export async function sessionDelete(sessionId: string): Promise<{ success: boolean; message?: string }> {
    try {
        const response = await apiSocket.request(`/v1/sessions/${sessionId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            const result = await response.json();
            return { success: true };
        } else {
            const error = await response.text();
            return {
                success: false,
                message: error || 'Failed to delete session'
            };
        }
    } catch (error) {
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

type ClaudeForkSource = {
    kind?: 'claude';
    sessionId: string;
    machineId: string;
    directory: string;
    claudeSessionId: string;
};

type CodexForkSource = {
    kind: 'codex';
    sessionId: string;
    machineId: string;
    directory: string;
    codexThreadId: string;
};

// Forking source description used by forkAndSpawn.
export type ForkSource = ClaudeForkSource | CodexForkSource;

type ForkOptions = {
    cutAfterUuid?: string;
    cutAfterItemId?: string;
    forkedFromMessageId?: string;
};

/**
 * Two-step orchestrator for the session fork / duplicate flow:
 *   1. Ask the daemon to copy (and optionally truncate) the source Claude
 *      JSONL — returns a fresh Claude session UUID.
 *   2. Spawn a new Happy session on the same machine with
 *      `resumeClaudeSessionId` set to that UUID so `claude --resume` picks
 *      up the copied conversation.
 *
 * Lineage (parentSessionId, forkedFromMessageId) rides through the spawn
 * RPC into env vars, then into the new Happy session's metadata at start
 * — so the parent link survives without any server-side schema change.
 */
export async function forkAndSpawn(
    source: ForkSource,
    opts: ForkOptions = {},
): Promise<SpawnSessionResult> {
    if (source.kind === 'codex') {
        const forkResult = opts.cutAfterItemId
            ? await codexDuplicateThread({
                machineId: source.machineId,
                directory: source.directory,
                codexThreadId: source.codexThreadId,
                cutAfterItemId: opts.cutAfterItemId,
            })
            : await codexForkThread({
                machineId: source.machineId,
                directory: source.directory,
                codexThreadId: source.codexThreadId,
            });

        if (forkResult.type !== 'success') {
            return { type: 'error', errorMessage: forkResult.errorMessage };
        }

        const spawnResult = await machineSpawnNewSession({
            machineId: source.machineId,
            directory: source.directory,
            agent: 'codex',
            approvedNewDirectoryCreation: false,
            resumeCodexThreadId: forkResult.newCodexThreadId,
            parentSessionId: source.sessionId,
            forkedFromMessageId: opts.forkedFromMessageId,
        });

        if (spawnResult.type === 'success') {
            try {
                await sync.refreshSessions();
            } catch {
                // Refresh is best-effort; broadcast sync will still hydrate.
            }
        }

        return spawnResult;
    }

    const forkResult = opts.cutAfterUuid
        ? await claudeDuplicateSession({
            machineId: source.machineId,
            directory: source.directory,
            claudeSessionId: source.claudeSessionId,
            cutAfterUuid: opts.cutAfterUuid,
        })
        : await claudeForkSession({
            machineId: source.machineId,
            directory: source.directory,
            claudeSessionId: source.claudeSessionId,
        });

    if (forkResult.type !== 'success') {
        return { type: 'error', errorMessage: forkResult.errorMessage };
    }

    const spawnResult = await machineSpawnNewSession({
        machineId: source.machineId,
        directory: source.directory,
        agent: 'claude',
        approvedNewDirectoryCreation: false,
        resumeClaudeSessionId: forkResult.newClaudeSessionId,
        parentSessionId: source.sessionId,
        forkedFromMessageId: opts.forkedFromMessageId,
    });

    // Pull the newly-created session row into local sync state before we
    // hand control back to the caller — otherwise router.replace into the
    // new session id races the broadcast and the app screams
    // "Session X not found" until the next sync tick lands.
    if (spawnResult.type === 'success') {
        try {
            await sync.refreshSessions();
        } catch {
            // Refresh is best-effort; the broadcast will still hydrate the
            // session shortly even if this fetch flaked.
        }
    }

    return spawnResult;
}

// Export types for external use
export type {
    SessionBashRequest,
    SessionBashResponse,
    SessionReadFileResponse,
    SessionWriteFileResponse,
    SessionDeleteFileResponse,
    SessionListDirectoryResponse,
    DirectoryEntry,
    SessionGetDirectoryTreeResponse,
    TreeNode,
    SessionRipgrepResponse,
    SessionKillResponse
};
