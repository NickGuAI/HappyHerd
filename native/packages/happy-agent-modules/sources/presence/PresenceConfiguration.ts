import type { HappyAgentConfigValues } from "../config/index.js";

import {
    BUILT_IN_PRESENCES,
    ONLINE_PRESENCE_ID,
    assertPresenceCatalog,
} from "./PresenceCatalog.js";
import {
    assertPresenceStoredState,
    type PresenceDefinition,
    type PresenceStoredState,
} from "./PresenceState.js";

/** The most states one installation may have, built-in and configured together. */
export const MAX_PRESENCE_DEFINITIONS = 64;

/** What the settings file says about presence, once it is a catalog and a state to start in. */
export interface ConfiguredPresence {
    readonly catalog: readonly PresenceDefinition[];
    readonly initialState: PresenceStoredState | undefined;
}

/**
 * Turn configured presence settings into the catalog and starting state this module runs on.
 *
 * A settings entry named after a built-in state refines it — a person may retitle Away or give it
 * different guidance — and keeps that state's meaning, while any other name is a state of their
 * own. Anything the settings only omit falls back to what the built-in already said.
 */
export function readConfiguredPresence(
    values: HappyAgentConfigValues["presence"],
): ConfiguredPresence {
    const catalog: PresenceDefinition[] = Object.entries(values.states).map(([id, state]) => {
        const builtIn = BUILT_IN_PRESENCES.find((candidate) => candidate.id === id);
        return {
            id,
            status: builtIn?.status ?? "custom",
            title: state.title ?? builtIn?.title ?? id,
            emoji: state.emoji ?? builtIn?.emoji ?? "🟣",
            prompt: state.prompt ?? builtIn?.prompt ?? "",
            answerWaitMs:
                state.answerWaitMs === undefined
                    ? (builtIn?.answerWaitMs ?? 0)
                    : state.answerWaitMs,
        };
    });
    assertPresenceCatalog(catalog);
    const known = new Set([
        ...BUILT_IN_PRESENCES.map((definition) => definition.id),
        ...catalog.map((definition) => definition.id),
    ]);
    if (known.size > MAX_PRESENCE_DEFINITIONS) {
        throw new Error(
            `Presence settings define more than ${String(MAX_PRESENCE_DEFINITIONS)} states.`,
        );
    }
    const current = values.current;
    if (current === undefined) return { catalog, initialState: undefined };
    if (!known.has(current)) {
        throw new Error(`Configured current presence "${current}" is not defined.`);
    }
    if (values.fallback !== undefined && !known.has(values.fallback)) {
        throw new Error(`Configured fallback presence "${values.fallback}" is not defined.`);
    }
    // A state that ends has to say what follows it, and Online is what a person is when they have
    // said nothing else.
    const fallbackPresenceId =
        values.fallback ?? (values.until === undefined ? undefined : ONLINE_PRESENCE_ID);
    const initialState = {
        presenceId: current,
        ...(values.until === undefined ? {} : { expiresAt: values.until }),
        ...(fallbackPresenceId === undefined ? {} : { fallbackPresenceId }),
    };
    assertPresenceStoredState(initialState);
    return { catalog, initialState };
}
