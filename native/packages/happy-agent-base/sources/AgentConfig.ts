import { release } from "node:os";

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { createContextNamespace, type Context } from "@steve.kite/stdlib";

import {
    agentMetadataSchema,
    cuid2Schema,
    ownAgentMetadata,
    type AgentMetadata,
} from "./AgentMetadata.js";

/** The operating systems Node reports, mirroring `NodeJS.Platform`. */
export const agentPlatformSchema = Type.Union([
    Type.Literal("aix"),
    Type.Literal("android"),
    Type.Literal("cygwin"),
    Type.Literal("darwin"),
    Type.Literal("freebsd"),
    Type.Literal("haiku"),
    Type.Literal("linux"),
    Type.Literal("netbsd"),
    Type.Literal("openbsd"),
    Type.Literal("sunos"),
    Type.Literal("win32"),
]);

/** The TypeScript type inferred from {@link agentPlatformSchema}. */
export type AgentPlatform = Static<typeof agentPlatformSchema>;

/**
 * The settings one module was configured with. The agent never looks inside: a module owns
 * the shape of its own entry and validates it against its own schema.
 */
export const agentModuleConfigSchema = Type.Record(Type.String(), Type.Unknown());

/** The TypeScript type inferred from {@link agentModuleConfigSchema}. */
export type AgentModuleConfig = Static<typeof agentModuleConfigSchema>;

/**
 * The machine an agent works on. It is all or nothing: an agent either knows its environment
 * completely or not at all, so nothing it is told about the machine is ever half-true.
 */
export const agentEnvironmentSchema = Type.Object({
    /** The operating system release, as a human-readable version string. */
    osVersion: Type.String(),
    /** The operating system the agent runs on. */
    platform: agentPlatformSchema,
    /** The absolute path the agent's work is rooted at. */
    workingDirectory: Type.String(),
    /** The shell the agent's commands run in, such as `/bin/zsh`. */
    shell: Type.String(),
});

/** The TypeScript type inferred from {@link agentEnvironmentSchema}. */
export type AgentEnvironment = Static<typeof agentEnvironmentSchema>;

/**
 * Where an agent came from, written once when it is created and never again. An agent made by
 * another agent — through a tool, most often — records that agent as its creator; one made by a
 * person, a daemon, or a restart has no creator at all rather than a made-up one.
 */
export const agentProvenanceSchema = Type.Object({
    /** When the agent was created, in milliseconds since the epoch. */
    createdAt: Type.Number(),
    /** The agent that created this one, absent when nothing did. */
    createdBy: Type.Optional(cuid2Schema),
});

/** The TypeScript type inferred from {@link agentProvenanceSchema}. */
export type AgentProvenance = Static<typeof agentProvenanceSchema>;

/**
 * What an agent was created with: where it came from, the environment it works on, when it has
 * one, one opaque settings map per module, and descriptive metadata. Provenance, environment, and
 * module settings stay fixed; metadata changes only through the agent metadata API, which
 * shallow-merges updates and persists the resulting complete configuration.
 */
export const agentConfigSchema = Type.Object({
    /**
     * When this agent was created and by whom. Absent only for an agent created before this was
     * recorded, or one built directly rather than through an agent system.
     */
    provenance: Type.Optional(agentProvenanceSchema),
    /** The machine this agent was told it works on, when it was told anything at all. */
    environment: Type.Optional(agentEnvironmentSchema),
    /** Per-module settings, keyed by module name; each entry is opaque to the agent. */
    modules: Type.Optional(Type.Record(Type.String(), agentModuleConfigSchema)),
    /** Immutable descriptive metadata, replaced only through a merged metadata update. */
    metadata: Type.Optional(agentMetadataSchema),
});

/** The TypeScript type inferred from {@link agentConfigSchema}. */
export type AgentConfig = Static<typeof agentConfigSchema>;

/** @internal Validate and own one configuration while deeply freezing its metadata. */
export function ownAgentConfig(config: AgentConfig): AgentConfig {
    if (!Value.Check(agentConfigSchema, config)) {
        throw new Error("The agent configuration is not valid.");
    }
    const cloned = structuredClone(config);
    const metadata = ownAgentMetadata(cloned.metadata);
    return {
        ...cloned,
        ...(metadata === undefined ? {} : { metadata }),
    };
}

/**
 * The environment this process is running in, ready to be handed to an agent at creation. The
 * platform is typed, so a Node release reporting an unknown platform fails to compile rather
 * than slipping into a persisted configuration; an unset `SHELL` reports as no shell at all.
 */
export function currentAgentEnvironment(): AgentEnvironment {
    const platform: AgentPlatform = process.platform;
    return {
        osVersion: release(),
        platform,
        workingDirectory: process.cwd(),
        shell: process.env.SHELL ?? "",
    };
}

/** The context slot the agent's configuration is carried in, unset until an agent attaches one. */
const configNamespace = createContextNamespace<AgentConfig | undefined>(
    "happyAgentBase.agentConfig",
    undefined,
);

/** Carry the agent's current configuration; every hook and tool reads it back. */
export function withAgentConfig(ctx: Context, config: AgentConfig): Context {
    return configNamespace.set(ctx, config);
}

/** The configuration of the agent owning this context, when one was attached. */
export function agentConfig(ctx: Context): AgentConfig | undefined {
    return configNamespace.get(ctx);
}

/** The environment of the agent owning this context, when it was created with one. */
export function agentEnvironment(ctx: Context): AgentEnvironment | undefined {
    return configNamespace.get(ctx)?.environment;
}

/** Where the agent owning this context came from, when its creation was recorded. */
export function agentProvenance(ctx: Context): AgentProvenance | undefined {
    return configNamespace.get(ctx)?.provenance;
}

/** When the agent owning this context was created, in milliseconds since the epoch. */
export function agentCreatedAt(ctx: Context): number | undefined {
    return configNamespace.get(ctx)?.provenance?.createdAt;
}

/**
 * The agent that created the agent owning this context. Absent when nothing did — an agent a
 * person or a daemon started has no creator, and is not attributed to one.
 */
export function agentCreatedBy(ctx: Context): string | undefined {
    return configNamespace.get(ctx)?.provenance?.createdBy;
}

/** The immutable metadata describing the agent owning this context, when it has any. */
export function agentMetadata(ctx: Context): AgentMetadata | undefined {
    return configNamespace.get(ctx)?.metadata;
}

/** The opaque settings the named module was configured with, if it was configured at all. */
export function agentModuleConfig(ctx: Context, name: string): AgentModuleConfig | undefined {
    return configNamespace.get(ctx)?.modules?.[name];
}
