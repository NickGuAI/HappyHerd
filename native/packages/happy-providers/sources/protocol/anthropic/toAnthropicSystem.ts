import type { BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { SessionContext } from "@/core/SessionContext.js";

// Session system messages stay in the conversation as positional reminders. Only the caller's
// instructions belong here, so a mid-conversation notice cannot rewrite the cached prefix.
export function toAnthropicSystem(options: { context: SessionContext }): BetaTextBlockParam[] {
    const text = options.context.instructions;
    if (text.length === 0) return [];
    return [
        {
            type: "text",
            text,
            cache_control: { type: "ephemeral" },
        },
    ];
}
