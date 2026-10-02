import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";

import { readCodexTurnState } from "@/vendors/codex/impl/readCodexTurnState.js";
import { readCodexTurnStateHeader } from "@/vendors/codex/impl/readCodexTurnStateHeader.js";

/**
 * The sticky turn token Codex hands back once and expects on every later request.
 *
 * It arrives from whichever transport happens to speak first — a response header over SSE, a
 * stream event over WebSocket — so the session owns it and lends it to both. Only the first
 * value counts; later ones are the same token repeated.
 */
export class CodexTurnState {
    private token: string | undefined;

    get value(): string | undefined {
        return this.token;
    }

    observe(event: ResponseStreamEvent): void {
        this.token ??= readCodexTurnState(event);
    }

    observeHeaders(headers: Headers): void {
        this.token ??= readCodexTurnStateHeader(headers);
    }

    clear(): void {
        this.token = undefined;
    }
}
