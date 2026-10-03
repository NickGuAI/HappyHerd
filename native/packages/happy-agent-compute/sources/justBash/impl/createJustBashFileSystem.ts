import { Buffer } from "node:buffer";

import type { IFileSystem } from "just-bash";

import type { ComputeFileStat, ComputeFileSystem } from "../../ComputeFileSystem.js";
import type { ComputeHostPolicy } from "../../ComputeHostPolicy.js";
import type { ComputePermissions } from "../../ComputePermissions.js";
import { JustBashPermissionFileSystem } from "./JustBashPermissionFileSystem.js";
import { withNodeStyleFileSystemErrors } from "./withNodeStyleFileSystemErrors.js";

/** Presents just-bash paths relative to one fixed working directory. */
export function createJustBashFileSystem(
    fs: IFileSystem,
    cwd: string,
    home: string = cwd,
    hostPolicy: ComputeHostPolicy = {},
): ComputeFileSystem {
    const normalizedFs = withNodeStyleFileSystemErrors(fs);
    const resolvePath = (path: string): string => {
        if (path === "~") return home;
        if (path.startsWith("~/")) return normalizedFs.resolvePath(home, path.slice(2));
        return normalizedFs.resolvePath(cwd, path);
    };
    const guarded = (permissions: ComputePermissions) =>
        new JustBashPermissionFileSystem(normalizedFs, cwd, permissions, hostPolicy);

    return {
        cwd,
        home,
        async chmod(permissions, path, mode) {
            await guarded(permissions).chmod(resolvePath(path), mode);
        },
        async exists(permissions, path) {
            return await guarded(permissions).exists(resolvePath(path));
        },
        async lstat(permissions, path) {
            return toComputeFileStat(await guarded(permissions).lstat(resolvePath(path)));
        },
        async lstatMany(permissions, paths) {
            const permissionFileSystem = guarded(permissions);
            return await Promise.all(
                paths.map(async (path) => {
                    try {
                        return toComputeFileStat(
                            await permissionFileSystem.lstat(resolvePath(path)),
                        );
                    } catch {
                        return undefined;
                    }
                }),
            );
        },
        async mkdir(permissions, path, options) {
            await guarded(permissions).mkdir(resolvePath(path), options);
        },
        async move(permissions, source, destination) {
            await guarded(permissions).mv(resolvePath(source), resolvePath(destination));
        },
        async realpath(permissions, path) {
            return await guarded(permissions).realpath(resolvePath(path));
        },
        async readFile(permissions, path) {
            return await guarded(permissions).readFile(resolvePath(path));
        },
        async readFileBuffer(permissions, path, options) {
            const resolved = resolvePath(path);
            const permissionFileSystem = guarded(permissions);
            if (
                options?.noFollow === true &&
                (await permissionFileSystem.lstat(resolved)).isSymbolicLink
            ) {
                throw new Error(`Could not read '${path}' because it is a symbolic link.`);
            }
            const bytes = await permissionFileSystem.readFileBuffer(resolved);
            if (options?.maxBytes !== undefined && bytes.byteLength > options.maxBytes) {
                throw new Error(
                    `Could not read '${path}' because it exceeds ${String(options.maxBytes)} bytes.`,
                );
            }
            return bytes;
        },
        async readdir(permissions, path) {
            return await guarded(permissions).readdir(resolvePath(path));
        },
        async readdirPage(permissions, path, options) {
            if (!Number.isSafeInteger(options.limit) || options.limit < 0) {
                throw new Error("Directory page limits must be non-negative integers.");
            }
            const after = options.after === undefined ? undefined : Buffer.from(options.after);
            const entries = (await guarded(permissions).readdir(resolvePath(path)))
                .map((name) => ({ bytes: Buffer.from(name), name }))
                .filter((entry) => after === undefined || Buffer.compare(entry.bytes, after) > 0)
                .sort((left, right) => Buffer.compare(left.bytes, right.bytes));
            return {
                entries: entries.slice(0, options.limit).map((entry) => entry.name),
                hasMore: entries.length > options.limit,
            };
        },
        async rm(permissions, path, options) {
            await guarded(permissions).rm(resolvePath(path), options);
        },
        async setModificationTime(permissions, path, mtimeMs) {
            const time = new Date(mtimeMs);
            await guarded(permissions).utimes(resolvePath(path), time, time);
        },
        async stat(permissions, path) {
            return toComputeFileStat(await guarded(permissions).stat(resolvePath(path)));
        },
        async writeFile(permissions, path, content) {
            await guarded(permissions).writeFile(resolvePath(path), content);
        },
    };
}

function toComputeFileStat(stat: {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode: number;
    size: number;
    mtime: Date;
}): ComputeFileStat {
    return {
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
        isSymbolicLink: stat.isSymbolicLink,
        mode: stat.mode & 0o7777,
        size: stat.size,
        mtimeMs: stat.mtime.getTime(),
    };
}
