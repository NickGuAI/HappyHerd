import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

import type { GitModule } from "../../git/index.js";
import { ProjectRegistrationError } from "../ProjectRegistrationError.js";

/**
 * Checks a folder someone asked to register explicitly.
 *
 * Any readable directory is a project. Registration never inspects Git: setup separately decides
 * whether the folder has a usable repository and whether child workspaces use worktrees or copies.
 */
export async function validateRegistrationPath(
    git: Pick<GitModule, "normalizeProjectCwd">,
    requestedPath: string,
): Promise<string> {
    let details;
    try {
        details = await stat(requestedPath);
    } catch (error) {
        if (isMissingPathError(error)) {
            throw new ProjectRegistrationError(
                "path_missing",
                "The project folder does not exist.",
            );
        }
        throw new ProjectRegistrationError(
            "path_inaccessible",
            "The project folder is not accessible.",
        );
    }
    if (!details.isDirectory()) {
        throw new ProjectRegistrationError("not_directory", "The project path is not a folder.");
    }
    try {
        await access(requestedPath, constants.R_OK | constants.X_OK);
    } catch {
        throw new ProjectRegistrationError(
            "path_inaccessible",
            "The project folder is not accessible.",
        );
    }
    return git.normalizeProjectCwd(requestedPath);
}

function isMissingPathError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
}
