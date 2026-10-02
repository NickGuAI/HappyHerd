import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Folders whose contents a fresh copy would only have to build again. */
const SKIPPED_ENTRIES = new Set([".git", "node_modules"]);

/**
 * Makes a workspace out of a project that Git cannot cut a worktree from.
 *
 * A project without Git still deserves a workspace, so the folder itself is copied. Build output
 * and dependency trees are left behind: they belong to the machine rather than to the work, and
 * the workspace's setup commands are what puts them back.
 *
 * The copy lands under a temporary name and is moved into place only once it is complete, so an
 * interrupted copy never looks like a finished workspace.
 */
export async function copyProjectFolder(options: {
    projectPath: string;
    workspacePath: string;
}): Promise<void> {
    const parent = dirname(options.workspacePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const staging = `${options.workspacePath}.partial`;
    await rm(staging, { force: true, recursive: true });
    await mkdir(staging, { recursive: true, mode: 0o700 });
    try {
        for (const entry of await readdir(options.projectPath, { withFileTypes: true })) {
            if (SKIPPED_ENTRIES.has(entry.name)) continue;
            await cp(join(options.projectPath, entry.name), join(staging, entry.name), {
                errorOnExist: false,
                force: true,
                recursive: true,
                verbatimSymlinks: true,
            });
        }
        await rm(options.workspacePath, { force: true, recursive: true });
        await rename(staging, options.workspacePath);
    } catch (error) {
        await rm(staging, { force: true, recursive: true });
        throw error;
    }
}
