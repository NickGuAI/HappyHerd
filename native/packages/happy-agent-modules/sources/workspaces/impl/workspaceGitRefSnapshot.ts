import { closeSync, existsSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

const MAX_GIT_PATH_DIRECTIVE_BYTES = 4 * 1024;
const MAX_PACKED_REFS_RESERVATION_BYTES = 8 * 1024 * 1024;
const PACKED_REFS_RESERVATION_READ_BYTES = 64 * 1024;

/**
 * One bounded look at where a project keeps its branches.
 *
 * Reservation decides a branch and a folder key inside a database transaction, so it cannot spawn
 * Git for every candidate. Git stores branches either as loose ref files or inside `packed-refs`;
 * reading both once turns each candidate check into a path probe and a set lookup. `complete` is
 * false when the metadata could not be read in full, which tells the reservation to fall back to
 * an identity-bearing key instead of trusting an incomplete view.
 */
export interface WorkspaceGitRefSnapshot {
    readonly commonDirectory?: string;
    readonly complete: boolean;
    readonly packedRefs: ReadonlySet<string>;
}

export function workspaceGitRefSnapshot(projectPath: string): WorkspaceGitRefSnapshot {
    const commonDirectory = gitCommonDirectoryPath(projectPath);
    if (commonDirectory.path === undefined) {
        return { complete: commonDirectory.complete, packedRefs: new Set() };
    }
    const packed = readBoundedPackedRefs(commonDirectory.path);
    return { commonDirectory: commonDirectory.path, ...packed };
}

/** Whether Git already holds this branch. Packed refs are only seen under `worktree/`. */
export function gitBranchExists(snapshot: WorkspaceGitRefSnapshot, branch: string): boolean {
    const commonDirectory = snapshot.commonDirectory;
    if (commonDirectory === undefined) return false;
    const ref = `refs/heads/${branch}`;
    return existsSync(join(commonDirectory, ...ref.split("/"))) || snapshot.packedRefs.has(ref);
}

/** Whether a managed folder key is already a directory or already names a workspace branch. */
export function workspaceStorageKeyExists(
    snapshot: WorkspaceGitRefSnapshot,
    workspaceRoot: string,
    storageKey: string,
): boolean {
    if (existsSync(join(workspaceRoot, storageKey))) return true;
    return gitBranchExists(snapshot, `worktree/${storageKey}`);
}

interface GitCommonDirectoryResolution {
    complete: boolean;
    path?: string;
}

function gitCommonDirectoryPath(projectPath: string): GitCommonDirectoryResolution {
    const dotGit = join(projectPath, ".git");
    let gitDirectory: string;
    try {
        const metadata = statSync(dotGit);
        if (metadata.isDirectory()) {
            gitDirectory = dotGit;
        } else if (metadata.isFile()) {
            const directive = readGitPathDirective(dotGit, "gitdir:", false);
            if (!directive.complete || directive.value === undefined) return { complete: false };
            gitDirectory = resolve(projectPath, directive.value);
        } else {
            return { complete: false };
        }
    } catch (error) {
        return { complete: isMissingPathError(error) };
    }

    const commonDirectory = readGitPathDirective(join(gitDirectory, "commondir"), "", true);
    if (!commonDirectory.complete) return { complete: false };
    return {
        complete: true,
        path:
            commonDirectory.value === undefined
                ? gitDirectory
                : resolve(gitDirectory, commonDirectory.value),
    };
}

function readGitPathDirective(
    path: string,
    prefix: string,
    missingIsComplete: boolean,
): { complete: boolean; value?: string } {
    let descriptor: number | undefined;
    try {
        descriptor = openSync(path, "r");
        const size = fstatSync(descriptor).size;
        if (size > MAX_GIT_PATH_DIRECTIVE_BYTES) return { complete: false };
        const bytes = Buffer.alloc(size);
        if (size > 0 && readSync(descriptor, bytes, 0, size, 0) !== size) {
            return { complete: false };
        }
        const value = bytes.toString("utf8").trim();
        if (prefix.length === 0) {
            return value.length === 0 ? { complete: false } : { complete: true, value };
        }
        if (!value.startsWith(prefix)) return { complete: false };
        const pathValue = value.slice(prefix.length).trim();
        return pathValue.length === 0 ? { complete: false } : { complete: true, value: pathValue };
    } catch (error) {
        return { complete: missingIsComplete && isMissingPathError(error) };
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
    }
}

function readBoundedPackedRefs(
    gitCommonDirectory: string,
): Pick<WorkspaceGitRefSnapshot, "complete" | "packedRefs"> {
    let descriptor: number | undefined;
    try {
        descriptor = openSync(join(gitCommonDirectory, "packed-refs"), "r");
        const size = fstatSync(descriptor).size;
        if (size > MAX_PACKED_REFS_RESERVATION_BYTES) {
            return { complete: false, packedRefs: new Set() };
        }
        const bytes = Buffer.allocUnsafe(Math.min(PACKED_REFS_RESERVATION_READ_BYTES, size));
        const decoder = new StringDecoder("utf8");
        const refs = new Set<string>();
        let offset = 0;
        let remainder = "";
        while (offset < size) {
            const read = readSync(
                descriptor,
                bytes,
                0,
                Math.min(bytes.length, size - offset),
                offset,
            );
            if (read === 0) return { complete: false, packedRefs: new Set() };
            offset += read;
            const lines = `${remainder}${decoder.write(bytes.subarray(0, read))}`.split(/\r?\n/u);
            remainder = lines.pop() ?? "";
            for (const line of lines) addPackedWorkspaceRef(refs, line);
        }
        addPackedWorkspaceRef(refs, `${remainder}${decoder.end()}`);
        return { complete: true, packedRefs: refs };
    } catch (error) {
        // A missing packed-refs file is the ordinary loose-ref case. Anything else selects a
        // reservation key carrying the workspace's own identity rather than reading without bound.
        return {
            complete: (error as NodeJS.ErrnoException).code === "ENOENT",
            packedRefs: new Set(),
        };
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
    }
}

function addPackedWorkspaceRef(refs: Set<string>, line: string): void {
    if (line.length === 0 || line.startsWith("#") || line.startsWith("^")) return;
    const separator = line.indexOf(" ");
    if (separator === -1) return;
    const ref = line.slice(separator + 1);
    if (ref.startsWith("refs/heads/worktree/")) refs.add(ref);
}

function isMissingPathError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
}
