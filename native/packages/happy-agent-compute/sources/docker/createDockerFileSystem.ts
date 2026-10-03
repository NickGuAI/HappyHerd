import { posix } from "node:path";

import type { ComputeFileStat, ComputeFileSystem } from "../ComputeFileSystem.js";
import { EMPTY_COMPUTE_HOST_POLICY, type ComputeHostPolicy } from "../ComputeHostPolicy.js";
import type { ComputePermissions } from "../ComputePermissions.js";
import { assertDockerReadPath } from "./impl/assertDockerReadPath.js";
import { assertDockerWritePath } from "./impl/assertDockerWritePath.js";
import type { DockerEnvironment } from "./DockerEnvironment.js";
import { formatDockerTouchTimestamp } from "./impl/formatDockerTouchTimestamp.js";
import { isDockerNotFoundError } from "./impl/isDockerNotFoundError.js";
import { parseDockerPathStat } from "./impl/parseDockerPathStat.js";
import { resolveDockerPath } from "./impl/resolveDockerPath.js";
import { resolveDockerPrivateDirectories } from "./impl/resolveDockerHostPolicy.js";
import { runDockerExec } from "./impl/runDockerExec.js";

const MAX_FILE_READ_BYTES = 32 * 1024 * 1024;
// Linux NAME_MAX is 255 bytes. One extra byte carries the terminating NUL.
const MAX_DOCKER_DIRECTORY_ENTRY_BYTES = 256;

/**
 * A {@link ComputeFileSystem} whose every call runs inside one container.
 *
 * Reads resolve against the fixed working directory and may reach the whole container filesystem;
 * writes go through {@link assertDockerWritePath}, which enforces the shared permission boundary in
 * the container's own paths, resolving symlinks inside the container so one cannot escape the
 * workspace. Metadata is read with BusyBox-portable shell so the backend works against a minimal
 * image, and large listings are paged so a directory too big to return at once still can be walked.
 */
export function createDockerFileSystem(
    environment: DockerEnvironment,
    hostPolicy: ComputeHostPolicy = EMPTY_COMPUTE_HOST_POLICY,
): ComputeFileSystem {
    const cwd = environment.config.workingDirectory;
    let canonicalCwd: Promise<string> | undefined;
    const resolvePath = (target: string) => {
        if (target !== posix.resolve(cwd)) return resolveDockerPath(environment, target);
        canonicalCwd ??= resolveDockerPath(environment, target).catch((error: unknown) => {
            canonicalCwd = undefined;
            throw error;
        });
        return canonicalCwd;
    };
    let privateVariablePaths: Promise<readonly string[]> | undefined;
    const loadPrivateVariablePaths = () => {
        privateVariablePaths ??= resolveDockerPrivateDirectories(
            environment,
            hostPolicy.privatePathVariables === undefined
                ? {}
                : { privatePathVariables: hostPolicy.privatePathVariables },
        ).catch((error: unknown) => {
            privateVariablePaths = undefined;
            throw error;
        });
        return privateVariablePaths;
    };
    const assertRead = async (permissions: ComputePermissions, path: string) =>
        assertDockerReadPath(
            cwd,
            path,
            permissions,
            resolvePath,
            hostPolicy,
            await loadPrivateVariablePaths(),
        );
    const assertWrite = async (permissions: ComputePermissions, path: string) =>
        assertDockerWritePath(
            cwd,
            path,
            permissions,
            resolvePath,
            hostPolicy,
            await loadPrivateVariablePaths(),
        );
    return {
        cwd,
        async chmod(permissions, path, mode) {
            const target = await assertWrite(permissions, path);
            await successfulExec(environment, ["chmod", (mode & 0o7777).toString(8), target]);
        },
        async exists(permissions, path) {
            const target = await assertRead(permissions, path);
            const result = await runDockerExec(await environment.container(), [
                "/bin/sh",
                "-c",
                'test -e "$1" || test -L "$1"',
                "compute-exists",
                target,
            ]);
            return result.exitCode === 0;
        },
        async lstat(permissions, path) {
            const target = await assertRead(permissions, path);
            const result = await runDockerExec(await environment.container(), [
                "/bin/sh",
                "-c",
                'kind=other; if [ -L "$1" ]; then kind=symlink; elif [ -d "$1" ]; then kind=directory; elif [ -f "$1" ]; then kind=file; fi; printf "%s\\n" "$kind" && stat -c "%s" -- "$1" && stat -c "%Y" -- "$1" && stat -c "%a" -- "$1"',
                "compute-metadata",
                target,
            ]);
            if (result.exitCode !== 0) throw dockerCommandError("inspect", target, result.stderr);
            return parseDockerLstat(result.stdout, target);
        },
        async lstatMany(permissions, paths) {
            if (paths.length === 0) return [];
            const targets = await Promise.all(paths.map((path) => assertRead(permissions, path)));
            const result = await runDockerExec(
                await environment.container(),
                [
                    "/bin/sh",
                    "-c",
                    'set -e\nfor target do\nif [ ! -e "$target" ] && [ ! -L "$target" ]; then printf "missing\\n0\\n0\\n0\\n"; continue; fi\nkind=other\nif [ -L "$target" ]; then kind=symlink; elif [ -d "$target" ]; then kind=directory; elif [ -f "$target" ]; then kind=file; fi\nprintf "%s\\n" "$kind"\nstat -c "%s" -- "$target"\nstat -c "%Y" -- "$target"\nstat -c "%a" -- "$target"\ndone',
                    "compute-directory-metadata",
                    ...targets,
                ],
                { maxOutputBytes: targets.length * 128 },
            );
            if (result.exitCode !== 0) {
                throw dockerCommandError("inspect directory entries", cwd, result.stderr);
            }
            return parseDockerLstatMany(result.stdout, targets);
        },
        async mkdir(permissions, path, options) {
            const target = await assertWrite(permissions, path);
            await successfulExec(environment, [
                "mkdir",
                ...(options?.recursive === true ? ["-p"] : []),
                "--",
                target,
            ]);
        },
        async move(permissions, source, destination) {
            const sourceTarget = await assertWrite(permissions, source);
            const destinationTarget = await assertWrite(permissions, destination);
            await successfulExec(environment, ["mv", "--", sourceTarget, destinationTarget]);
        },
        async realpath(permissions, path) {
            const target = await assertRead(permissions, path);
            return resolveDockerPath(environment, target);
        },
        async readFile(permissions, path) {
            return Buffer.from(await this.readFileBuffer(permissions, path)).toString("utf8");
        },
        async readFileBuffer(permissions, path, options) {
            const target = await assertRead(permissions, path);
            const maxBytes = Math.min(
                options?.maxBytes ?? MAX_FILE_READ_BYTES,
                MAX_FILE_READ_BYTES,
            );
            if (options?.noFollow === true) {
                return readDockerFileWithoutFollowing(
                    await environment.container(),
                    target,
                    maxBytes,
                );
            }
            const details = await this.stat(permissions, path);
            if (details.size > maxBytes) throw fileReadLimitError(target, maxBytes);
            const result = await runDockerExec(
                await environment.container(),
                ["cat", "--", target],
                {
                    maxOutputBytes: maxBytes + 1,
                },
            );
            if (result.exitCode !== 0) throw dockerCommandError("read", target, result.stderr);
            if (result.stdout.length > maxBytes) throw fileReadLimitError(target, maxBytes);
            return result.stdout;
        },
        async readdir(permissions, path) {
            const target = await assertRead(permissions, path);
            const result = await runDockerExec(await environment.container(), [
                "/bin/sh",
                "-c",
                'for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do { test -e "$entry" || test -L "$entry"; } || continue; printf "%s\\0" "${entry##*/}"; done',
                "compute-directory",
                target,
            ]);
            if (result.exitCode !== 0) throw dockerCommandError("list", target, result.stderr);
            return result.stdout
                .toString("utf8")
                .split("\0")
                .filter((entry) => entry.length > 0);
        },
        async readdirPage(permissions, path, options) {
            const target = await assertRead(permissions, path);
            const capacity = options.limit + 1;
            const maxOutputBytes = capacity * MAX_DOCKER_DIRECTORY_ENTRY_BYTES;
            const result = await runDockerExec(
                await environment.container(),
                [
                    "/bin/sh",
                    "-c",
                    'set -e\nexport LC_ALL=C\ncd "$1"\nfind . -mindepth 1 -maxdepth 1 -exec /bin/sh -c \'after=$1; shift; for entry do name=${entry#./}; if [ "$name" \\> "$after" ]; then printf "%s\\\\0" "$name"; fi; done\' compute-directory-page "$2" {} + | sort -z | head -c "$3"',
                    "compute-directory-page",
                    target,
                    options.after ?? "",
                    String(maxOutputBytes),
                ],
                {
                    maxOutputBytes,
                },
            );
            if (result.exitCode !== 0) throw dockerCommandError("list", target, result.stderr);
            const lastTerminator = result.stdout.lastIndexOf(0);
            const completeOutput =
                lastTerminator < 0
                    ? Buffer.alloc(0)
                    : result.stdout.subarray(0, lastTerminator + 1);
            const entries = completeOutput
                .toString("utf8")
                .split("\0")
                .filter((entry) => entry.length > 0);
            const hasMore = entries.length > options.limit;
            return { entries: entries.slice(0, options.limit), hasMore };
        },
        async rm(permissions, path, options) {
            const target = await assertWrite(permissions, path);
            await successfulExec(environment, [
                "rm",
                ...(options?.recursive === true ? ["-r"] : []),
                ...(options?.force === true ? ["-f"] : []),
                "--",
                target,
            ]);
        },
        async setModificationTime(permissions, path, mtimeMs) {
            const target = await assertWrite(permissions, path);
            await successfulExec(environment, [
                "env",
                "TZ=UTC0",
                "touch",
                "-m",
                "-t",
                formatDockerTouchTimestamp(mtimeMs),
                "--",
                target,
            ]);
        },
        async stat(permissions, path) {
            const target = await assertRead(permissions, path);
            const container = await environment.container();
            try {
                const response = (await container.infoArchive({
                    path: target,
                })) as NodeJS.ReadableStream & {
                    destroy?: () => void;
                    headers?: Record<string, string | string[] | undefined>;
                };
                try {
                    return parseDockerPathStat(response.headers?.["x-docker-container-path-stat"]);
                } finally {
                    response.destroy?.();
                }
            } catch (error) {
                if (isDockerNotFoundError(error)) throw dockerCommandError("inspect", target);
                throw error;
            }
        },
        async writeFile(permissions, path, content) {
            const target = await assertWrite(permissions, path);
            const parent = posix.dirname(target);
            await successfulExec(environment, ["mkdir", "-p", "--", parent]);
            await successfulExec(
                environment,
                ["/bin/sh", "-c", 'cat > "$1"', "compute-write", target],
                { stdin: content },
            );
        },
    };
}

/**
 * Reads one regular file without dereferencing a symbolic link at its final component.
 *
 * Docker's archive endpoint returns the type and bytes from the same archived filesystem entry.
 * Rejecting link entries is therefore atomic with the read: there is no check syscall after which
 * another process can swap the final component before a later `cat` opens it.
 */
/**
 * Reads a file without ever following a symbolic link in its final component.
 *
 * The daemon's archive endpoint cannot be used for this. It stats the path, then opens it again to
 * stream the bytes, so a link swapped in between those two steps is followed and the target's
 * contents are returned under a regular-file header — the exact disclosure this option exists to
 * prevent. Checking the path first from here has the same flaw one step further out.
 *
 * So the check happens after the open, against the open file itself rather than the name. The
 * shell opens the path once onto a descriptor; from then on the descriptor is pinned to whatever
 * inode that single operation resolved, and nothing done to the path afterwards can change it.
 * `/proc/self/fd` names that inode's own path, so a descriptor whose real path differs from the
 * requested one was reached through a link, and it is refused before a single byte is read. There
 * is no window between the two steps because the second one asks about the result of the first.
 */
async function readDockerFileWithoutFollowing(
    container: Awaited<ReturnType<DockerEnvironment["container"]>>,
    path: string,
    maxBytes: number,
): Promise<Buffer> {
    const result = await runDockerExec(
        container,
        [
            "/bin/sh",
            "-c",
            [
                "target=$1",
                "limit=$2",
                // The open is a redirection on a group rather than `exec` so that a path which
                // cannot be opened at all — a directory, a dangling link, a file that vanished —
                // skips the body and reaches the last line instead of taking the shell down with
                // a status of its own. stderr is redirected before the open so that a shell which
                // does treat the failed redirection as fatal cannot leak its own diagnostic in
                // place of the read.
                "{",
                "  opened=$(readlink /proc/self/fd/3) || exit 22",
                '  [ "$opened" = "$target" ] || exit 23',
                '  head -c "$limit" <&3',
                "  exit 0",
                '} 2>/dev/null 3< "$target"',
                "exit 21",
            ].join("\n"),
            "compute-no-follow-read",
            path,
            String(maxBytes + 1),
        ],
        {
            maxOutputBytes: maxBytes + 1,
        },
    );
    if (result.exitCode === 23) {
        throw new Error(`Could not read '${path}' because it is a symbolic link.`);
    }
    if (result.exitCode === null) throw dockerCommandError("read", path, result.stderr);
    // Every other non-zero status means the path could not be opened as a readable regular file:
    // the script's own 21 and 22, and whatever status a shell picks for itself when it treats the
    // failed open as fatal. None of them can carry file contents, so all of them refuse alike.
    if (result.exitCode !== 0) {
        throw new Error(`Could not read '${path}' because it is not a regular file.`);
    }
    if (result.stdout.length > maxBytes) throw fileReadLimitError(path, maxBytes);
    return result.stdout;
}

function parseDockerLstat(output: Buffer, path: string): ComputeFileStat {
    const [kind, rawSize, rawMtime, rawMode, ...extra] = output
        .toString("utf8")
        .trimEnd()
        .split("\n");
    const size = Number(rawSize);
    const mtimeSeconds = Number(rawMtime);
    const mode = Number.parseInt(rawMode ?? "", 8);
    if (
        !["directory", "file", "other", "symlink"].includes(kind ?? "") ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !Number.isFinite(mtimeSeconds) ||
        !Number.isSafeInteger(mode) ||
        extra.length > 0
    ) {
        throw new Error(`Docker returned invalid link metadata for '${path}'.`);
    }
    return {
        isDirectory: kind === "directory",
        isFile: kind === "file",
        isSymbolicLink: kind === "symlink",
        mode,
        mtimeMs: mtimeSeconds * 1000,
        size,
    };
}

function parseDockerLstatMany(
    output: Buffer,
    paths: readonly string[],
): readonly (ComputeFileStat | undefined)[] {
    const lines = output.toString("utf8").trimEnd().split("\n");
    if (lines.length !== paths.length * 4) {
        throw new Error("Docker returned incomplete directory-entry metadata.");
    }
    return paths.map((path, index) => {
        const record = lines.slice(index * 4, index * 4 + 4);
        return record[0] === "missing"
            ? undefined
            : parseDockerLstat(Buffer.from(record.join("\n")), path);
    });
}

function fileReadLimitError(path: string, maxBytes: number): Error {
    return new Error(
        `Could not read '${path}' in the Docker container because it exceeds ${String(maxBytes)} bytes.`,
    );
}

async function successfulExec(
    environment: DockerEnvironment,
    command: readonly string[],
    options: { stdin?: string | Uint8Array } = {},
) {
    const result = await runDockerExec(await environment.container(), command, options);
    if (result.exitCode !== 0)
        throw dockerCommandError("access", command.at(-1) ?? "path", result.stderr);
}

function dockerCommandError(action: string, path: string, stderr?: Buffer): Error {
    const detail = stderr?.toString("utf8").trim();
    return new Error(
        detail === undefined || detail.length === 0
            ? `Could not ${action} '${path}' in the Docker container.`
            : `Could not ${action} '${path}' in the Docker container: ${detail}`,
    );
}
