import { createRootContext, type Context } from "@steve.kite/stdlib";
import { describe, expect, it, vi } from "vitest";

import {
    handleMcpElicitation,
    type McpElicitationRequest,
    type McpUserInputRequest,
    type McpUserInputResponse,
} from "../../sources/mcp/index.js";

const ctx = createRootContext().named("mcp-elicitation-corner-case-test");

function request(
    properties: Record<string, Record<string, unknown>>,
    required?: string[],
): McpElicitationRequest {
    return {
        method: "elicitation/create",
        params: {
            message: "Please configure the server.",
            requestedSchema: {
                type: "object",
                properties,
                ...(required === undefined ? {} : { required }),
            },
        },
    } as McpElicitationRequest;
}

function oneArgInput(response: McpUserInputResponse): {
    request: (input: McpUserInputRequest) => Promise<McpUserInputResponse>;
} {
    return {
        request: async (input) => {
            expect(input.requestId).toMatch(/^mcp:/u);
            return response;
        },
    };
}

describe("MCP elicitation host adapter", () => {
    it("declines malformed requests and malformed callback responses safely", async () => {
        const callback = vi.fn();
        await expect(
            handleMcpElicitation(
                { nope: true } as never,
                {
                    request: callback,
                } as never,
            ),
        ).resolves.toEqual({ action: "decline" });
        expect(callback).not.toHaveBeenCalled();

        await expect(
            handleMcpElicitation(
                ctx,
                request({ environment: { type: "string" } }),
                oneArgInput({
                    status: "answered",
                    answers: { environment: ["staging"] },
                    extra: true,
                } as never),
            ),
        ).resolves.toEqual({ action: "decline" });
    });

    it("supports one-argument and context-aware two-argument services while preserving this", async () => {
        const oneArgService = {
            prefix: "one",
            async request(input: McpUserInputRequest): Promise<McpUserInputResponse> {
                expect(this.prefix).toBe("one");
                expect(input.questions[0]?.id).toBe("environment");
                return { status: "answered", answers: { environment: ["staging"] } };
            },
        };
        await expect(
            handleMcpElicitation(request({ environment: { type: "string" } }), oneArgService),
        ).resolves.toEqual({
            action: "accept",
            content: { environment: "staging" },
        });

        const twoArgService = {
            prefix: "two",
            async request(
                receivedContext: Context,
                input: McpUserInputRequest,
            ): Promise<McpUserInputResponse> {
                expect(this.prefix).toBe("two");
                expect(receivedContext).toBe(ctx);
                expect(input.questions[0]?.id).toBe("environment");
                return { status: "answered", answers: { environment: ["production"] } };
            },
        };
        await expect(
            handleMcpElicitation(ctx, request({ environment: { type: "string" } }), twoArgService),
        ).resolves.toEqual({
            action: "accept",
            content: { environment: "production" },
        });
    });

    it("uses an explicit confirmation question when the requested object has no properties", async () => {
        const requestInput = vi.fn(async (input: McpUserInputRequest) => {
            expect(input.questions).toEqual([
                expect.objectContaining({
                    id: "confirmation",
                    options: [
                        expect.objectContaining({ label: "Continue" }),
                        expect.objectContaining({ label: "Decline" }),
                    ],
                }),
            ]);
            return {
                status: "answered" as const,
                answers: { confirmation: ["Continue"] },
            };
        });
        await expect(
            handleMcpElicitation(request({}, []), { request: requestInput }),
        ).resolves.toEqual({ action: "accept", content: {} });

        await expect(
            handleMcpElicitation(
                request({}, []),
                oneArgInput({ status: "answered", answers: { confirmation: ["Decline"] } }),
            ),
        ).resolves.toEqual({ action: "decline" });
    });

    it("converts optional and required scalar values and declines missing required values", async () => {
        const input = request(
            {
                environment: { type: "string", description: "Where to deploy." },
                replicas: { type: "number" },
                enabled: { type: "boolean" },
                optional: { type: "string" },
            },
            ["environment", "replicas", "enabled"],
        );
        const response = {
            status: "answered" as const,
            answers: {
                environment: ["staging"],
                replicas: ["3.5"],
                enabled: ["true"],
            },
        };
        await expect(handleMcpElicitation(ctx, input, oneArgInput(response))).resolves.toEqual({
            action: "accept",
            content: {
                environment: "staging",
                replicas: 3.5,
                enabled: true,
            },
        });
        await expect(
            handleMcpElicitation(
                input,
                oneArgInput({
                    status: "answered",
                    answers: { environment: ["staging"], replicas: ["3.5"] },
                }),
            ),
        ).resolves.toEqual({ action: "decline" });
    });

    it("maps enum labels, oneOf titles, and array anyOf titles into their underlying values", async () => {
        const input = request({
            environment: {
                type: "string",
                oneOf: [
                    { const: "staging", title: "Staging" },
                    { const: "production", title: "Production" },
                ],
            },
            regions: {
                type: "array",
                items: {
                    anyOf: [
                        { const: "us-east", title: "US East" },
                        { const: "eu-west", title: "EU West" },
                    ],
                },
            },
        });
        const callback = vi.fn(async (inputRequest: McpUserInputRequest) => {
            expect(inputRequest.questions[0]).toMatchObject({
                id: "environment",
                options: [{ label: "Staging" }, { label: "Production" }],
            });
            expect(inputRequest.questions[1]).toMatchObject({
                id: "regions",
                multiSelect: true,
                options: [{ label: "US East" }, { label: "EU West" }],
            });
            return {
                status: "answered" as const,
                answers: {
                    environment: ["Production"],
                    regions: ["US East", "EU West"],
                },
            };
        });
        await expect(handleMcpElicitation(ctx, input, { request: callback })).resolves.toEqual({
            action: "accept",
            content: { environment: "production", regions: ["us-east", "eu-west"] },
        });
    });

    it("preserves numeric enum values selected in multi-select arrays", async () => {
        await expect(
            handleMcpElicitation(
                request({
                    ports: {
                        type: "array",
                        items: { enum: [80, 443] },
                    },
                }),
                oneArgInput({
                    status: "answered",
                    answers: { ports: ["80", "443"] },
                }),
            ),
        ).resolves.toEqual({
            action: "accept",
            content: { ports: [80, 443] },
        });
    });

    it("does not accept answers outside a declared enum", async () => {
        await expect(
            handleMcpElicitation(
                request({ environment: { type: "string", enum: ["staging", "production"] } }),
                oneArgInput({
                    status: "answered",
                    answers: { environment: ["delete everything"] },
                }),
            ),
        ).resolves.toEqual({ action: "decline" });
    });

    it("rejects non-integral values for integer properties", async () => {
        await expect(
            handleMcpElicitation(
                request({ replicas: { type: "integer" } }),
                oneArgInput({ status: "answered", answers: { replicas: ["1.5"] } }),
            ),
        ).resolves.toEqual({ action: "decline" });
    });

    it("declines invalid booleans and non-finite numbers", async () => {
        await expect(
            handleMcpElicitation(
                request({ enabled: { type: "boolean" } }),
                oneArgInput({ status: "answered", answers: { enabled: ["maybe"] } }),
            ),
        ).resolves.toEqual({ action: "decline" });
        await expect(
            handleMcpElicitation(
                request({ replicas: { type: "number" } }),
                oneArgInput({ status: "answered", answers: { replicas: ["Infinity"] } }),
            ),
        ).resolves.toEqual({ action: "decline" });
        await expect(
            handleMcpElicitation(
                request({ replicas: { type: "number" } }),
                oneArgInput({ status: "answered", answers: { replicas: ["NaN"] } }),
            ),
        ).resolves.toEqual({ action: "decline" });
    });

    it("truncates long headers and falls back when a title is empty", async () => {
        const callback = vi.fn(async (input: McpUserInputRequest) => {
            expect(input.questions[0]).toMatchObject({
                id: "long",
                header: "A very long…",
            });
            expect(input.questions[1]).toMatchObject({
                id: "empty",
                header: "MCP request",
            });
            return { status: "cancelled" as const };
        });
        await expect(
            handleMcpElicitation(
                request({
                    long: { type: "string", title: "A very long title" },
                    empty: { type: "string", title: "   " },
                }),
                { request: callback },
            ),
        ).resolves.toEqual({ action: "decline" });
    });
});
