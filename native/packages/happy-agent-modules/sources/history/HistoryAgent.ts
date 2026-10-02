import { Type, type Static } from "@sinclair/typebox";

import {
    historyAgentIdSchema,
    MAX_HISTORY_AGENT_ID_LENGTH,
    MAX_HISTORY_TOTAL_MESSAGES,
} from "./HistoryMessage.js";

/** Maximum number of related agents one history response may describe. */
export const MAX_HISTORY_AGENT_SUMMARIES = 256;
/** Maximum characters in the path naming an agent in a roster. */
export const MAX_HISTORY_AGENT_PATH_LENGTH = 1_024;
/** Maximum characters describing one agent in a roster. */
export const MAX_HISTORY_AGENT_DESCRIPTION_LENGTH = 4_000;
/** Maximum characters in one agent's status. */
export const MAX_HISTORY_AGENT_STATUS_LENGTH = 256;

const historyAgentPathSchema = Type.String({
    minLength: 1,
    maxLength: MAX_HISTORY_AGENT_PATH_LENGTH,
    pattern: "^[^\\u0000\\r\\n]+$",
});

const historyAgentDescriptionSchema = Type.String({
    maxLength: MAX_HISTORY_AGENT_DESCRIPTION_LENGTH,
});

const historyAgentStatusSchema = Type.String({
    minLength: 1,
    maxLength: MAX_HISTORY_AGENT_STATUS_LENGTH,
    pattern: "^[^\\u0000\\r\\n]+$",
});

/** One agent a history reader is told about. */
export const historyAgentSummarySchema = Type.Object(
    {
        agentId: historyAgentIdSchema,
        description: Type.Optional(historyAgentDescriptionSchema),
        messageCount: Type.Integer({
            minimum: 0,
            maximum: MAX_HISTORY_TOTAL_MESSAGES,
        }),
        path: historyAgentPathSchema,
        status: historyAgentStatusSchema,
    },
    { additionalProperties: false },
);

/** The bounded roster carried by one history response. */
export const historyAgentSummariesSchema = Type.Array(historyAgentSummarySchema, {
    maxItems: MAX_HISTORY_AGENT_SUMMARIES,
});

/** The TypeScript type inferred from {@link historyAgentSummarySchema}. */
export type HistoryAgentSummary = Static<typeof historyAgentSummarySchema>;

/** The TypeScript type inferred from {@link historyAgentSummariesSchema}. */
export type HistoryAgentSummaries = Static<typeof historyAgentSummariesSchema>;

/**
 * The agent a history read is about. Anything longer than an Agent ID may be is refused rather
 * than guessed at; anything shaped like one is read as one, whether or not it has recorded
 * anything yet.
 */
export const historyAgentTargetSchema = Type.String({
    description:
        "Stable Agent ID. Omitted means the calling agent; an agent that has recorded nothing simply has an empty history.",
    minLength: 1,
    maxLength: Math.max(MAX_HISTORY_AGENT_ID_LENGTH, MAX_HISTORY_AGENT_PATH_LENGTH),
    pattern: "^[^\\u0000\\r\\n]+$",
});
