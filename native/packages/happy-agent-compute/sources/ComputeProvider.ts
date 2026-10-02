import type { Static, TSchema } from "@sinclair/typebox";
import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "./Compute.js";

/**
 * A kind of machine an agent can be given, and how to build one.
 *
 * A provider is the only thing that knows what its own configuration means. Everything above it
 * names an id and hands over a configuration value, which is checked against the provider's schema
 * before the provider sees it — so a bad configuration is a clear error where the machine is
 * chosen, rather than an undefined field discovered halfway through a command.
 *
 * The configuration type is a parameter rather than one shared union because providers have
 * genuinely nothing in common: a container image means nothing to an in-process shell, and an
 * in-memory filesystem means nothing to the host.
 */
export interface ComputeProvider<Schema extends TSchema = TSchema> {
    /**
     * The name a caller selects this provider by, such as `host` or `docker`.
     *
     * This is an ordinary string rather than a fixed set, because the set of machines an agent can
     * work on is open: a build embeds the providers it has, and one added later is registered the
     * same way as the three that ship today.
     */
    readonly id: string;
    /** What this kind of machine is, in one line, for a person choosing between them. */
    readonly description: string;
    /**
     * Whether a machine built from this configuration can reach the real filesystem of the computer
     * the agent is running on.
     *
     * This is the difference between a mistake that costs a container and a mistake that costs a
     * person's home directory. A sandbox still applies either way, but a sandbox is a boundary
     * drawn around real files, and a boundary can be misconfigured — so the layer above needs to
     * know, before anything runs, whether it is about to hand an agent the actual machine.
     *
     * It takes the configuration because only the provider can tell: an in-process shell backed by
     * memory touches nothing real, the same shell mounted on a folder touches that folder, and a
     * container reaches exactly as far as its bind mounts. Answer pessimistically when unsure. It
     * is a property of the machine rather than of any permission, and it does not soften as
     * permissions narrow.
     *
     * Callers use it to warn, to confirm, or to refuse: an unattended or untrusted run can require
     * an isolated compute and decline this one outright.
     */
    providesHostFileSystemAccess(config: Static<Schema>): boolean;
    /** The shape of this provider's configuration. */
    readonly configSchema: Schema;
    /** Build one machine. The returned compute owns everything it starts. */
    create(ctx: Context, config: Static<Schema>): Promise<Compute>;
}

/** The configuration a provider accepts, derived from its own schema. */
export type ComputeConfigOf<Provider extends ComputeProvider> =
    Provider extends ComputeProvider<infer Schema> ? Static<Schema> : never;
