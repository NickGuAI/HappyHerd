import { describe, expect, it } from "vitest";

import { parseDockerNetworkPolicyOutput } from "../../../sources/docker/impl/loadDockerProjectManagedNetworkPolicy.js";

describe("parseDockerNetworkPolicyOutput", () => {
    it("maps caller-declared files without assuming their names or format", () => {
        const parsed = parseDockerNetworkPolicyOutput(Buffer.from("NF\0allow = true\n\0A\0\0"), [
            "access.conf",
            "secondary.policy",
        ]);

        expect(parsed).toEqual({
            absent: ["secondary.policy"],
            files: [{ name: "access.conf", text: "allow = true\n" }],
            placeholderCreated: false,
            ready: ["access.conf"],
        });
    });

    it("records an atomically prepared placeholder", () => {
        const parsed = parseDockerNetworkPolicyOutput(Buffer.from("PF\0\0A\0\0"), [
            "access.conf",
            "secondary.policy",
        ]);

        expect(parsed).toEqual({
            absent: ["secondary.policy"],
            files: [{ name: "access.conf", text: "" }],
            placeholderCreated: true,
            ready: ["access.conf"],
        });
    });

    it("rejects unknown or incomplete output", () => {
        expect(() =>
            parseDockerNetworkPolicyOutput(Buffer.from("XF\0text\0"), ["access.conf"]),
        ).toThrow("Could not identify the Docker project's network policy.");
        expect(() => parseDockerNetworkPolicyOutput(Buffer.from("NF\0"), ["access.conf"])).toThrow(
            "incomplete network-policy file data",
        );
    });
});
