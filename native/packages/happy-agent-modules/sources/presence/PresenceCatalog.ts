import {
    assertPresenceDefinition,
    presenceCatalogInputSchema,
    type PresenceDefinition,
} from "./PresenceState.js";
import { Value } from "@sinclair/typebox/value";

export const ONLINE_PRESENCE_ID = "online";
export const AWAY_PRESENCE_ID = "away";
export const OFFLINE_PRESENCE_ID = "offline";
export const DND_PRESENCE_ID = "dnd";

export const ONLINE_PRESENCE: PresenceDefinition = {
    id: ONLINE_PRESENCE_ID,
    status: "online",
    title: "Online",
    emoji: "🟢",
    prompt: "The user is at the keyboard and can answer questions right away.",
    answerWaitMs: null,
};

export const AWAY_PRESENCE: PresenceDefinition = {
    id: AWAY_PRESENCE_ID,
    status: "away",
    title: "Away",
    emoji: "🌙",
    prompt: "The user is away and cannot be reached. Do not wait for an answer. Decide with your best judgement, keep working, and record anything the user should look at later.",
    answerWaitMs: 0,
};

export const OFFLINE_PRESENCE: PresenceDefinition = {
    id: OFFLINE_PRESENCE_ID,
    status: "offline",
    title: "Offline",
    emoji: "⚫",
    prompt: "The user is offline and cannot be reached. Continue on your own and record anything the user should look at later.",
    answerWaitMs: 0,
};

export const DND_PRESENCE: PresenceDefinition = {
    id: DND_PRESENCE_ID,
    status: "dnd",
    title: "Do not disturb",
    emoji: "🔕",
    prompt: "The user has asked not to be disturbed. Continue on your own and record anything the user should look at later.",
    answerWaitMs: 0,
};

export const BUILT_IN_PRESENCES: readonly PresenceDefinition[] = [
    ONLINE_PRESENCE,
    AWAY_PRESENCE,
    OFFLINE_PRESENCE,
    DND_PRESENCE,
];

for (const presence of BUILT_IN_PRESENCES) {
    assertPresenceDefinition(presence);
}

export function isBuiltInPresenceId(id: string): boolean {
    return BUILT_IN_PRESENCES.some((presence) => presence.id === id);
}

export function assertPresenceCatalog(
    value: unknown,
): asserts value is readonly PresenceDefinition[] {
    if (!Value.Check(presenceCatalogInputSchema, value)) {
        throw new Error("Presence catalog is invalid.");
    }
    const ids = new Set<string>();
    for (const presence of value) {
        assertPresenceDefinition(presence);
        if (ids.has(presence.id)) {
            throw new Error("Presence catalog contains duplicate IDs.");
        }
        ids.add(presence.id);
    }
}
