import type { ComputePermissions } from "./ComputePermissions.js";

/** What a path is, as every backend reports it. */
export interface ComputeFileStat {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode?: number;
    size: number;
    mtimeMs: number;
}

/** How a file is read. */
export interface ComputeReadOptions {
    /** Refuse the read after this many bytes without buffering the rest of the file. */
    maxBytes?: number;
    /** Refuse a symbolic link at the final path component when opening the file. */
    noFollow?: boolean;
}

/** How much of a directory is wanted, for directories too large to list at once. */
export interface ComputeDirectoryPageOptions {
    /** Return names strictly after this UTF-8 byte-ordered cursor. */
    after?: string;
    /** Maximum number of names to return. */
    limit: number;
}

/** One page of a directory listing. */
export interface ComputeDirectoryPage {
    /** Names ordered lexicographically by their UTF-8 bytes. */
    entries: readonly string[];
    hasMore: boolean;
}

/**
 * A filesystem an agent works in, whichever machine it is really on.
 *
 * Every backend answers the same calls: the host's own filesystem, a shell emulated in memory, a
 * folder on this machine, or a directory inside a container. Paths are the ones that backend
 * understands, resolved against `cwd`, and nothing here says where the files really live.
 *
 * Every call carries the permissions it runs under. The filesystem remembers no policy between
 * calls, so a read that was refused a moment ago and one that is allowed now differ only in what
 * the caller passed, and a decision made for one file can never widen the next.
 */
export interface ComputeFileSystem {
    /** The directory relative paths resolve against. */
    cwd: string;
    /** The home directory, when the backend has one. */
    home?: string;
    chmod(permissions: ComputePermissions, path: string, mode: number): Promise<void>;
    exists(permissions: ComputePermissions, path: string): Promise<boolean>;
    lstat(permissions: ComputePermissions, path: string): Promise<ComputeFileStat>;
    /** Inspect a bounded set of paths. Implementations may batch remote work. */
    lstatMany(
        permissions: ComputePermissions,
        paths: readonly string[],
    ): Promise<readonly (ComputeFileStat | undefined)[]>;
    mkdir(
        permissions: ComputePermissions,
        path: string,
        options?: { recursive?: boolean },
    ): Promise<void>;
    move(permissions: ComputePermissions, source: string, destination: string): Promise<void>;
    realpath(permissions: ComputePermissions, path: string): Promise<string>;
    readFile(permissions: ComputePermissions, path: string): Promise<string>;
    readFileBuffer(
        permissions: ComputePermissions,
        path: string,
        options?: ComputeReadOptions,
    ): Promise<Uint8Array>;
    readdir(permissions: ComputePermissions, path: string): Promise<readonly string[]>;
    readdirPage(
        permissions: ComputePermissions,
        path: string,
        options: ComputeDirectoryPageOptions,
    ): Promise<ComputeDirectoryPage>;
    rm(
        permissions: ComputePermissions,
        path: string,
        options?: { recursive?: boolean; force?: boolean },
    ): Promise<void>;
    setModificationTime(
        permissions: ComputePermissions,
        path: string,
        mtimeMs: number,
    ): Promise<void>;
    stat(permissions: ComputePermissions, path: string): Promise<ComputeFileStat>;
    writeFile(
        permissions: ComputePermissions,
        path: string,
        content: string | Uint8Array,
    ): Promise<void>;
}
