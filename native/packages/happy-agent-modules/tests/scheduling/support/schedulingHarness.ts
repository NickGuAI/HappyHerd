import type { AgentModuleHooks, AgentSystemRef } from "@slopus/happy-agent-base";
import { vi } from "vitest";

import { SchedulingModule } from "../../../sources/scheduling/SchedulingModule.js";
import { moduleDatabase, type ModuleDatabase } from "../../support/moduleDatabase.js";
import { resolveModuleHooks } from "../../support/moduleHooks.js";

/** The moment every scheduling test starts from, so due times are exact numbers to assert on. */
export const START_TIME = 1_000;

/** One message the fake collection was asked to deliver. */
export interface DeliveredMessage {
    readonly agentId: string;
    readonly text: string;
    readonly id: string | undefined;
    readonly metadata: Record<string, unknown> | undefined;
}

/**
 * Put time under the test's control.
 *
 * Scheduling reads the clock and holds its timers itself, so the only way to move its time is to
 * move the process's: fake timers advance `Date.now` and fire `setTimeout` together, which is
 * exactly the relationship the module relies on.
 */
export function useSchedulingClock(): void {
    vi.useFakeTimers({ now: START_TIME });
}

/** Move the clock forward, firing everything that becomes due on the way. */
export async function advance(milliseconds: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await settle();
}

/** Let every already-resolved promise run, without moving the clock. */
export async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
}

/** How many alarms scheduling is currently holding. */
export function armedAlarms(): number {
    return vi.getTimerCount();
}

/** A stand-in for the agent collection: it records deliveries and answers about parentage. */
export class TestAgents {
    readonly delivered: DeliveredMessage[] = [];
    readonly #parents: Map<string, string | null>;
    #failure: string | undefined;
    readonly #accepted = new Set<string>();

    constructor(parents: Readonly<Record<string, string | null>> = {}) {
        this.#parents = new Map(Object.entries(parents));
    }

    failNextDeliveries(reason: string): void {
        this.#failure = reason;
    }

    async parentOf(_ctx: unknown, agentId: string): Promise<string | null> {
        return this.#parents.get(agentId) ?? null;
    }

    async send(
        _ctx: unknown,
        agentId: string,
        message: { readonly content: readonly { readonly text?: string }[] },
        options?: { readonly id?: string; readonly metadata?: Record<string, unknown> },
    ): Promise<{ readonly accepted: string }> {
        if (this.#failure !== undefined) throw new Error(this.#failure);
        // Agent Base accepts one message per identity; the fake says so too.
        if (options?.id !== undefined && this.#accepted.has(options.id)) {
            return { accepted: "existing" };
        }
        if (options?.id !== undefined) this.#accepted.add(options.id);
        this.delivered.push({
            agentId,
            text: message.content.map((block) => block.text ?? "").join(""),
            id: options?.id,
            metadata: options?.metadata,
        });
        return { accepted: "created" };
    }

    get ref(): AgentSystemRef {
        return this as unknown as AgentSystemRef;
    }
}

export interface SchedulingHarness {
    readonly agents: TestAgents;
    readonly database: ModuleDatabase;
    readonly hooks: AgentModuleHooks;
    readonly module: SchedulingModule;
    readonly close: () => void;
}

export interface SchedulingHarnessOptions {
    readonly agents?: TestAgents;
    readonly database?: ModuleDatabase;
}

/** A started scheduling module over a real SQLite database, with delivery in hand. */
export async function schedulingHarness(
    name: string,
    options: SchedulingHarnessOptions = {},
): Promise<SchedulingHarness> {
    const agents = options.agents ?? new TestAgents();
    const module = new SchedulingModule();
    const database = options.database ?? moduleDatabase(module.migrations, name);
    await database.ready;
    const hooks = await resolveModuleHooks(database.context, module, agents.ref);
    return {
        agents,
        database,
        hooks,
        module,
        close: () => {
            module.stop();
            if (options.database === undefined) database.close();
        },
    };
}
