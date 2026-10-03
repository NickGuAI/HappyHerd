import type { MessageDeltaPayload } from "./protocol/events.js";
import type { Message } from "./protocol/messages.js";

/** The result of applying one offset-addressed text delta to a message snapshot. */
export type MessageDeltaApplication =
    | { append: string; kind: "applied"; message: Message }
    | { append: ""; kind: "replayed"; message: Message }
    | { kind: "reconcile" };

/**
 * Applies one message delta without duplicating replayed text.
 *
 * A gap, conflicting overlap, missing message, or non-textual target cannot be
 * repaired locally and returns `reconcile` so the caller can replace the
 * message from authoritative history or a later full `message.updated` event.
 */
export function applyMessageDelta(
    message: Message | undefined,
    delta: MessageDeltaPayload,
): MessageDeltaApplication {
    if (
        message === undefined ||
        message.id !== delta.messageId ||
        !Number.isInteger(delta.blockIndex) ||
        delta.blockIndex < 0 ||
        !Number.isInteger(delta.offset) ||
        delta.offset < 0
    ) {
        return { kind: "reconcile" };
    }

    const block = message.content[delta.blockIndex];
    if (block?.type !== "text" && block?.type !== "reasoning") {
        return { kind: "reconcile" };
    }

    const currentLength = block.text.length;
    if (currentLength < delta.offset) return { kind: "reconcile" };

    let append: string;
    if (currentLength === delta.offset) {
        append = delta.append;
    } else {
        const overlapLength = currentLength - delta.offset;
        if (overlapLength >= delta.append.length) {
            return block.text.slice(delta.offset, delta.offset + delta.append.length) ===
                delta.append
                ? { append: "", kind: "replayed", message }
                : { kind: "reconcile" };
        }

        const overlap = block.text.slice(delta.offset);
        if (!delta.append.startsWith(overlap)) return { kind: "reconcile" };
        append = delta.append.slice(overlapLength);
    }

    const content = [...message.content];
    content[delta.blockIndex] = { ...block, text: block.text + append };
    return { append, kind: "applied", message: { ...message, content } };
}
