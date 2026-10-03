import { GoalDatabase } from "./goalDatabase.js";

/** The module-owned per-agent database view used by public operations and hooks. */
export function goalKV(agentId: string): GoalDatabase {
    return new GoalDatabase(agentId);
}
