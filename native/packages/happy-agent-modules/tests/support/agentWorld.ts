import { AgentStorage } from "@slopus/happy-agent-base";

import { moduleDatabase } from "./moduleDatabase.js";

/** One collection's storage, with each agent's store kept so a test can look inside it. */
export interface AgentWorld {
    readonly storage: AgentStorage;
}

/** Storage standing in for a collection's, giving every agent its own isolated store. */
export async function agentWorld(): Promise<AgentWorld> {
    const database = moduleDatabase([], "agent-world");
    let locked = false;
    const storage = new AgentStorage({
        acquireLock: () => {
            if (locked) return Promise.reject(new Error("The agent store is already locked."));
            locked = true;
            return Promise.resolve({
                release: () => {
                    locked = false;
                    return Promise.resolve();
                },
            });
        },
        database: database.database,
    });
    await storage.migrate(database.context, []);
    return { storage };
}
