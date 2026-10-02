import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const MAX_ENDPOINT_LENGTH = 2_048;

/** How much a log or history-dump file may hold before the previous generation is replaced. */
export const MAX_OBSERVATION_FILE_BYTES = 16 * 1_048_576;
/** How much unwritten text one file may hold before further lines are dropped and counted. */
export const MAX_OBSERVATION_PENDING_BYTES = 4 * 1_048_576;
/** How many agents keep an open history-dump file before the least recent one is closed. */
export const MAX_OBSERVATION_HISTORY_FILES = 64;

/** The severities pino writes, in the order stdlib's `Logger` declares them. */
export const OBSERVATION_LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export const observationLogLevelSchema = Type.Union(
    OBSERVATION_LOG_LEVELS.map((level) => Type.Literal(level)),
);

/**
 * The endpoint an OTLP/HTTP trace exporter posts to.
 *
 * A scheme on its own is not an address, so the first character after `//` has to begin a host. A
 * path, a query, or a fragment standing where the host belongs is rejected rather than handed to
 * an exporter that could never reach anything.
 */
export const observationEndpointSchema = Type.String({
    minLength: 1,
    maxLength: MAX_ENDPOINT_LENGTH,
    pattern: "^https?://[^\\s/?#]+[^\\s]*$",
});

export const observationSettingsSchema = Type.Object(
    {
        /** Whether every history change is also appended to a file the user can read. */
        historyDump: Type.Boolean(),
        /** The lowest severity written to the log file. */
        logLevel: observationLogLevelSchema,
        /** Whether anything is written to the log file at all. */
        logs: Type.Boolean(),
        /** Whether spans are collected and exported over OTLP. */
        traces: Type.Boolean(),
        /** Where those spans are sent. */
        tracesEndpoint: observationEndpointSchema,
    },
    { additionalProperties: false },
);

/** What the agent observes about itself, once configuration and environment have both had a say. */
export type ObservationSettings = Static<typeof observationSettingsSchema>;

/**
 * Logging is on because a daemon that records nothing about itself cannot be supported. Tracing
 * and the history dump are off because both need somewhere to go — a collector, or disk the user
 * agreed to spend — and neither is worth turning on for someone who never asked.
 */
export const DEFAULT_OBSERVATION_SETTINGS: ObservationSettings = Object.freeze({
    historyDump: false,
    logLevel: "info",
    logs: true,
    traces: false,
    tracesEndpoint: "http://127.0.0.1:4318/v1/traces",
});

const BOOLEAN_ENVIRONMENT_VALUES: Readonly<Record<string, boolean>> = {
    "0": false,
    "1": true,
    false: false,
    no: false,
    off: false,
    on: true,
    true: true,
    yes: true,
};

/**
 * Apply the `HAPPY_OBSERVATION_*` overrides on top of the configured settings.
 *
 * Configuration is where observation is decided; the environment exists for the one-off debugging
 * run where editing `happy.toml` would be absurd. An override that cannot be understood fails
 * loudly rather than being ignored, because a person who set it believes it took effect.
 */
export function resolveObservationSettings(
    configured: ObservationSettings,
    environment: NodeJS.ProcessEnv = process.env,
): ObservationSettings {
    if (!Value.Check(observationSettingsSchema, configured)) {
        throw new Error("The configured observation settings are invalid.");
    }
    const resolved: ObservationSettings = {
        historyDump:
            readBoolean(environment, "HAPPY_OBSERVATION_HISTORY_DUMP") ?? configured.historyDump,
        logLevel: readLogLevel(environment) ?? configured.logLevel,
        logs: readBoolean(environment, "HAPPY_OBSERVATION_LOGS") ?? configured.logs,
        traces: readBoolean(environment, "HAPPY_OBSERVATION_TRACES") ?? configured.traces,
        tracesEndpoint: readEndpoint(environment) ?? configured.tracesEndpoint,
    };
    if (!Value.Check(observationSettingsSchema, resolved)) {
        throw new Error("The resolved observation settings are invalid.");
    }
    return Object.freeze(resolved);
}

function readBoolean(environment: NodeJS.ProcessEnv, name: string): boolean | undefined {
    const raw = environment[name]?.trim().toLowerCase();
    if (raw === undefined || raw.length === 0) return undefined;
    const parsed = BOOLEAN_ENVIRONMENT_VALUES[raw];
    if (parsed === undefined) {
        throw new Error(`${name} must be one of "true", "false", "1", or "0".`);
    }
    return parsed;
}

function readLogLevel(environment: NodeJS.ProcessEnv): ObservationSettings["logLevel"] | undefined {
    const raw = environment.HAPPY_OBSERVATION_LOG_LEVEL?.trim().toLowerCase();
    if (raw === undefined || raw.length === 0) return undefined;
    if (!Value.Check(observationLogLevelSchema, raw)) {
        throw new Error(
            `HAPPY_OBSERVATION_LOG_LEVEL must be one of ${OBSERVATION_LOG_LEVELS.join(", ")}.`,
        );
    }
    return raw;
}

function readEndpoint(environment: NodeJS.ProcessEnv): string | undefined {
    const raw = environment.HAPPY_OBSERVATION_TRACES_ENDPOINT?.trim();
    if (raw === undefined || raw.length === 0) return undefined;
    if (!Value.Check(observationEndpointSchema, raw)) {
        throw new Error("HAPPY_OBSERVATION_TRACES_ENDPOINT must be an HTTP or HTTPS URL.");
    }
    return raw;
}
