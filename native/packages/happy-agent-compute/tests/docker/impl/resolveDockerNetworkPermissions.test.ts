import { describe, expect, it } from "vitest";

import { computePermissions } from "../../../sources/ComputePermissions.js";
import { resolveDockerNetworkPermissions } from "../../../sources/docker/impl/resolveDockerNetworkPermissions.js";

describe("resolveDockerNetworkPermissions", () => {
    it("keeps unrestricted egress direct when local binding is withheld", () => {
        const resolved = resolveDockerNetworkPermissions(
            computePermissions("workspace_write", {
                network: { egress: true, localBinding: false },
            }),
        );

        expect(resolved).toEqual({
            directEgress: true,
            managedPolicy: undefined,
        });
    });

    it("does not add a proxy merely to withhold local binding", () => {
        const resolved = resolveDockerNetworkPermissions(
            computePermissions("auto", {
                network: { egress: true, localBinding: false },
            }),
        );

        expect(resolved).toEqual({ directEgress: true, managedPolicy: undefined });
    });

    it("uses direct networking for unrestricted egress", () => {
        expect(
            resolveDockerNetworkPermissions(
                computePermissions("workspace_write", {
                    network: { egress: true, localBinding: true },
                }),
            ),
        ).toEqual({ directEgress: true, managedPolicy: undefined });
    });

    it("keeps an explicit empty project allow-list deny-all", () => {
        expect(
            resolveDockerNetworkPermissions(
                computePermissions("workspace_write", {
                    network: { egress: true, localBinding: true },
                }),
                {},
            ),
        ).toEqual({
            directEgress: false,
            managedPolicy: { allowedDomains: [] },
        });
    });

    it("does not let a local-binding-only project policy silently open egress", () => {
        expect(
            resolveDockerNetworkPermissions(
                computePermissions("workspace_write", {
                    network: { egress: true, localBinding: true },
                }),
                { allowLocalBinding: false },
            ),
        ).toEqual({
            directEgress: false,
            managedPolicy: { allowedDomains: [] },
        });
    });

    it("maps an allowed-host list into an exhaustive managed policy", () => {
        expect(
            resolveDockerNetworkPermissions(
                computePermissions("auto", {
                    network: {
                        allowedHosts: ["registry.npmjs.org", "*.githubusercontent.com"],
                        egress: true,
                        localBinding: true,
                    },
                }),
            ),
        ).toEqual({
            directEgress: false,
            managedPolicy: {
                allowedDomains: [
                    { domain: "registry.npmjs.org" },
                    { domain: "*.githubusercontent.com" },
                ],
            },
        });
    });

    it("rejects a bare wildcard instead of silently changing open egress semantics", () => {
        expect(() =>
            resolveDockerNetworkPermissions(
                computePermissions("auto", {
                    network: {
                        allowedHosts: ["*"],
                        egress: true,
                        localBinding: false,
                    },
                }),
            ),
        ).toThrow("bare '*'");
    });

    it("rejects a bare wildcard even when egress is disabled", () => {
        expect(() =>
            resolveDockerNetworkPermissions(
                computePermissions("read_only", {
                    network: {
                        allowedHosts: ["*"],
                        egress: false,
                        localBinding: false,
                    },
                }),
            ),
        ).toThrow("bare '*'");
    });

    it("intersects operation hosts with the project network boundary", () => {
        expect(
            resolveDockerNetworkPermissions(
                computePermissions("workspace_write", {
                    network: {
                        allowedHosts: ["api.example.com", "blocked.example.com"],
                        egress: true,
                        localBinding: false,
                    },
                }),
                {
                    allowedDomains: [{ domain: "*.example.com", ports: [443] }],
                    deniedDomains: [{ domain: "blocked.example.com" }],
                },
            ),
        ).toEqual({
            directEgress: false,
            managedPolicy: {
                allowedDomains: [
                    { domain: "api.example.com", ports: [443] },
                    { domain: "blocked.example.com", ports: [443] },
                ],
                deniedDomains: [{ domain: "blocked.example.com" }],
            },
        });
    });
});
