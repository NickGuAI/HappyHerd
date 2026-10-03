import { describe, expect, it } from "vitest";

import { ClaudeToolBridge } from "@/vendors/claude/impl/ClaudeToolBridge.js";

describe("ClaudeToolBridge", () => {
    it("joins resolvers and answers arriving in either order", async () => {
        const bridge = new ClaudeToolBridge();
        bridge.register("first-bash");
        bridge.register("second-bash");
        const firstResult = bridge.execute("first-bash");

        expect(
            bridge.resolveAll([
                {
                    role: "tool",
                    content: [{ type: "text" as const, text: "first complete" }],
                    callId: "first-bash",
                },
                {
                    role: "tool",
                    content: [{ type: "text" as const, text: "second complete" }],
                    callId: "second-bash",
                },
            ]),
        ).toBe(true);
        const secondResult = bridge.execute("second-bash");

        await expect(firstResult).resolves.toMatchObject({
            content: [{ type: "text", text: "first complete" }],
        });
        await expect(secondResult).resolves.toMatchObject({
            content: [{ type: "text", text: "second complete" }],
        });
    });

    it("requires the complete batch and preserves the first answer for a call", async () => {
        const bridge = new ClaudeToolBridge();
        bridge.register("first");
        bridge.register("second");

        expect(
            bridge.resolveAll([
                {
                    role: "tool",
                    content: [{ type: "text" as const, text: "first answer" }],
                    callId: "first",
                },
                {
                    role: "tool",
                    content: [{ type: "text" as const, text: "unknown answer" }],
                    callId: "unknown",
                },
            ]),
        ).toBe(false);
        expect(
            bridge.resolve({
                role: "tool",
                content: [{ type: "text" as const, text: "replacement answer" }],
                callId: "first",
            }),
        ).toBe(false);

        await expect(bridge.execute("first")).resolves.toMatchObject({
            content: [{ type: "text", text: "first answer" }],
        });
        const second = bridge.execute("second");
        expect(
            bridge.resolve({
                role: "tool",
                content: [{ type: "text" as const, text: "second answer" }],
                callId: "second",
            }),
        ).toBe(true);
        await expect(second).resolves.toMatchObject({
            content: [{ type: "text", text: "second answer" }],
        });
    });

    it("pairs parallel calls executed out of stream order by their IDs", async () => {
        const bridge = new ClaudeToolBridge();
        bridge.register("first-bash");
        bridge.register("second-bash");

        const second = bridge.execute("second-bash");
        const first = bridge.execute("first-bash");
        expect(
            bridge.resolveAll([
                {
                    role: "tool",
                    content: [{ type: "text" as const, text: "first output" }],
                    callId: "first-bash",
                },
                {
                    role: "tool",
                    content: [{ type: "text" as const, text: "second output" }],
                    callId: "second-bash",
                },
            ]),
        ).toBe(true);

        await expect(first).resolves.toMatchObject({
            content: [{ type: "text", text: "first output" }],
        });
        await expect(second).resolves.toMatchObject({
            content: [{ type: "text", text: "second output" }],
        });
    });

    it("accepts an execution that arrives before the stream registers its call", async () => {
        const bridge = new ClaudeToolBridge();
        const result = bridge.execute("early-bash");
        bridge.register("early-bash");

        expect(
            bridge.resolve({
                role: "tool",
                content: [{ type: "text" as const, text: "early output" }],
                callId: "early-bash",
            }),
        ).toBe(true);
        await expect(result).resolves.toMatchObject({
            content: [{ type: "text", text: "early output" }],
        });
    });

    it("fails outstanding executions when the session closes", async () => {
        const bridge = new ClaudeToolBridge();
        bridge.register("abandoned");
        const result = bridge.execute("abandoned");

        bridge.close();

        await expect(result).resolves.toMatchObject({ isError: true });
    });

    it("fails executions that arrive after the session closes", async () => {
        const bridge = new ClaudeToolBridge();
        bridge.close();

        await expect(bridge.execute("late")).resolves.toMatchObject({ isError: true });
    });

    it("answers duplicate executions for one tool call without stranding either request", async () => {
        const bridge = new ClaudeToolBridge();
        const first = bridge.execute("repeated");
        const second = bridge.execute("repeated");

        expect(
            bridge.resolve({
                role: "tool",
                content: [{ type: "text" as const, text: "shared answer" }],
                callId: "repeated",
            }),
        ).toBe(true);
        await expect(first).resolves.toMatchObject({
            content: [{ type: "text", text: "shared answer" }],
        });
        await expect(second).resolves.toMatchObject({
            content: [{ type: "text", text: "shared answer" }],
        });
    });
});
