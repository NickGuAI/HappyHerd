import {
    chmod,
    lstat,
    mkdir,
    open,
    opendir,
    readFile,
    readdir,
    realpath,
    rename,
    rm,
    stat,
    utimes,
    writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";

import type { ComputeHostPolicy } from "../ComputeHostPolicy.js";
import type { ComputeFileStat, ComputeFileSystem } from "../ComputeFileSystem.js";
import { assertCanReadPath } from "../sandbox/assertCanReadPath.js";
import { assertCanWritePath } from "../sandbox/assertCanWritePath.js";
import { resolveFileSystemPath } from "../sandbox/impl/resolveFileSystemPath.js";
import { toComputeFileStat } from "../sandbox/impl/toComputeFileStat.js";

export interface HostFileSystemOptions {
    /** The directory relative paths resolve against, in this machine's own paths. */
    cwd: string;
    environment?: NodeJS.ProcessEnv;
    hostPolicy?: ComputeHostPolicy;
    /** The home directory, used to expand `~` and to bound sensitive host reads. */
    home?: string;
    platform?: NodeJS.Platform;
}

/**
 * The real filesystem on this machine, presented against one fixed working directory.
 *
 * Every read is checked with {@link assertCanReadPath} and every write with
 * {@link assertCanWritePath}, using only the immutable boundary carried by that call.
 */
export function createHostFileSystem(options: HostFileSystemOptions): ComputeFileSystem {
    const cwd = options.cwd;
    const home = options.home ?? homedir();
    const hostPolicy = options.hostPolicy ?? {};
    const resolvePath = (path: string) => resolveFileSystemPath(path, cwd, home);
    const readPathOptions = {
        ...(options.environment === undefined ? {} : { environment: options.environment }),
        homeDirectory: home,
        ...(options.platform === undefined ? {} : { platform: options.platform }),
    };
    const writePathOptions =
        options.environment === undefined ? {} : { environment: options.environment };
    return {
        cwd,
        home,
        async chmod(permissions, path, fileMode) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissions, hostPolicy, writePathOptions);
            await chmod(target, fileMode);
        },
        async exists(permissions, path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissions, hostPolicy, readPathOptions);
            try {
                await lstat(target);
                return true;
            } catch (error) {
                if (
                    error instanceof Error &&
                    "code" in error &&
                    ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
                ) {
                    return false;
                }
                throw error;
            }
        },
        async lstat(permissions, path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissions, hostPolicy, readPathOptions);
            return toComputeFileStat(await lstat(target));
        },
        async lstatMany(permissions, paths) {
            const results: (ComputeFileStat | undefined)[] = [];
            for (let offset = 0; offset < paths.length; offset += 32) {
                const batch = paths.slice(offset, offset + 32);
                results.push(
                    ...(await Promise.all(
                        batch.map(async (path) => {
                            try {
                                return await this.lstat(permissions, path);
                            } catch {
                                return undefined;
                            }
                        }),
                    )),
                );
            }
            return results;
        },
        async mkdir(permissions, path, mkdirOptions) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissions, hostPolicy, writePathOptions);
            await mkdir(target, { recursive: mkdirOptions?.recursive ?? false });
        },
        async move(permissions, source, destination) {
            const sourceTarget = resolvePath(source);
            const destinationTarget = resolvePath(destination);
            await assertCanWritePath(cwd, sourceTarget, permissions, hostPolicy, writePathOptions);
            await assertCanWritePath(
                cwd,
                destinationTarget,
                permissions,
                hostPolicy,
                writePathOptions,
            );
            await rename(sourceTarget, destinationTarget);
        },
        async realpath(permissions, path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissions, hostPolicy, readPathOptions);
            return realpath(target);
        },
        async readFile(permissions, path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissions, hostPolicy, readPathOptions);
            return readFile(target, "utf8");
        },
        async readFileBuffer(permissions, path, readOptions) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissions, hostPolicy, readPathOptions);
            return readOptions?.noFollow === true
                ? readFileBufferWithoutFollowing(
                      target,
                      readOptions.maxBytes ?? Number.MAX_SAFE_INTEGER,
                  )
                : readOptions?.maxBytes === undefined
                  ? readFile(target)
                  : readFileBufferWithLimit(target, readOptions.maxBytes);
        },
        async readdir(permissions, path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissions, hostPolicy, readPathOptions);
            return readdir(target);
        },
        async readdirPage(permissions, path, pageOptions) {
            if (!Number.isSafeInteger(pageOptions.limit) || pageOptions.limit < 0) {
                throw new Error("Directory page limits must be non-negative integers.");
            }
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissions, hostPolicy, readPathOptions);
            const capacity = pageOptions.limit + 1;
            const entries: DirectoryHeapEntry[] = [];
            const after =
                pageOptions.after === undefined ? undefined : Buffer.from(pageOptions.after);
            const directory = await opendir(target);
            for await (const entry of directory) {
                const candidate = { bytes: Buffer.from(entry.name), name: entry.name };
                if (after !== undefined && Buffer.compare(candidate.bytes, after) <= 0) continue;
                addToBoundedMaxHeap(entries, candidate, capacity);
            }
            entries.sort(compareDirectoryHeapEntries);
            const hasMore = entries.length > pageOptions.limit;
            if (hasMore) entries.pop();
            return { entries: entries.map((entry) => entry.name), hasMore };
        },
        async rm(permissions, path, rmOptions) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissions, hostPolicy, writePathOptions);
            await rm(target, {
                recursive: rmOptions?.recursive ?? false,
                force: rmOptions?.force ?? false,
            });
        },
        async setModificationTime(permissions, path, mtimeMs) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissions, hostPolicy, writePathOptions);
            const time = new Date(mtimeMs);
            await utimes(target, time, time);
        },
        async stat(permissions, path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissions, hostPolicy, readPathOptions);
            return toComputeFileStat(await stat(target));
        },
        async writeFile(permissions, path, content) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissions, hostPolicy, writePathOptions);
            await writeFile(target, content);
        },
    };
}

interface DirectoryHeapEntry {
    bytes: Buffer;
    name: string;
}

function compareDirectoryHeapEntries(left: DirectoryHeapEntry, right: DirectoryHeapEntry): number {
    return Buffer.compare(left.bytes, right.bytes);
}

/**
 * Keeps the lexicographically smallest `capacity` names while scanning a directory once.
 *
 * A directory too large to list at once is paged, so only one page plus the sentinel that reveals
 * whether more remain is ever held in memory, rather than sorting the whole directory.
 */
function addToBoundedMaxHeap(
    heap: DirectoryHeapEntry[],
    entry: DirectoryHeapEntry,
    capacity: number,
): void {
    if (heap.length < capacity) {
        heap.push(entry);
        let index = heap.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (compareDirectoryHeapEntries(heap[parent]!, heap[index]!) >= 0) break;
            [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
            index = parent;
        }
        return;
    }
    if (compareDirectoryHeapEntries(entry, heap[0]!) >= 0) return;
    heap[0] = entry;
    let index = 0;
    while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= heap.length) return;
        const larger =
            right < heap.length && compareDirectoryHeapEntries(heap[right]!, heap[left]!) > 0
                ? right
                : left;
        if (compareDirectoryHeapEntries(heap[index]!, heap[larger]!) >= 0) return;
        [heap[index], heap[larger]] = [heap[larger]!, heap[index]!];
        index = larger;
    }
}

async function readFileBufferWithLimit(path: string, maxBytes: number): Promise<Buffer> {
    return readOpenedFileWithLimit(path, maxBytes, "r");
}

async function readFileBufferWithoutFollowing(path: string, maxBytes: number): Promise<Buffer> {
    return readOpenedFileWithLimit(path, maxBytes, constants.O_RDONLY | constants.O_NOFOLLOW);
}

/**
 * Reads a file while refusing to buffer more than the caller allowed.
 *
 * The read stops one byte past the budget so exceeding it is detected without ever holding the
 * whole of an oversized file, which is what a bounded read of untrusted content needs.
 */
async function readOpenedFileWithLimit(
    path: string,
    maxBytes: number,
    flags: number | string,
): Promise<Buffer> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        throw new Error("The file read limit must be a non-negative safe integer.");
    }
    const file = await open(path, flags);
    const chunks: Buffer[] = [];
    let length = 0;
    try {
        while (length <= maxBytes) {
            const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - length));
            const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
            if (bytesRead === 0) return Buffer.concat(chunks, length);
            chunks.push(chunk.subarray(0, bytesRead));
            length += bytesRead;
        }
        throw new Error(`Could not read '${path}' because it exceeds ${String(maxBytes)} bytes.`);
    } finally {
        await file.close();
    }
}
