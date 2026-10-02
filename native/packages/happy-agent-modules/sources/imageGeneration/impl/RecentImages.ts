import { MAX_EDIT_IMAGES } from "../ImageGeneration.js";

/** One encoded image is never worth keeping past what a single request could carry anyway. */
const MAX_REMEMBERED_IMAGE_CHARACTERS = 16 * 1024 * 1024;

/** How many agents are remembered at once, so a long-lived process cannot accumulate them all. */
const MAX_TRACKED_AGENTS = 64;

/**
 * The last few images an agent was shown.
 *
 * An edit often targets an image nobody saved to disk — one a person attached, or one this module
 * generated a moment ago — so those images are kept here for exactly as long as an edit could
 * plausibly refer to them. Only the newest few per agent are held, and only in memory: this is a
 * convenience for the turn in progress, not a record of the conversation.
 */
export class RecentImages {
    readonly #byAgent = new Map<string, string[]>();

    /** Remember one image as a data URL, evicting whatever it pushes past the bound. */
    record(agentId: string, mediaType: string, base64: string): void {
        const dataUrl = `data:${mediaType};base64,${base64}`;
        if (dataUrl.length > MAX_REMEMBERED_IMAGE_CHARACTERS) return;
        const images = this.#byAgent.get(agentId) ?? [];
        images.push(dataUrl);
        while (images.length > MAX_EDIT_IMAGES) images.shift();
        // Re-insert so the map's own order is least-recently-used first.
        this.#byAgent.delete(agentId);
        this.#byAgent.set(agentId, images);
        while (this.#byAgent.size > MAX_TRACKED_AGENTS) {
            const oldest = this.#byAgent.keys().next();
            if (oldest.done === true) break;
            this.#byAgent.delete(oldest.value);
        }
    }

    /**
     * The last `requested` images, oldest first. Asking for more than were seen is an error rather
     * than a silently smaller edit, because the model chose that number to cover a specific image.
     */
    take(agentId: string, requested: number): string[] {
        const images = this.#byAgent.get(agentId) ?? [];
        if (images.length < requested) {
            throw new Error(
                `Requested the last ${String(requested)} conversation images, but only ${String(images.length)} were available.`,
            );
        }
        return images.slice(images.length - requested);
    }
}
