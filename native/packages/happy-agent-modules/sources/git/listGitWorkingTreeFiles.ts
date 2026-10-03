import { Type, type Static } from "@sinclair/typebox";

import { runScanGit, type ScanGitRunner } from "./runScanGit.js";

const WORKING_TREE_FILE_LIMIT = 20_000;

export const gitWorkingTreeFilesSchema = Type.Object(
    {
        paths: Type.Array(Type.String()),
        truncated: Type.Boolean(),
    },
    { additionalProperties: false },
);
export type GitWorkingTreeFiles = Static<typeof gitWorkingTreeFilesSchema>;

export async function listGitWorkingTreeFiles(options: {
    path: string;
    runGit?: ScanGitRunner;
    signal?: AbortSignal;
}): Promise<GitWorkingTreeFiles> {
    let result;
    try {
        result = await (options.runGit ?? runScanGit)({
            args: ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd: options.path,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    } catch (error) {
        if (isMissingRepository(error)) return { paths: [], truncated: false };
        throw error;
    }
    const stdout = result.truncated
        ? result.stdout.slice(0, result.stdout.lastIndexOf("\0") + 1)
        : result.stdout;
    const paths = [...new Set(stdout.split("\0").filter(Boolean))].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
    );
    return {
        paths: paths.slice(0, WORKING_TREE_FILE_LIMIT),
        truncated: result.truncated || paths.length > WORKING_TREE_FILE_LIMIT,
    };
}

function isMissingRepository(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const message = error instanceof Error ? error.message : "";
    return `${message}\n${stderr}`.includes("not a git repository (or any");
}
