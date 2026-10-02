import type { HistoryPage } from "../HistoryPage.js";
import { formatHistoryMessage, truncate } from "./formatHistoryMessage.js";
import { summarizeHistory, type HistoryStats } from "./summarizeHistory.js";

/** The most history one answer may carry, however many messages were selected. */
export const MAX_HISTORY_CHARACTERS = 80_000;

/** A page rendered for reading, and what of the page actually fitted. */
export interface FormattedHistoryPage {
    /** How many of the page's messages the rendering covers. */
    readonly consumedMessages: number;
    /** The rendered history. */
    readonly history: string;
    /** Where in the page the rendering starts, which is not the beginning when read backwards. */
    readonly startIndex: number;
    /** What the rendered messages amount to. */
    readonly stats: HistoryStats;
}

/**
 * Render a page, bounded by size rather than by message count.
 *
 * A limit of a hundred messages says nothing about how much text that is, so the rendering stops
 * at a fixed number of characters and reports how far it got. A page read from the end fills
 * backwards, so asking for the last page gives the most recent messages rather than the first
 * few of a window that happens to end there.
 */
export function formatHistoryPage(
    page: HistoryPage,
    options: { fromEnd?: boolean; includeTools?: boolean } = {},
): FormattedHistoryPage {
    const formatted = page.messages.map((record) =>
        formatHistoryMessage(record.message, record.position + 1, {
            includeTools: options.includeTools !== false,
        }),
    );
    const selected = selectBounded(formatted, options.fromEnd === true);
    return {
        consumedMessages: selected.messages.length,
        history: selected.messages.join("\n\n"),
        startIndex: selected.startIndex,
        stats: summarizeHistory(
            page.messages
                .slice(selected.startIndex, selected.startIndex + selected.messages.length)
                .map((record) => record.message),
        ),
    };
}

/** Take as many rendered messages as fit, from whichever end the reader is filling from. */
function selectBounded(
    messages: readonly string[],
    fromEnd: boolean,
): { messages: string[]; startIndex: number } {
    const selected: string[] = [];
    let characters = 0;
    const indexes = fromEnd
        ? Array.from({ length: messages.length }, (_, index) => messages.length - index - 1)
        : messages.map((_, index) => index);
    let startIndex = fromEnd ? messages.length : 0;
    for (const index of indexes) {
        const message = messages[index] ?? "";
        const separator = selected.length === 0 ? 0 : 2;
        const remaining = MAX_HISTORY_CHARACTERS - characters - separator;
        if (selected.length > 0 && message.length > remaining) break;
        const bounded = truncate(message, remaining);
        if (fromEnd) selected.unshift(bounded);
        else selected.push(bounded);
        startIndex = fromEnd ? index : 0;
        characters += separator + bounded.length;
        if (characters >= MAX_HISTORY_CHARACTERS) break;
    }
    return { messages: selected, startIndex };
}
