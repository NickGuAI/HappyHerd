import type {
    AgentBaseModelChange,
    AgentModel,
    AgentModuleAgent,
    AgentModuleScope,
    AgentSystemRef,
} from "@slopus/happy-agent-base";
import type { Context } from "@steve.kite/stdlib";

import { HistoryModule } from "../../sources/history/HistoryModule.js";
import type { HistoryBlock, HistoryRole } from "../../sources/history/HistoryMessage.js";
import { ModelSwitchModule } from "../../sources/modelSwitch/ModelSwitchModule.js";
import { moduleDatabase, type ModuleDatabase } from "../support/moduleDatabase.js";
import { sharedKV, providersOf } from "../support/fixtures.js";
import { ScriptedProvider } from "../support/ScriptedProvider.js";

export const DEFAULT_AGENT_ID = "model-switch-test-agent";

/**
 * A real history module over its own in-memory database.
 *
 * The model-switch module reads the history through `HistoryModule` itself, so a test gives it
 * one and records into it rather than standing a reader in its place.
 */
export async function historyWith(
    name: string,
    messages: readonly {
        readonly role?: HistoryRole;
        readonly blocks?: readonly HistoryBlock[];
    }[],
    agentId = DEFAULT_AGENT_ID,
): Promise<{ readonly history: HistoryModule; readonly database: ModuleDatabase }> {
    const history = new HistoryModule();
    const database = moduleDatabase(history.migrations, name);
    await database.ready;
    for (const [index, message] of messages.entries()) {
        await history.record(database.context, agentId, {
            blocks: [...(message.blocks ?? [{ type: "text", text: `message ${index}` }])],
            recordId: `record-${index}`,
            role: message.role ?? "user",
        });
    }
    return { history, database };
}

export function modelSwitchScope(agentId = DEFAULT_AGENT_ID): AgentModuleScope {
    const agent: AgentModuleAgent = {
        id: agentId,
        metadata: undefined,
        provider: "scripted",
        providerKind: "gym",
        model: undefined,
        effort: undefined,
        tier: undefined,
        permissionMode: "auto",
    };
    return {
        agent,
        kv: sharedKV(),
        sharedKV: sharedKV(),
        runKV: sharedKV(),
        historyKV: sharedKV(),
    };
}

export function modelChange(overrides: Partial<AgentBaseModelChange> = {}): AgentBaseModelChange {
    const provider = new ScriptedProvider([]);
    return {
        previousModel: "openai/gpt-5.6-sol",
        model: "anthropic/opus-5",
        previousProvider: "scripted",
        provider: "scripted",
        providers: providersOf(provider),
        wasReset: true,
        ...overrides,
    };
}

export function agentReference(models: readonly AgentModel[] = []): AgentSystemRef {
    return { models } as unknown as AgentSystemRef;
}

export async function modelSwitchNoticeFromHook(
    module: ModelSwitchModule,
    ctx: Context,
    options: {
        readonly models?: readonly AgentModel[];
        readonly change?: AgentBaseModelChange;
        readonly agentId?: string;
    } = {},
) {
    const hooks = await module.beforeStart?.(ctx, agentReference(options.models ?? []));
    if (hooks?.modelChanged === undefined) {
        throw new Error("ModelSwitchModule did not return modelChanged.");
    }
    return await hooks.modelChanged(
        ctx,
        modelSwitchScope(options.agentId),
        options.change ?? modelChange(),
    );
}

/** Read the text of a notice, failing the test when there is no notice or it is not text. */
export function textFromNotice(
    result: Awaited<ReturnType<typeof modelSwitchNoticeFromHook>>,
): string {
    if (result === undefined) throw new Error("Expected a model-switch notice.");
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("Expected a text model-switch notice.");
    return block.text;
}
