import type { AgentDatabase, AgentSystemRef } from "@slopus/happy-agent-base";
import type { Context } from "@steve.kite/stdlib";

import { PresenceModule, presenceMigrations } from "../../sources/presence/index.js";
import { UserInputModule } from "../../sources/userInput/UserInputModule.js";
import type {
    UserInputAskInput,
    UserInputEvent,
    UserInputPresenceState,
    UserInputRequest,
} from "../../sources/userInput/index.js";
import { moduleDatabase, type ModuleDatabase } from "../support/moduleDatabase.js";
import { testConfig } from "../support/computeModule.js";

/**
 * User input asks presence whether the person can answer, so a test gives it the presence module
 * the product gives it. Nothing about the module is scripted: a test that wants the person away
 * puts them away through `presence.setPresence`.
 */
export function createUserInputModule(
    presence: PresenceModule = new PresenceModule(testConfig),
): UserInputModule {
    return new UserInputModule(presence);
}

export function createPresenceModule(): PresenceModule {
    return new PresenceModule(testConfig);
}

/**
 * A presence module whose answer to user input a test writes directly.
 *
 * Only the two questions user input asks are overridden, which is how a hostile or impossible
 * presence value reaches the boundary user input validates. Everything else is the real module.
 */
export class ScriptedPresenceModule extends PresenceModule {
    #state: UserInputPresenceState | undefined;
    readonly #subscribers = new Set<
        (ctx: Context, state: UserInputPresenceState | undefined) => void | Promise<void>
    >();
    readonly #onSubscribe:
        | ((ctx: Context, publish: (state: UserInputPresenceState | undefined) => void) => void)
        | undefined;

    constructor(
        state?: UserInputPresenceState,
        onSubscribe?: (
            ctx: Context,
            publish: (state: UserInputPresenceState | undefined) => void,
        ) => void,
    ) {
        super(testConfig);
        this.#state = state;
        this.#onSubscribe = onSubscribe;
    }

    get subscriberCount(): number {
        return this.#subscribers.size;
    }

    override async userInputState(_ctx: Context): Promise<never> {
        return this.#state as never;
    }

    override async subscribeUserInput(ctx: Context, callback: never): Promise<() => void> {
        const subscriber = callback as unknown as (
            ctx: Context,
            state: UserInputPresenceState | undefined,
        ) => void | Promise<void>;
        this.#subscribers.add(subscriber);
        this.#onSubscribe?.(ctx, (state) => {
            void subscriber(ctx, state);
        });
        return () => {
            this.#subscribers.delete(subscriber);
        };
    }

    /** Tell everyone watching that presence changed, exactly as a committed change would. */
    async publish(ctx: Context, state: UserInputPresenceState | undefined): Promise<void> {
        this.#state = state;
        for (const subscriber of this.#subscribers) await subscriber(ctx, state);
    }
}

export function createUserInputDatabase(
    module: UserInputModule,
    name: string,
): ModuleDatabase & { readonly database: AgentDatabase } {
    // Presence lives in the same database as user input, so its tables are here too: user input
    // reads presence through the module, and that module reads its own rows.
    return moduleDatabase([...module.migrations, ...presenceMigrations], name);
}

/**
 * A family tree where `child` is the child of `parent` and everyone else stands alone. Cross-agent
 * access is decided from ancestry, so this is all user input needs from the collection.
 */
export function agentsWithParent(child: string, parent: string): AgentSystemRef {
    return {
        parentOf: (_ctx: Context, agentId: string) =>
            Promise.resolve(agentId === child ? parent : null),
    } as unknown as AgentSystemRef;
}

export function singularAsk(overrides: Partial<UserInputAskInput> = {}): UserInputAskInput {
    return {
        question: "Which option should I use?",
        context: "The choice changes the implementation.",
        ...overrides,
    } as UserInputAskInput;
}

export function onlinePresence(
    overrides: Partial<UserInputPresenceState> = {},
): UserInputPresenceState {
    return {
        answerWaitMs: null,
        title: "Online",
        emoji: "🟢",
        prompt: "The user can answer.",
        ...overrides,
    };
}

export async function createRequest(
    database: ModuleDatabase,
    module: UserInputModule,
    agentId: string,
    input: UserInputAskInput = singularAsk(),
    requestId = "request-1",
): Promise<UserInputRequest> {
    await database.ready;
    return await module.ask(database.context, agentId, input, requestId);
}

export function eventTypes(events: readonly UserInputEvent[]): readonly string[] {
    return events.map((event) => event.type);
}
