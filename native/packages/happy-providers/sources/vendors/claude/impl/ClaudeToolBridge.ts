import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { SessionToolResultMessage } from "@/core/SessionContext.js";

type ToolResolver = (result: CallToolResult) => void;

const CLOSED_TOOL_RESULT: CallToolResult = {
    content: [{ type: "text", text: "Claude session closed before the tool completed." }],
    isError: true,
};

/**
 * Pairs the Claude CLI's MCP tool invocations with the tool_use blocks streamed in the response
 * and with the caller's eventual results. Every party addresses a call by the same tool_use block
 * ID: the stream registers it, the CLI stamps it on the MCP call, and the caller's result carries
 * it as callId. The MCP call may race ahead of the content_block_start event, so an execution for
 * a not-yet-registered ID simply opens the call itself.
 */
export class ClaudeToolBridge {
    private readonly answers = new Map<string, CallToolResult>();
    private readonly openCallIds = new Set<string>();
    private readonly resolvers = new Map<string, ToolResolver[]>();
    private closed = false;

    register(callId: string): void {
        if (this.closed) return;
        this.openCallIds.add(callId);
    }

    execute(toolUseId: string): Promise<CallToolResult> {
        if (this.closed) return Promise.resolve(CLOSED_TOOL_RESULT);
        this.openCallIds.add(toolUseId);
        const answer = this.answers.get(toolUseId);
        if (answer !== undefined) {
            this.answers.delete(toolUseId);
            this.openCallIds.delete(toolUseId);
            return Promise.resolve(answer);
        }
        return new Promise((resolve) => {
            const resolvers = this.resolvers.get(toolUseId) ?? [];
            resolvers.push(resolve);
            this.resolvers.set(toolUseId, resolvers);
        });
    }

    resolve(message: SessionToolResultMessage): boolean {
        if (!this.openCallIds.has(message.callId) || this.answers.has(message.callId)) return false;
        const answer = toCallToolResult(message);
        const resolvers = this.resolvers.get(message.callId);
        if (resolvers === undefined) {
            this.answers.set(message.callId, answer);
            return true;
        }
        this.resolvers.delete(message.callId);
        this.openCallIds.delete(message.callId);
        for (const resolver of resolvers) resolver(answer);
        return true;
    }

    resolveAll(messages: readonly SessionToolResultMessage[]): boolean {
        let resolved = 0;
        for (const message of messages) {
            if (this.resolve(message)) resolved += 1;
        }
        return messages.length > 0 && resolved === messages.length;
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const resolvers of this.resolvers.values()) {
            for (const resolver of resolvers) resolver(CLOSED_TOOL_RESULT);
        }
        this.answers.clear();
        this.openCallIds.clear();
        this.resolvers.clear();
    }
}

function toCallToolResult(message: SessionToolResultMessage): CallToolResult {
    return {
        content: message.content.map((block) =>
            block.type === "text"
                ? { type: "text" as const, text: block.text }
                : {
                      type: "image" as const,
                      data: block.data,
                      mimeType: block.mimeType,
                  },
        ),
        ...(message.isError === undefined ? {} : { isError: message.isError }),
    };
}
