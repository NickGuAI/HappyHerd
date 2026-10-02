import { describe, expect, it } from "vitest";

import { endpointUrl } from "../sources/endpointUrl.js";

describe("endpointUrl", () => {
    it("resolves a route beneath the endpoint's own path", () => {
        expect(endpointUrl("http://agent.local/machines/one", "v0/health")).toBe(
            "http://agent.local/machines/one/v0/health",
        );
    });

    it("keeps the endpoint's query alongside the request's", () => {
        expect(endpointUrl("http://agent.local/?peer=abc", "v0/agents", { limit: 10 })).toBe(
            "http://agent.local/v0/agents?limit=10&peer=abc",
        );
    });

    it("writes booleans and numbers, and omits what was not named", () => {
        expect(
            endpointUrl("http://agent.local", "v0/workspaces", {
                includeArchived: true,
                projectId: undefined,
            }),
        ).toBe("http://agent.local/v0/workspaces?includeArchived=true");
    });

    it("escapes a path that was given with a leading slash", () => {
        expect(endpointUrl("http://agent.local/", "/v0/events")).toBe(
            "http://agent.local/v0/events",
        );
    });
});
