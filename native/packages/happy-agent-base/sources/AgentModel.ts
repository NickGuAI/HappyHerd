import type { SessionReasoningEffort, SessionServiceTier } from "@slopus/happy-providers";

/** One provider/model route available to agents and subagents. */
export interface AgentModel {
    /** The registry ID of the provider this route is served through. */
    readonly providerId: string;
    /** The model identifier as the provider knows it. */
    readonly id: string;
    /** Human-readable label shown in the model picker. */
    readonly name: string;
    /** Reasoning efforts this model accepts, in picker order. */
    readonly effortLevels: readonly SessionReasoningEffort[];
    /** The effort used when nothing more specific was requested. */
    readonly defaultEffort: SessionReasoningEffort;
    /** Service tiers this model accepts, when the provider offers a choice. */
    readonly serviceTiers?: readonly SessionServiceTier[];
}
