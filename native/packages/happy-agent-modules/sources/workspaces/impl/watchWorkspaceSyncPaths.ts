import { statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { PROJECT_CONFIG_FILE_NAMES } from "./loadWorkspaceFolderSettings.js";

/**
 * Watches the project root's copies of the configured sync paths, best-effort.
 *
 * Every observation funnels into one callback: the caller re-reads the configuration, re-arms the
 * watch, and replicates everything, so a watch that fires spuriously or coarsely still converges.
 * Watches are armed on parent directories rather than the files themselves because editors
 * replace files by renaming over them, which leaves a file watch following a dead inode; paths
 * sharing a parent share one watch. The project configuration files are watched the same way so
 * a changed sync list is picked up without a restart.
 *
 * A synced directory's contents are watched recursively only when the caller says the kernel backs
 * recursive watching; on Linux, Node emulates it with one inotify watch per directory, which an
 * arbitrarily large tree would turn into real resource use. There, and for a path that cannot be
 * watched at all, sync degrades to catching up when some watched path fires.
 */
export function watchWorkspaceSyncPaths(options: {
    onChange: () => void;
    projectPath: string;
    /** Whether this platform's kernel backs recursive directory watching. */
    recursive: boolean;
    syncPaths: readonly string[];
}): () => void {
    const watchers: FSWatcher[] = [];
    const arm = (directory: string, recursive: boolean, accept?: (entry: string) => boolean) => {
        try {
            const watcher = watch(directory, { recursive }, (_event, filename) => {
                if (accept !== undefined && filename !== null && !accept(String(filename))) return;
                options.onChange();
            });
            watcher.on("error", () => {
                // A watch torn down by the platform quietly degrades to no observation.
            });
            watcher.unref?.();
            watchers.push(watcher);
        } catch {
            // An unwatchable path degrades to no observation rather than failing the project.
        }
    };

    const parentEntries = new Map<string, Set<string>>();
    const observe = (directory: string, entry: string) => {
        const entries = parentEntries.get(directory) ?? new Set<string>();
        entries.add(entry);
        parentEntries.set(directory, entries);
    };
    for (const name of PROJECT_CONFIG_FILE_NAMES) observe(options.projectPath, name);
    for (const path of new Set(options.syncPaths)) {
        const source = resolve(options.projectPath, path);
        observe(dirname(source), basename(source));
        if (options.recursive && isDirectory(source)) arm(source, true);
    }
    for (const [directory, entries] of parentEntries) {
        arm(directory, false, (entry) => entries.has(entry));
    }

    return () => {
        for (const watcher of watchers) {
            try {
                watcher.close();
            } catch {
                // A watcher already torn down by the platform needs no further cleanup.
            }
        }
        watchers.length = 0;
    };
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}
