import { TaskDatabase } from "./taskDatabase.js";

/** The module's per-agent database view, shared by public methods and agent hooks. */
export function taskKV(agentId: string): TaskDatabase {
    return new TaskDatabase(agentId);
}
