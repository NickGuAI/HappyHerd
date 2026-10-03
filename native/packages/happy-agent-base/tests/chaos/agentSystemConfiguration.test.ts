import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it } from "vitest";

import {
    agentModuleConfig,
    AgentKV,
    AgentSystemLocal,
    type AgentConfig,
    type AgentModule,
} from "../../sources/index.js";
import { InMemoryPersistence } from "../gym/InMemoryPersistence.js";
import { ScriptedProvider } from "../gym/ScriptedProvider.js";
import {
    InMemoryAgentStorage,
    inMemoryStorageLock,
    providersOf,
    textTurn,
    user,
} from "../gym/fixtures.js";

const ctx = createRootContext().named("happy-agent-base-agent-system-configuration");

function managerKV(persistence: InMemoryPersistence): AgentKV {
    return new AgentKV(persistence, "agentSystem.");
}

async function collection(
    managerPersistence: InMemoryPersistence,
    agentPersistence: InMemoryPersistence,
    provider: ScriptedProvider,
    modules: readonly AgentModule[] = [],
): Promise<AgentSystemLocal> {
    return await AgentSystemLocal.create(
        ctx,
        new InMemoryAgentStorage({
            acquireLock: inMemoryStorageLock(),
            kv: managerKV(managerPersistence),
            persistence: () => agentPersistence,
        }),
        { modules, providers: providersOf(provider), provider: "scripted", models: [] },
    );
}

describe("agent system configuration", () => {
    it("copies nested creation config before caller mutation can diverge memory from storage", async () => {
        const managerDisk = new InMemoryPersistence();
        const agentDisk = new InMemoryPersistence();
        let observedSetting: unknown;
        const recorder: AgentModule = new (class implements AgentModule {
            readonly name = "recorder";

            beforeStart() {
                return {
                    instructions(hookCtx: Context): string {
                        observedSetting = agentModuleConfig(hookCtx, "recorder")?.label;
                        return "";
                    },
                };
            }
        })();
        const owner = await collection(
            managerDisk,
            agentDisk,
            new ScriptedProvider([textTurn("answered")]),
            [recorder],
        );
        const config: AgentConfig = {
            modules: { recorder: { label: "original" } },
        };

        const creation = owner.create(ctx, config);
        // The caller goes on editing the object it passed while the creation is still running.
        const callerSettings = config.modules?.recorder;
        if (callerSettings !== undefined) callerSettings.label = "mutated by caller";
        const agent = await creation;
        await agent.send(ctx, user("go"));
        await agent.waitForIdle();
        const durableConfig = await owner.config(ctx, agent.id);
        await agent.close();

        expect({
            durableLabel: durableConfig?.modules?.recorder?.label,
            observedSetting,
        }).toEqual({
            durableLabel: "original",
            observedSetting: "original",
        });
    });
});
