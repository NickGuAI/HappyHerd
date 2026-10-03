import type { SessionTool } from "@/core/SessionTool.js";

/** Model-visible configuration supplied up front for a model used by the session. */
export interface SessionModelConfiguration {
    readonly instructions: string;
    readonly tools?: readonly SessionTool[];
}
