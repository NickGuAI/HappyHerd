/** Background processes: an agent's work that outlived the tool call that started it. */

import type { Cuid2, ResourceVersion, Timestamp } from "./common.js";

/**
 * The process object.
 *
 * Process output does not travel through this API at all: what it announces is
 * existence and state, so a client can show what is running and its command.
 */
export interface BackgroundProcess {
    id: Cuid2;
    /** The agent that started it. */
    agentId: Cuid2;
    /** The command line the process was started with. */
    command: string;
    status: "running" | "exited";
    /** `null` while running, and after a kill that produced no code. */
    exitCode: number | null;
    version: ResourceVersion;
    startedAt: Timestamp;
    endedAt: Timestamp | null;
}

/** `DELETE /v0/agents/:agentId/processes/:processId` */
export interface BackgroundProcessResponse {
    process: BackgroundProcess;
}
