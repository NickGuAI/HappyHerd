/**
 * Which chat rows play the rise-in entrance (UI overhaul).
 *
 * A virtualized, inverted list mounts rows whenever they scroll into view and
 * remounts them after recycling, so "animate on mount" would replay the motion
 * on every scroll. A row therefore rises in at most once per list instance and
 * only when it is new to the reader: rows of the first paint, messages that
 * arrived after the list opened (newer than everything present at open), and
 * members revealed by expanding a "Worked …" group.
 */

/** First paint window: rows mounted this soon after the list opened rise in. */
export const ENTRANCE_INITIAL_WINDOW_MS = 700;

export type EntranceTracker = {
    /** Record the message ids present when the list first had content. */
    captureBaseline: (newestFirstIds: ReadonlyArray<string>) => void;
    /** Ids newer than the baseline, given the current newest-first ids. */
    liveIds: (newestFirstIds: ReadonlyArray<string>) => ReadonlySet<string>;
    shouldAnimate: (id: string, live: ReadonlySet<string>, now?: number) => boolean;
    markShown: (id: string) => void;
    reveal: (ids: ReadonlyArray<string>) => void;
};

export function createEntranceTracker(openedAt: number = Date.now()): EntranceTracker {
    let baseline: ReadonlySet<string> | null = null;
    const shown = new Set<string>();
    const revealed = new Set<string>();

    return {
        captureBaseline(ids) {
            if (baseline === null && ids.length > 0) baseline = new Set(ids);
        },
        liveIds(ids) {
            const live = new Set<string>();
            if (baseline === null) return live;
            for (const id of ids) {
                // Messages are newest-first: everything before the first known
                // message arrived after the list opened. Older history pages
                // append at the other end and are never live.
                if (baseline.has(id)) break;
                live.add(id);
            }
            return live;
        },
        shouldAnimate(id, live, now = Date.now()) {
            if (shown.has(id)) return false;
            if (revealed.has(id)) return true;
            if (now - openedAt <= ENTRANCE_INITIAL_WINDOW_MS) return true;
            return live.has(id);
        },
        markShown(id) {
            shown.add(id);
            revealed.delete(id);
        },
        reveal(ids) {
            for (const id of ids) {
                shown.delete(id);
                revealed.add(id);
            }
        },
    };
}
