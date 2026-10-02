import type { BetaCompactionBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import type { SessionCompactionMessage } from "@/core/SessionContext.js";

export function toAnthropicCompactionBlock(
    message: SessionCompactionMessage,
): BetaCompactionBlockParam {
    return {
        type: "compaction",
        content: message.content,
        encrypted_content: message.encryptedContent,
        cache_control: { type: "ephemeral" },
    };
}
