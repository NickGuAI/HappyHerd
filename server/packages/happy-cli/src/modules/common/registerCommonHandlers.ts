import { logger } from '@/ui/logger';
import { exec, ExecOptions } from 'child_process';
import { promisify } from 'util';
import { link, lstat, mkdir, open, readFile, writeFile, readdir, stat, unlink, type FileHandle } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { basename, join, resolve } from 'path';
import {
    isSafeWorkspaceUploadFileName,
    isSafeWorkspacePathSegment,
    MAX_WORKSPACE_UPLOAD_BYTES,
    WorkspaceCreateDirectoryRequestSchema,
    WorkspaceUploadAbortRequestSchema,
    WorkspaceUploadChunkRequestSchema,
    WorkspaceUploadFinishRequestSchema,
    WorkspaceUploadStartRequestSchema,
    type WorkspaceCreateDirectoryRequest,
    type WorkspaceCreateDirectoryResponse,
    type WorkspaceUploadAbortRequest,
    type WorkspaceUploadAbortResponse,
    type WorkspaceUploadChunkRequest,
    type WorkspaceUploadChunkResponse,
    type WorkspaceUploadFinishRequest,
    type WorkspaceUploadStartRequest,
    type WorkspaceUploadStartResponse,
    type WorkspaceUploadResponse,
} from '@slopus/happy-wire';
import { run as runRipgrep } from '@/modules/ripgrep/index';
import { run as runDifftastic } from '@/modules/difftastic/index';
import { RpcHandlerManager } from '../../api/rpc/RpcHandlerManager';
import { validatePath, PathValidationResult } from './pathSecurity';

const execAsync = promisify(exec);
export const MAX_FILE_PREVIEW_BYTES = 20 * 1024 * 1024;

interface BashRequest {
    command: string;
    cwd?: string;
    timeout?: number; // timeout in milliseconds
}

interface BashResponse {
    success: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    error?: string;
}

interface ReadFileRequest {
    path: string;
}

interface ReadFileResponse {
    success: boolean;
    content?: string; // base64 encoded
    error?: string;
}

interface WriteFileRequest {
    path: string;
    content: string; // base64 encoded
    expectedHash?: string | null; // null for new files, hash for existing files
}

interface WriteFileResponse {
    success: boolean;
    hash?: string; // hash of written file
    error?: string;
}

interface ListDirectoryRequest {
    path: string;
}

interface DirectoryEntry {
    name: string;
    type: 'file' | 'directory' | 'other';
    size?: number;
    modified?: number; // timestamp
}

interface ListDirectoryResponse {
    success: boolean;
    entries?: DirectoryEntry[];
    error?: string;
}

interface GetDirectoryTreeRequest {
    path: string;
    maxDepth: number;
}

interface TreeNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: number;
    children?: TreeNode[]; // Only present for directories
}

interface GetDirectoryTreeResponse {
    success: boolean;
    tree?: TreeNode;
    error?: string;
}

interface RipgrepRequest {
    args: string[];
    cwd?: string;
}

interface RipgrepResponse {
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
}

interface DifftasticRequest {
    args: string[];
    cwd?: string;
}

interface DifftasticResponse {
    success: boolean;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
}

/*
 * Spawn Session Options and Result
 * This rpc type is used by the daemon, all other RPCs here are for sessions
*/

export interface SpawnSessionOptions {
    machineId?: string;
    directory: string;
    sessionId?: string;
    approvedNewDirectoryCreation?: boolean;
    agent?: 'claude' | 'codex' | 'gemini' | 'openclaw' | 'agy';
    permissionMode?: string;
    modelMode?: string;
    effortLevel?: string;
    /** Existing HappyHerd Commander identity to bind to this session. */
    commanderId?: string;
    /**
     * Machine-local automation snapshot. Only the daemon automation service
     * sets this field; the remote spawn RPC deliberately does not forward it.
     */
    automation?: {
        id: string;
        runId: string;
        kind: 'scheduled' | 'heartbeat' | 'memory-maintenance';
        instruction: string;
    };
    environmentVariables?: Record<string, string>;
    /** Strict, session-scoped governed-agent values supplied only over encrypted machine RPC. */
    agentRuntimeContext?: {
        surfaceId: string;
        capabilityId: string;
        brokerUrl: string;
        tools: Array<{
            name: string;
            family: string;
            description: string;
        }>;
    };
    token?: string;
    /**
     * If set, the daemon spawns the agent with `--resume <id>` so the new
     * Happy session continues from an existing Claude conversation file.
     * Used by the session fork / duplicate flow: the fork RPC produces a
     * new Claude JSONL on disk, the spawn RPC then attaches a fresh Happy
     * session to it.
     */
    resumeClaudeSessionId?: string;
    /**
     * If set, the daemon spawns Codex with `--resume <id>` so a fresh Happy
     * session attaches to a forked Codex app-server thread.
     */
    resumeCodexThreadId?: string;
    /** Happy session id this fork was branched from (lineage). */
    parentSessionId?: string;
    /** Happy message id used as the rewind point (only set for "duplicate"). */
    forkedFromMessageId?: string;
    /**
     * Marks the spawned session as a hidden "side chat" of `parentSessionId`.
     * Side chats are forked from a parent session but never surface in the
     * top-level session list — they are only rendered inside the parent's
     * sidebar panel. See the app-side `useSideChatSession` lookup.
     */
    isSideChat?: boolean;
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | {
        type: 'error';
        errorMessage: string;
        /**
         * True only when the daemon can prove no provider process was
         * started. Automation retries must remain off for ambiguous webhook
         * timeouts, otherwise one schedule tick could create two sessions.
         */
        retrySafe?: boolean;
    };

const MAX_PENDING_WORKSPACE_UPLOADS = 8;
const WORKSPACE_UPLOAD_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

type PendingWorkspaceUpload = {
    uploadId: string;
    temporaryPath: string;
    targetPath: string;
    expectedSize: number;
    received: number;
    hash: ReturnType<typeof createHash>;
    handle: FileHandle;
    closed: boolean;
    busy: boolean;
    timer?: ReturnType<typeof setTimeout>;
};

/**
 * Register all RPC handlers with the session
 *
 * workingDirectory scopes file/shell RPCs to a workspace. Session-scoped
 * handlers pass the session's path; machine-scoped (daemon) handlers pass
 * null — the daemon serves the whole machine and its process.cwd() is just
 * wherever it happened to be started from, not a meaningful boundary.
 */
export function registerCommonHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string | null) {

    const checkPath = (targetPath: string): PathValidationResult =>
        workingDirectory === null
            ? { valid: true, resolvedPath: resolve(targetPath) }
            : validatePath(targetPath, workingDirectory);

    const pendingWorkspaceUploads = new Map<string, PendingWorkspaceUpload>();

    const cleanupWorkspaceUpload = async (upload: PendingWorkspaceUpload): Promise<void> => {
        if (pendingWorkspaceUploads.get(upload.uploadId) === upload) {
            pendingWorkspaceUploads.delete(upload.uploadId);
        }
        if (upload.timer) clearTimeout(upload.timer);
        if (!upload.closed) {
            upload.closed = true;
            await upload.handle.close().catch(() => undefined);
        }
        await unlink(upload.temporaryPath).catch(() => undefined);
    };

    const refreshWorkspaceUploadTimeout = (upload: PendingWorkspaceUpload): void => {
        if (upload.timer) clearTimeout(upload.timer);
        upload.timer = setTimeout(() => {
            void cleanupWorkspaceUpload(upload);
        }, WORKSPACE_UPLOAD_IDLE_TIMEOUT_MS);
        upload.timer.unref?.();
    };

    // Shell command handler - executes commands in the default shell
    rpcHandlerManager.registerHandler<BashRequest, BashResponse>('bash', async (data) => {
        logger.debug('Shell command request:', data.command);

        // Validate cwd if provided
        // Special case: "/" means "use shell's default cwd" (used by CLI detection)
        // Security: Still validate all other paths to prevent directory traversal
        if (data.cwd && data.cwd !== '/') {
            const validation = checkPath(data.cwd);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            data.cwd = validation.resolvedPath;
        }

        try {
            // Build options with shell enabled by default
            // Note: ExecOptions doesn't support boolean for shell, but exec() uses the default shell when shell is undefined
            // If cwd is "/", use undefined to let shell use its default (respects user's PATH)
            const options: ExecOptions = {
                cwd: data.cwd === '/' ? undefined : data.cwd,
                timeout: data.timeout || 30000, // Default 30 seconds timeout
                windowsHide: true, // Prevent cmd.exe popup on Windows for every RPC bash call
            };

            logger.debug('Shell command executing...', { cwd: options.cwd, timeout: options.timeout });
            const { stdout, stderr } = await execAsync(data.command, options);
            logger.debug('Shell command executed, processing result...');

            const result = {
                success: true,
                stdout: stdout ? stdout.toString() : '',
                stderr: stderr ? stderr.toString() : '',
                exitCode: 0
            };
            logger.debug('Shell command result:', {
                success: true,
                exitCode: 0,
                stdoutLen: result.stdout.length,
                stderrLen: result.stderr.length
            });
            return result;
        } catch (error) {
            const execError = error as NodeJS.ErrnoException & {
                stdout?: string;
                stderr?: string;
                code?: number | string;
                killed?: boolean;
            };

            // Check if the error was due to timeout
            if (execError.code === 'ETIMEDOUT' || execError.killed) {
                const result = {
                    success: false,
                    stdout: execError.stdout || '',
                    stderr: execError.stderr || '',
                    exitCode: typeof execError.code === 'number' ? execError.code : -1,
                    error: 'Command timed out'
                };
                logger.debug('Shell command timed out:', {
                    success: false,
                    exitCode: result.exitCode,
                    error: 'Command timed out'
                });
                return result;
            }

            // If exec fails, it includes stdout/stderr in the error
            const result = {
                success: false,
                stdout: execError.stdout ? execError.stdout.toString() : '',
                stderr: execError.stderr ? execError.stderr.toString() : execError.message || 'Command failed',
                exitCode: typeof execError.code === 'number' ? execError.code : 1,
                error: execError.message || 'Command failed'
            };
            logger.debug('Shell command failed:', {
                success: false,
                exitCode: result.exitCode,
                error: result.error,
                stdoutLen: result.stdout.length,
                stderrLen: result.stderr.length
            });
            return result;
        }
    });

    // Read file handler - returns base64 encoded content
    rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>('readFile', async (data) => {
        logger.debug('Read file request:', data.path);

        // Validate path is within working directory
        const validation = checkPath(data.path);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        try {
            const fileInfo = await stat(validation.resolvedPath!);
            if (!fileInfo.isFile()) {
                return { success: false, error: 'Path is not a file' };
            }
            if (fileInfo.size > MAX_FILE_PREVIEW_BYTES) {
                return { success: false, error: 'File is too large to preview (limit 20 MiB)' };
            }
            const buffer = await readFile(validation.resolvedPath!);
            const content = buffer.toString('base64');
            return { success: true, content };
        } catch (error) {
            logger.debug('Failed to read file:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Failed to read file' };
        }
    });

    // Write file handler - with hash verification
    rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>('writeFile', async (data) => {
        logger.debug('Write file request:', data.path);

        // Validate path is within working directory
        const validation = checkPath(data.path);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        try {
            // If expectedHash is provided (not null), verify existing file
            if (data.expectedHash !== null && data.expectedHash !== undefined) {
                try {
                    const existingBuffer = await readFile(validation.resolvedPath!);
                    const existingHash = createHash('sha256').update(existingBuffer).digest('hex');

                    if (existingHash !== data.expectedHash) {
                        return {
                            success: false,
                            error: `File hash mismatch. Expected: ${data.expectedHash}, Actual: ${existingHash}`
                        };
                    }
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException;
                    if (nodeError.code !== 'ENOENT') {
                        throw error;
                    }
                    // File doesn't exist but hash was provided
                    return {
                        success: false,
                        error: 'File does not exist but hash was provided'
                    };
                }
            } else {
                // expectedHash is null - expecting new file
                try {
                    await stat(validation.resolvedPath!);
                    // File exists but we expected it to be new
                    return {
                        success: false,
                        error: 'File already exists but was expected to be new'
                    };
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException;
                    if (nodeError.code !== 'ENOENT') {
                        throw error;
                    }
                    // File doesn't exist - this is expected
                }
            }

            // Write the file
            const buffer = Buffer.from(data.content, 'base64');
            await writeFile(validation.resolvedPath!, buffer);

            // Calculate and return hash of written file
            const hash = createHash('sha256').update(buffer).digest('hex');

            return { success: true, hash };
        } catch (error) {
            logger.debug('Failed to write file:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Failed to write file' };
        }
    });

    rpcHandlerManager.registerHandler<WorkspaceUploadStartRequest, WorkspaceUploadStartResponse>(
        'uploadFileStart',
        async (rawData) => {
            const parsed = WorkspaceUploadStartRequestSchema.safeParse(rawData);
            if (!parsed.success) {
                const requestedSize = (rawData as { size?: unknown } | null)?.size;
                if (typeof requestedSize === 'number' && requestedSize > MAX_WORKSPACE_UPLOAD_BYTES) {
                    return { success: false, code: 'too-large', error: 'File is too large to upload (limit 20 MiB)' };
                }
                return { success: false, code: 'invalid-name', error: 'Invalid upload request' };
            }
            const data = parsed.data;
            if (!isSafeWorkspaceUploadFileName(data.fileName) || basename(data.fileName) !== data.fileName) {
                return { success: false, code: 'invalid-name', error: 'File name must not contain a path' };
            }
            if (pendingWorkspaceUploads.size >= MAX_PENDING_WORKSPACE_UPLOADS) {
                return { success: false, code: 'write-failed', error: 'Too many uploads are already in progress' };
            }

            const directoryValidation = checkPath(data.directory);
            if (!directoryValidation.valid) {
                return { success: false, code: 'write-failed', error: directoryValidation.error };
            }
            const directoryPath = directoryValidation.resolvedPath!;
            const targetValidation = checkPath(join(directoryPath, data.fileName));
            if (!targetValidation.valid) {
                return { success: false, code: 'write-failed', error: targetValidation.error };
            }

            let temporaryPath: string | undefined;
            let handle: FileHandle | undefined;
            try {
                const directoryInfo = await stat(directoryPath);
                if (!directoryInfo.isDirectory()) {
                    return { success: false, code: 'not-directory', error: 'Upload destination is not a directory' };
                }
                try {
                    await lstat(targetValidation.resolvedPath!);
                    return { success: false, code: 'conflict', error: 'A file with this name already exists' };
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }

                const uploadId = randomUUID();
                temporaryPath = join(directoryPath, `.happyherd-upload-${uploadId}.tmp`);
                handle = await open(temporaryPath, 'wx', 0o600);
                const upload: PendingWorkspaceUpload = {
                    uploadId,
                    temporaryPath,
                    targetPath: targetValidation.resolvedPath!,
                    expectedSize: data.size,
                    received: 0,
                    hash: createHash('sha256'),
                    handle,
                    closed: false,
                    busy: false,
                };
                pendingWorkspaceUploads.set(uploadId, upload);
                refreshWorkspaceUploadTimeout(upload);
                return { success: true, uploadId };
            } catch (error) {
                await handle?.close().catch(() => undefined);
                if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
                const nodeError = error as NodeJS.ErrnoException;
                if (nodeError.code === 'EEXIST') {
                    return { success: false, code: 'conflict', error: 'A file with this name already exists' };
                }
                logger.debug('Failed to start file upload:', error);
                return {
                    success: false,
                    code: 'write-failed',
                    error: error instanceof Error ? error.message : 'Failed to start file upload',
                };
            }
        },
    );

    rpcHandlerManager.registerHandler<WorkspaceUploadChunkRequest, WorkspaceUploadChunkResponse>(
        'uploadFileChunk',
        async (rawData) => {
            const parsed = WorkspaceUploadChunkRequestSchema.safeParse(rawData);
            if (!parsed.success) {
                return { success: false, code: 'invalid-content', error: 'Invalid upload chunk' };
            }
            const data = parsed.data;
            const upload = pendingWorkspaceUploads.get(data.uploadId);
            if (!upload || upload.busy || data.offset !== upload.received) {
                return { success: false, code: 'invalid-upload', error: 'Upload is missing or out of sequence' };
            }

            let buffer: Buffer;
            try {
                buffer = Buffer.from(data.content, 'base64');
            } catch {
                return { success: false, code: 'invalid-content', error: 'File content is not valid base64' };
            }
            if (buffer.toString('base64') !== data.content) {
                return { success: false, code: 'invalid-content', error: 'File content is not valid base64' };
            }
            if (upload.received + buffer.byteLength > upload.expectedSize
                || upload.received + buffer.byteLength > MAX_WORKSPACE_UPLOAD_BYTES) {
                await cleanupWorkspaceUpload(upload);
                return { success: false, code: 'too-large', error: 'Upload exceeds its declared size' };
            }

            upload.busy = true;
            if (upload.timer) clearTimeout(upload.timer);
            try {
                let written = 0;
                while (written < buffer.byteLength) {
                    const result = await upload.handle.write(
                        buffer,
                        written,
                        buffer.byteLength - written,
                        upload.received + written,
                    );
                    if (result.bytesWritten === 0) throw new Error('File upload write made no progress');
                    written += result.bytesWritten;
                }
                upload.hash.update(buffer);
                upload.received += buffer.byteLength;
                upload.busy = false;
                refreshWorkspaceUploadTimeout(upload);
                return { success: true, received: upload.received };
            } catch (error) {
                await cleanupWorkspaceUpload(upload);
                logger.debug('Failed to write file upload chunk:', error);
                return {
                    success: false,
                    code: 'write-failed',
                    error: error instanceof Error ? error.message : 'Failed to write file upload chunk',
                };
            }
        },
    );

    rpcHandlerManager.registerHandler<WorkspaceUploadFinishRequest, WorkspaceUploadResponse>(
        'uploadFileFinish',
        async (rawData) => {
            const parsed = WorkspaceUploadFinishRequestSchema.safeParse(rawData);
            const upload = parsed.success ? pendingWorkspaceUploads.get(parsed.data.uploadId) : undefined;
            if (!upload || upload.busy) {
                return { success: false, code: 'write-failed', error: 'Upload is missing or still in progress' };
            }
            upload.busy = true;
            if (upload.timer) clearTimeout(upload.timer);
            pendingWorkspaceUploads.delete(upload.uploadId);

            if (upload.received !== upload.expectedSize) {
                await cleanupWorkspaceUpload(upload);
                return { success: false, code: 'write-failed', error: 'Upload is incomplete' };
            }

            try {
                await upload.handle.sync();
                await upload.handle.close();
                upload.closed = true;
                // A same-directory hard link publishes the fully written inode
                // without replacing an existing destination.
                await link(upload.temporaryPath, upload.targetPath);
                return {
                    success: true,
                    path: upload.targetPath,
                    size: upload.received,
                    hash: upload.hash.digest('hex'),
                };
            } catch (error) {
                const nodeError = error as NodeJS.ErrnoException;
                if (nodeError.code === 'EEXIST') {
                    return { success: false, code: 'conflict', error: 'A file with this name already exists' };
                }
                logger.debug('Failed to finish file upload:', error);
                return {
                    success: false,
                    code: 'write-failed',
                    error: error instanceof Error ? error.message : 'Failed to finish file upload',
                };
            } finally {
                await cleanupWorkspaceUpload(upload);
            }
        },
    );

    rpcHandlerManager.registerHandler<WorkspaceUploadAbortRequest, WorkspaceUploadAbortResponse>(
        'uploadFileAbort',
        async (rawData) => {
            const parsed = WorkspaceUploadAbortRequestSchema.safeParse(rawData);
            const upload = parsed.success ? pendingWorkspaceUploads.get(parsed.data.uploadId) : undefined;
            if (upload) await cleanupWorkspaceUpload(upload);
            return { success: true };
        },
    );

    rpcHandlerManager.registerHandler<WorkspaceCreateDirectoryRequest, WorkspaceCreateDirectoryResponse>(
        'createDirectory',
        async (rawData) => {
            const parsed = WorkspaceCreateDirectoryRequestSchema.safeParse(rawData);
            if (!parsed.success) {
                return { success: false, code: 'invalid-name', error: 'Invalid create-directory request' };
            }
            const data = parsed.data;
            if (!isSafeWorkspacePathSegment(data.directoryName) || basename(data.directoryName) !== data.directoryName) {
                return { success: false, code: 'invalid-name', error: 'Folder name must be one path segment' };
            }

            const parentValidation = checkPath(data.directory);
            if (!parentValidation.valid) {
                return { success: false, code: 'write-failed', error: parentValidation.error };
            }
            const parentPath = parentValidation.resolvedPath!;
            const targetValidation = checkPath(join(parentPath, data.directoryName));
            if (!targetValidation.valid) {
                return { success: false, code: 'write-failed', error: targetValidation.error };
            }

            try {
                const parentInfo = await stat(parentPath);
                if (!parentInfo.isDirectory()) {
                    return { success: false, code: 'not-directory', error: 'Folder parent is not a directory' };
                }
                await mkdir(targetValidation.resolvedPath!, { recursive: false, mode: 0o700 });
                return { success: true, path: targetValidation.resolvedPath! };
            } catch (error) {
                const nodeError = error as NodeJS.ErrnoException;
                if (nodeError.code === 'EEXIST') {
                    return { success: false, code: 'conflict', error: 'A file or folder with this name already exists' };
                }
                if (nodeError.code === 'ENOENT') {
                    return { success: false, code: 'not-found', error: 'Folder parent does not exist' };
                }
                if (nodeError.code === 'ENOTDIR') {
                    return { success: false, code: 'not-directory', error: 'Folder parent is not a directory' };
                }
                if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
                    return { success: false, code: 'permission-denied', error: 'Permission denied while creating folder' };
                }
                logger.debug('Failed to create directory:', error);
                return {
                    success: false,
                    code: 'write-failed',
                    error: error instanceof Error ? error.message : 'Failed to create folder',
                };
            }
        },
    );

    // List directory handler
    rpcHandlerManager.registerHandler<ListDirectoryRequest, ListDirectoryResponse>('listDirectory', async (data) => {
        logger.debug('List directory request:', data.path);

        // Validate path is within working directory
        const validation = checkPath(data.path);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        try {
            const directoryPath = validation.resolvedPath!;
            const entries = await readdir(directoryPath, { withFileTypes: true });

            const directoryEntries: DirectoryEntry[] = await Promise.all(
                entries.map(async (entry) => {
                    const fullPath = join(directoryPath, entry.name);
                    let type: 'file' | 'directory' | 'other' = 'other';
                    let size: number | undefined;
                    let modified: number | undefined;

                    if (entry.isDirectory()) {
                        type = 'directory';
                    } else if (entry.isFile()) {
                        type = 'file';
                    }

                    try {
                        const stats = await stat(fullPath);
                        size = stats.size;
                        modified = stats.mtime.getTime();
                    } catch (error) {
                        // Ignore stat errors for individual files
                        logger.debug(`Failed to stat ${fullPath}:`, error);
                    }

                    return {
                        name: entry.name,
                        type,
                        size,
                        modified
                    };
                })
            );

            // Sort entries: directories first, then files, alphabetically
            directoryEntries.sort((a, b) => {
                if (a.type === 'directory' && b.type !== 'directory') return -1;
                if (a.type !== 'directory' && b.type === 'directory') return 1;
                return a.name.localeCompare(b.name);
            });

            return { success: true, entries: directoryEntries };
        } catch (error) {
            logger.debug('Failed to list directory:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Failed to list directory' };
        }
    });

    // Get directory tree handler - recursive with depth control
    rpcHandlerManager.registerHandler<GetDirectoryTreeRequest, GetDirectoryTreeResponse>('getDirectoryTree', async (data) => {
        logger.debug('Get directory tree request:', data.path, 'maxDepth:', data.maxDepth);

        // Validate path is within working directory
        const validation = checkPath(data.path);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Helper function to build tree recursively
        async function buildTree(
            path: string,
            name: string,
            currentDepth: number,
            ignoreError: boolean,
        ): Promise<TreeNode | null> {
            try {
                const stats = await stat(path);

                // Base node information
                const node: TreeNode = {
                    name,
                    path,
                    type: stats.isDirectory() ? 'directory' : 'file',
                    size: stats.size,
                    modified: stats.mtime.getTime()
                };

                // If it's a directory and we haven't reached max depth, get children
                if (stats.isDirectory() && currentDepth < data.maxDepth) {
                    const entries = await readdir(path, { withFileTypes: true });
                    const children: TreeNode[] = [];

                    // Session RPCs remain workspace-scoped and skip symlinks so
                    // a link cannot escape that workspace. Machine RPCs are
                    // deliberately unrestricted: follow links at the requested
                    // depth so every path visible to the daemon OS user remains
                    // browseable. maxDepth bounds link cycles.
                    await Promise.all(
                        entries.map(async (entry) => {
                            if (entry.isSymbolicLink() && workingDirectory !== null) {
                                logger.debug(`Skipping symlink: ${join(path, entry.name)}`);
                                return;
                            }

                            const childPath = join(path, entry.name);
                            const childNode = await buildTree(childPath, entry.name, currentDepth + 1, true);
                            if (childNode) {
                                children.push(childNode);
                            }
                        })
                    );

                    // Sort children: directories first, then files, alphabetically
                    children.sort((a, b) => {
                        if (a.type === 'directory' && b.type !== 'directory') return -1;
                        if (a.type !== 'directory' && b.type === 'directory') return 1;
                        return a.name.localeCompare(b.name);
                    });

                    node.children = children;
                }

                return node;
            } catch (error) {
                // Child failures stay non-fatal so one unreadable entry does not
                // hide an otherwise browseable directory. The requested root is
                // different: preserve its native errno so the client can render
                // permission-denied and missing-path states accurately.
                logger.debug(`Failed to process ${path}:`, error instanceof Error ? error.message : String(error));
                if (!ignoreError) {
                    throw error;
                }
                return null;
            }
        }

        try {
            // Validate maxDepth
            if (data.maxDepth < 0) {
                return { success: false, error: 'maxDepth must be non-negative' };
            }

            // Get the base name for the root node
            const rootPath = validation.resolvedPath!;
            const baseName = rootPath === '/' ? '/' : rootPath.split('/').pop() || rootPath;
            const tree = await buildTree(rootPath, baseName, 0, false);

            if (!tree) {
                return { success: false, error: 'Failed to access the specified path' };
            }

            return { success: true, tree };
        } catch (error) {
            logger.debug('Failed to get directory tree:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Failed to get directory tree' };
        }
    });

    // Ripgrep handler - raw interface to ripgrep
    rpcHandlerManager.registerHandler<RipgrepRequest, RipgrepResponse>('ripgrep', async (data) => {
        logger.debug('Ripgrep request with args:', data.args, 'cwd:', data.cwd);

        // Validate cwd if provided
        if (data.cwd) {
            const validation = checkPath(data.cwd);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            data.cwd = validation.resolvedPath;
        }

        try {
            const result = await runRipgrep(data.args, { cwd: data.cwd });
            return {
                success: true,
                exitCode: result.exitCode,
                stdout: result.stdout.toString(),
                stderr: result.stderr.toString()
            };
        } catch (error) {
            logger.debug('Failed to run ripgrep:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to run ripgrep'
            };
        }
    });

    // Difftastic handler - raw interface to difftastic
    rpcHandlerManager.registerHandler<DifftasticRequest, DifftasticResponse>('difftastic', async (data) => {
        logger.debug('Difftastic request with args:', data.args, 'cwd:', data.cwd);

        // Validate cwd if provided
        if (data.cwd) {
            const validation = checkPath(data.cwd);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            data.cwd = validation.resolvedPath;
        }

        try {
            const result = await runDifftastic(data.args, { cwd: data.cwd });
            return {
                success: true,
                exitCode: result.exitCode,
                stdout: result.stdout.toString(),
                stderr: result.stderr.toString()
            };
        } catch (error) {
            logger.debug('Failed to run difftastic:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to run difftastic'
            };
        }
    });
}
