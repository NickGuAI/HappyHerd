import type { IFileSystem } from "just-bash";

import { normalizeJustBashFileSystemError } from "./normalizeJustBashFileSystemError.js";

const ASYNC_FILE_SYSTEM_CALLS = [
    "readFile",
    "readFileBytes",
    "readFileBuffer",
    "writeFile",
    "appendFile",
    "exists",
    "stat",
    "mkdir",
    "readdir",
    "readdirWithFileTypes",
    "rm",
    "cp",
    "mv",
    "chmod",
    "symlink",
    "link",
    "readlink",
    "lstat",
    "realpath",
    "utimes",
] as const;

/**
 * Wraps a just-bash filesystem so its errors carry `.code` the way Node's `fs` does.
 *
 * This is the one place a raw just-bash `IFileSystem` becomes the filesystem this package builds
 * `ComputeFileSystem` from, so normalizing here covers every backend built on top of it rather
 * than every caller having to recover the errno from the message on its own.
 */
export function withNodeStyleFileSystemErrors(fs: IFileSystem): IFileSystem {
    const wrapped: Record<string, unknown> = {
        resolvePath: fs.resolvePath.bind(fs),
        getAllPaths: fs.getAllPaths.bind(fs),
    };
    for (const name of ASYNC_FILE_SYSTEM_CALLS) {
        const call = fs[name] as ((...args: unknown[]) => Promise<unknown>) | undefined;
        if (call === undefined) continue;
        wrapped[name] = async (...args: unknown[]): Promise<unknown> => {
            try {
                return await call.apply(fs, args);
            } catch (error) {
                throw normalizeJustBashFileSystemError(error);
            }
        };
    }
    return wrapped as unknown as IFileSystem;
}
