import type {
    SessionAgentMessage,
    SessionInputBlock,
    SessionSystemMessage,
} from "@/core/SessionContext.js";

/**
 * Projects a message from one agent onto the system role.
 *
 * No provider has an agent role that means what we mean by it, so the message reaches every model
 * the same way: a notification that names who sent it, followed by what they said. Saying who is
 * the point — without it the receiving model has no way to tell another agent's words from the
 * user's, and would read them as instructions the person gave.
 *
 * Reasoning the sender exposed is folded in as text. Reasoning that is only an opaque signed
 * payload is dropped: it belongs to the model that produced it and means nothing here.
 */
export function toSessionAgentNotificationMessage(
    message: SessionAgentMessage,
): SessionSystemMessage {
    const { description, id } = message.author;
    const heading = description.length === 0 ? id : `${description} (${id})`;
    const content: SessionInputBlock[] = [{ type: "text", text: `Message from agent ${heading}:` }];
    for (const block of message.content) {
        if (block.type === "image") {
            content.push(block);
            continue;
        }
        const { text } = block;
        if (text === undefined || text.length === 0) continue;
        content.push({ type: "text", text });
    }
    return { role: "system", content };
}
