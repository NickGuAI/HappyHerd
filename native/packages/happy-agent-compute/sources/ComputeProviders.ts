import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "./Compute.js";
import type { ComputeProvider } from "./ComputeProvider.js";

/**
 * The kinds of machine available, and the one place a machine is built from a name.
 *
 * Configuration arrives as data — from a file, a protocol message, or a person's choice — so the
 * name and the settings are both untrusted until checked. This resolves the name to a provider,
 * validates the settings against that provider's schema, and only then builds. Nothing else needs
 * to know which kinds exist, and adding a kind is registering one provider.
 */
export class ComputeProviders {
    readonly #providers = new Map<string, ComputeProvider>();

    constructor(providers: readonly ComputeProvider[] = []) {
        for (const provider of providers) this.register(provider);
    }

    /** Add a kind of machine. Registering an id twice is a mistake, not a silent replacement. */
    register(provider: ComputeProvider): void {
        if (this.#providers.has(provider.id)) {
            throw new Error(`A compute provider is already registered for "${provider.id}".`);
        }
        this.#providers.set(provider.id, provider);
    }

    /** Every provider, for a person or a menu that has to describe the choices. */
    all(): readonly ComputeProvider[] {
        return [...this.#providers.values()];
    }

    /** The ids available. */
    ids(): readonly string[] {
        return [...this.#providers.keys()];
    }

    /** The provider for an id, or nothing when that id was never registered. */
    get(id: string): ComputeProvider | undefined {
        return this.#providers.get(id);
    }

    /**
     * Build a machine from a name and its settings.
     *
     * The error for an unknown id names the ids that do exist, because the usual cause is a typo
     * or a configuration written for a build where another provider was registered.
     */
    async create(ctx: Context, id: string, config: unknown): Promise<Compute> {
        const provider = this.#providers.get(id);
        if (!provider) {
            const available = this.ids().join(", ") || "none";
            throw new Error(`There is no "${id}" compute. Available: ${available}.`);
        }
        const errors = [...Value.Errors(provider.configSchema, config)];
        if (errors.length > 0) {
            const detail = errors
                .slice(0, 3)
                .map((error) => `${error.path || "/"} ${error.message}`)
                .join("; ");
            throw new Error(`The ${id} compute configuration is not valid: ${detail}.`);
        }
        return provider.create(ctx, Value.Cast(provider.configSchema, config));
    }
}
