import { describe, expect, it } from "vitest";

import { createShellEnvironment } from "../../../sources/sandbox/impl/createShellEnvironment.js";

describe("createShellEnvironment", () => {
    it("removes only the private path variables declared by the embedder", () => {
        const environment = createShellEnvironment(
            {
                AGENT_PRIVATE_DIRECTORY: "/secret/agent-state",
                AWS_ACCESS_KEY_ID: "aws-key",
                HOME: "/safe/home",
                PATH: "/safe/bin",
                PROJECT_PRIVATE_KEY: "private-key-secret",
            },
            { privatePathVariables: ["AGENT_PRIVATE_DIRECTORY"] },
        );

        expect(environment).toMatchObject({
            AWS_ACCESS_KEY_ID: "aws-key",
            HOME: "/safe/home",
            PATH: "/safe/bin",
            PROJECT_PRIVATE_KEY: "private-key-secret",
        });
        expect(environment).not.toHaveProperty("AGENT_PRIVATE_DIRECTORY");
    });
});
