/** Terminals: interactive shells belonging to a workspace, not to any agent. */

import type { Cuid2, MutationId, ResourceVersion } from "./common.js";

/**
 * The terminal object.
 *
 * No terminal route carries screen contents: the picture and everything typed
 * into it travel over the attachment WebSocket.
 */
export interface Terminal {
    id: Cuid2;
    workspaceId: Cuid2;
    status: "running" | "exited";
    /** Set once the terminal exited. */
    exitCode: number | null;
    cols: number;
    rows: number;
    /** Settled at creation and never changed; it seeds every replica's emulator. */
    colorScheme: "dark" | "light";
    /** Changes whenever a new process backs the terminal. */
    epoch: string;
    version: ResourceVersion;
}

/** `GET /v0/workspaces/:workspaceId/terminals` */
export interface TerminalListResponse {
    terminals: Terminal[];
}

/** Every single-terminal route answers with this. */
export interface TerminalResponse {
    terminal: Terminal;
}

/** `POST /v0/workspaces/:workspaceId/terminals` — every field is optional. */
export interface OpenTerminalRequest {
    shell?: string;
    /** What to run instead of an interactive shell; the shell still hosts it. */
    command?: string;
    /** Absolute, or relative to the workspace folder; defaults to the folder. */
    cwd?: string;
    cols?: number;
    rows?: number;
    maxScrollback?: number;
    colorScheme?: "dark" | "light";
    mutationId?: MutationId;
}

/** `PATCH /v0/workspaces/:workspaceId/terminals/:terminalId` */
export interface ResizeTerminalRequest {
    cols: number;
    rows: number;
    mutationId?: MutationId;
}
