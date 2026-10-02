import { resolve } from "node:path";

import type { FileFinder } from "@ff-labs/fff-node";

import type { GitModule } from "../git/index.js";

const DEFAULT_MAX_INDEXES = 8;
const RESCAN_AFTER_MS = 2_000;
const SEARCH_READY_BUDGET_MS = 100;

interface FinderState {
    readonly finder: FileFinder;
    lastScanAt: number;
    /** Whether a file was added, removed, or renamed since the last scan started. */
    stale: boolean;
    readonly unwatch: () => void;
    /** Whether working-tree events are arriving; without them a search rescans on a timer. */
    watching: boolean;
}

/**
 * Bounded file-name indexes, one per recently searched workspace.
 *
 * The index is rescanned only when the Git module's shared working-tree watch reports a path
 * appearing or disappearing, so an idle workspace costs nothing. fff's own watcher stays off:
 * it would be a second recursive watch of the same tree. When a tree cannot be watched, a search
 * falls back to rescanning when the index is more than a couple of seconds old.
 */
export class WorkspaceFileIndex {
    readonly #finders = new Map<string, FinderState>();
    readonly #git: GitModule;
    readonly #maxIndexes = DEFAULT_MAX_INDEXES;
    #fileFinderConstructor: Promise<typeof import("@ff-labs/fff-node").FileFinder> | undefined;

    constructor(git: GitModule) {
        this.#git = git;
    }

    close(): void {
        for (const state of this.#finders.values()) this.#destroy(state);
        this.#finders.clear();
    }

    /** Marks an index out of date after a structural change the caller made or observed. */
    refresh(root: string): void {
        const state = this.#finders.get(resolve(root));
        if (state !== undefined) state.stale = true;
    }

    /** Requests a scan only when a file proven by a direct read is absent from a warm index. */
    ensure(root: string, path: string): void {
        const state = this.#finders.get(resolve(root));
        if (state === undefined || state.finder.isScanning()) return;
        const result = state.finder.fileSearch(path, { pageSize: 10 });
        if (!result.ok) return;
        if (!result.value.items.some((item) => item.relativePath === path)) {
            this.#startScan(state);
        }
    }

    async search(
        root: string,
        query: string,
        limit: number,
    ): Promise<readonly { readonly fileName: string; readonly path: string }[]> {
        const state = await this.#stateFor(root);
        const outdated = state.watching
            ? state.stale
            : Date.now() - state.lastScanAt > RESCAN_AFTER_MS;
        if (outdated) this.#startScan(state);
        if (state.finder.isScanning()) {
            await this.#waitForScan(state.finder, SEARCH_READY_BUDGET_MS);
        }
        const result = state.finder.fileSearch(query, { pageSize: limit });
        if (!result.ok) throw new Error(`File search failed: ${result.error}`);

        return result.value.items.map((item) => ({
            fileName: item.fileName,
            path: item.relativePath,
        }));
    }

    async #stateFor(root: string): Promise<FinderState> {
        const basePath = resolve(root);
        const existing = this.#finders.get(basePath);
        if (existing !== undefined) {
            this.#finders.delete(basePath);
            this.#finders.set(basePath, existing);
            return existing;
        }

        const FileFinderConstructor = await this.#loadFileFinder();
        const created = FileFinderConstructor.create({
            aiMode: true,
            basePath,
            disableContentIndexing: true,
            disableMmapCache: true,
            disableWatch: true,
        });
        if (!created.ok) {
            throw new Error(`Workspace files could not be indexed: ${created.error}`);
        }

        const holder: { state?: FinderState } = {};
        const unwatch = this.#git.watchWorkingTree(basePath, {
            onChanges: (changes) => {
                const state = holder.state;
                if (state === undefined) return;
                if (changes === null || changes.some((change) => change.kind !== "update")) {
                    state.stale = true;
                }
            },
            onWatching: (watching) => {
                const state = holder.state;
                if (state === undefined) return;
                state.watching = watching;
                // Whatever happened before the watch went live, or after it stopped, is unknown.
                state.stale = true;
            },
        });
        const state: FinderState = {
            finder: created.value,
            lastScanAt: Date.now(),
            stale: false,
            unwatch,
            watching: false,
        };
        holder.state = state;
        this.#finders.set(basePath, state);
        this.#removeOldestIndex();
        return state;
    }

    async #waitForScan(finder: FileFinder, timeoutMs: number): Promise<void> {
        await finder.waitForScan(timeoutMs).catch(() => undefined);
    }

    #startScan(state: FinderState): void {
        if (state.finder.isScanning()) return;
        // Cleared before scanning, so a change during the scan leaves the index stale again.
        state.stale = false;
        if (state.finder.scanFiles().ok) state.lastScanAt = Date.now();
        else state.stale = true;
    }

    #removeOldestIndex(): void {
        if (this.#finders.size <= this.#maxIndexes) return;

        const oldestPath = this.#finders.keys().next().value as string | undefined;
        if (oldestPath === undefined) return;

        const oldest = this.#finders.get(oldestPath);
        this.#finders.delete(oldestPath);
        if (oldest !== undefined) this.#destroy(oldest);
    }

    #destroy(state: FinderState): void {
        state.unwatch();
        state.finder.destroy();
    }

    async #loadFileFinder(): Promise<typeof import("@ff-labs/fff-node").FileFinder> {
        this.#fileFinderConstructor ??= import("@ff-labs/fff-node").then(
            ({ FileFinder: FileFinderConstructor }) => FileFinderConstructor,
        );
        return await this.#fileFinderConstructor;
    }
}
