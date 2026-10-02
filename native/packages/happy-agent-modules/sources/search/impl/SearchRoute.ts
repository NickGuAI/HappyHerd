import type { AgentModel, AgentProviders } from "@slopus/happy-agent-base";
import type { SessionReasoningEffort } from "@slopus/happy-providers";

/** One configured account and model a bounded vendor search can run on. */
export interface SearchRoute {
    /** Registry ID of the configured provider, as a person named it. */
    readonly providerId: string;
    readonly model: string;
    readonly effort: SessionReasoningEffort;
}

/** Every account each vendor search can run on, and the account this chat itself uses. */
export interface SearchRoutes {
    readonly bedrock: readonly SearchRoute[];
    readonly claude: readonly SearchRoute[];
    readonly codex: readonly SearchRoute[];
    readonly grok: readonly SearchRoute[];
    readonly currentProviderId?: string;
}

/**
 * The accounts each vendor search may run on.
 *
 * A route is one provider the person has configured, taken with the first model that provider
 * offers in the catalog. Bedrock is allowed to name its own search model, because its hosted
 * index is served by particular models rather than by whichever model the picker lists first.
 */
export function resolveSearchRoutes(options: {
    readonly providers: AgentProviders;
    readonly models: readonly AgentModel[];
    readonly currentProviderId?: string;
    readonly bedrockSearchModels?: Readonly<Record<string, string>>;
}): SearchRoutes {
    const bedrock: SearchRoute[] = [];
    const claude: SearchRoute[] = [];
    const codex: SearchRoute[] = [];
    const grok: SearchRoute[] = [];
    for (const providerId of options.providers.ids) {
        const type = options.providers.typeOf(providerId);
        if (type === null) continue;
        const served = options.models.filter((model) => model.providerId === providerId);
        const requestedModel =
            type === "bedrock" ? options.bedrockSearchModels?.[providerId] : undefined;
        const model =
            requestedModel === undefined
                ? served[0]
                : (served.find((candidate) => candidate.id === requestedModel) ?? served[0]);
        if (model === undefined) continue;
        const route: SearchRoute = {
            providerId,
            model: requestedModel ?? model.id,
            effort: model.defaultEffort,
        };
        if (type === "bedrock") bedrock.push(route);
        if (type === "claude") claude.push(route);
        if (type === "codex") codex.push(route);
        if (type === "grok") grok.push(route);
    }
    return {
        bedrock,
        claude,
        codex,
        grok,
        ...(options.currentProviderId === undefined
            ? {}
            : { currentProviderId: options.currentProviderId }),
    };
}

/**
 * Which account a vendor search runs on.
 *
 * A person can have several accounts with one vendor, and only the account this chat already runs
 * on is known to be signed in and paid for. So that account is the default, and naming another one
 * is something the model does only when it was asked to.
 */
export function selectSearchRoute(
    vendor: string,
    routes: readonly SearchRoute[],
    currentProviderId: string | undefined,
    requestedProviderId: string | undefined,
): SearchRoute {
    if (routes.length === 0) {
        throw new Error(`No ${vendor} account is configured, so ${vendor} search is unavailable.`);
    }
    const available = routes.map((route) => route.providerId).join(", ");
    const defaultRoute =
        currentProviderId === undefined
            ? undefined
            : routes.find((route) => route.providerId === currentProviderId);
    if (requestedProviderId === undefined) {
        const fallback = defaultRoute ?? (routes.length === 1 ? routes[0] : undefined);
        if (fallback === undefined) {
            throw new Error(
                `${vendor} search needs an account. Available provider IDs: ${available}.`,
            );
        }
        return fallback;
    }
    const requested = routes.find((route) => route.providerId === requestedProviderId);
    if (requested === undefined) {
        throw new Error(
            `Unknown ${vendor} account "${requestedProviderId}". Available provider IDs: ${available}.`,
        );
    }
    return requested;
}
