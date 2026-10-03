import type { ResponseInputItem } from "openai/resources/responses/responses.js";

import { responseInputItems } from "@/protocol/responses/responseInputItems.js";
import type { ResponsesLiteRequest } from "@/protocol/responsesLite/ResponsesLiteRequest.js";

export function createResponsesLiteRequest(
    request: ResponsesLiteRequest,
    instructions: string,
): ResponsesLiteRequest {
    const lite = structuredClone(request);
    lite.parallel_tool_calls = false;
    if (lite.reasoning !== undefined) {
        lite.reasoning = { ...lite.reasoning, context: "all_turns" };
    }
    delete lite.instructions;
    delete lite.tools;
    lite.input = [
        {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: instructions }],
        },
        ...responseInputItems(lite.input),
    ];
    return lite;
}

export function createResponsesLiteWarmupRequest(
    request: ResponsesLiteRequest,
    tools: readonly unknown[],
): ResponsesLiteRequest {
    const warmup = structuredClone(request);
    warmup.generate = false;
    const instructions = responseInputItems(warmup.input).filter(
        (item) =>
            typeof item === "object" &&
            item !== null &&
            (item as { role?: unknown }).role === "developer",
    );
    const input: ResponseInputItem[] = [
        {
            type: "additional_tools",
            role: "developer",
            tools: [...tools] as never,
        },
        ...instructions.slice(0, 1),
    ];
    warmup.input = input;
    return warmup;
}

export function createResponsesLiteSseRequest(
    request: ResponsesLiteRequest,
    tools: readonly unknown[],
): ResponsesLiteRequest {
    const sse = structuredClone(request);
    sse.input = [
        {
            type: "additional_tools",
            role: "developer",
            tools: [...tools] as never,
        },
        ...responseInputItems(sse.input),
    ];
    return sse;
}

export function createResponsesLiteWebSocketInferenceRequest(
    request: ResponsesLiteRequest,
): ResponsesLiteRequest {
    const inference = structuredClone(request);
    const input = responseInputItems(inference.input);
    const instructionIndex = input.findIndex(
        (item) =>
            typeof item === "object" &&
            item !== null &&
            (item as { role?: unknown }).role === "developer",
    );
    if (instructionIndex >= 0) input.splice(instructionIndex, 1);
    inference.input = input;
    return inference;
}
