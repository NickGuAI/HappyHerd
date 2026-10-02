import type { SessionMessage } from "@/core/SessionContext.js";
import { codexValuesEqual } from "@/vendors/codex/impl/codexValuesEqual.js";

export function getCodexContextSuffix(
    previous: readonly SessionMessage[],
    current: readonly SessionMessage[],
): SessionMessage[] | undefined {
    if (
        previous.length > current.length ||
        !previous.every((message, index) =>
            codexValuesEqual(toCallerIdentity(message), toCallerIdentity(current[index])),
        )
    ) {
        return undefined;
    }
    return structuredClone(current.slice(previous.length));
}

function toCallerIdentity(message: SessionMessage | undefined): unknown {
    if (message?.role !== "assistant") return message;
    const clone = structuredClone(message);
    return {
        ...clone,
        content: clone.content
            .filter((block) => block.type !== "reasoning")
            .map((block): unknown =>
                block.type !== "tool_call"
                    ? block
                    : {
                          ...block,
                          arguments: isCustomToolCall(block.vendor)
                              ? block.arguments
                              : parseArguments(block.arguments),
                      },
            ),
    };
}

function parseArguments(argumentsJson: string): unknown {
    try {
        return JSON.parse(argumentsJson);
    } catch {
        return argumentsJson;
    }
}

function isCustomToolCall(vendor: unknown): boolean {
    return (
        typeof vendor === "object" &&
        vendor !== null &&
        "provider" in vendor &&
        vendor.provider === "codex" &&
        "type" in vendor &&
        vendor.type === "custom_tool_call"
    );
}
