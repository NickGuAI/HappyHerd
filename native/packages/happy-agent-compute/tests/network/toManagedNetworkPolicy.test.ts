import { describe, expect, it } from "vitest";

import { toManagedNetworkPolicy } from "../../sources/network/loadProjectManagedNetworkPolicy.js";

describe("toManagedNetworkPolicy", () => {
    it("returns no policy when there is no network configuration", () => {
        expect(toManagedNetworkPolicy(undefined)).toBeUndefined();
    });

    it("expands allowed domains across the configured ports and keeps denials port-agnostic", () => {
        expect(
            toManagedNetworkPolicy({
                allowLocalBinding: true,
                allowedDomains: ["coderabbit.ai", "*.coderabbit.ai"],
                allowedLoopbackPorts: [443],
                allowedPorts: [443, 8443],
                deniedDomains: ["blocked.example"],
            }),
        ).toEqual({
            allowLocalBinding: true,
            allowedDomains: [
                { domain: "coderabbit.ai", ports: [443, 8443] },
                { domain: "*.coderabbit.ai", ports: [443, 8443] },
            ],
            allowedLoopbackPorts: [443],
            deniedDomains: [{ domain: "blocked.example" }],
        });
    });

    it("defaults the allowed domain ports to 443 when none are configured", () => {
        expect(toManagedNetworkPolicy({ allowedDomains: ["api.example.com"] })).toEqual({
            allowedDomains: [{ domain: "api.example.com", ports: [443] }],
        });
    });
});
