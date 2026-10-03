import type TurndownService from "turndown";

let servicePromise: Promise<TurndownService> | undefined;

/** One shared HTML-to-markdown converter, loaded the first time a page needs it. */
export function getTurndownService(): Promise<TurndownService> {
    servicePromise ??= import("turndown").then(({ default: Turndown }) => new Turndown());
    return servicePromise;
}
