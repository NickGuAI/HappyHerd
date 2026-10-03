import type { AgentProviders } from "@slopus/happy-agent-base";

import type { SearchRoutes } from "./SearchRoute.js";

/** What every vendor search needs: the configured accounts and a way to reach them. */
export interface VendorSearchContext {
    readonly providers: AgentProviders;
    readonly routes: SearchRoutes;
    /** Gemini answers over its own HTTP API rather than through a configured chat provider. */
    readonly geminiApiKey?: string;
}
