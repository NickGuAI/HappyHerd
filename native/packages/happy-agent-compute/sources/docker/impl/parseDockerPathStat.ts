import type { ComputeFileStat } from "../../ComputeFileSystem.js";

// The Docker daemon reports a path's mode as a Go `os.FileMode`, whose high bits encode the file
// type and special bits separately from the low permission bits. These masks pick those bits out.
const GO_MODE_DIRECTORY = 0x80000000;
const GO_MODE_SETGID = 0x00400000;
const GO_MODE_SETUID = 0x00800000;
const GO_MODE_SYMLINK = 0x08000000;
const GO_MODE_STICKY = 0x00100000;
const GO_MODE_TYPE = 0x8f280000;

/**
 * Parses the `X-Docker-Container-Path-Stat` header the daemon returns for an archive HEAD.
 *
 * The header is a base64-encoded JSON object using Go's `FileMode` encoding, so this translates
 * those bits into the backend-neutral {@link ComputeFileStat} the rest of the compute understands.
 * It follows symbolic links, matching a `stat` that resolves the path.
 */
export function parseDockerPathStat(
    encodedHeader: string | readonly string[] | undefined,
): ComputeFileStat {
    const encoded = Array.isArray(encodedHeader) ? encodedHeader[0] : encodedHeader;
    if (encoded === undefined) {
        throw new Error("Docker did not return filesystem metadata for the requested path.");
    }
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("mode" in parsed) ||
        typeof parsed.mode !== "number" ||
        !("mtime" in parsed) ||
        typeof parsed.mtime !== "string" ||
        !("size" in parsed) ||
        typeof parsed.size !== "number"
    ) {
        throw new Error("Docker returned invalid filesystem metadata for the requested path.");
    }
    const mtimeMs = Date.parse(parsed.mtime);
    if (!Number.isFinite(mtimeMs)) {
        throw new Error("Docker returned an invalid modification time for the requested path.");
    }
    return {
        isDirectory: (parsed.mode & GO_MODE_DIRECTORY) !== 0,
        isFile: (parsed.mode & GO_MODE_TYPE) === 0,
        isSymbolicLink: (parsed.mode & GO_MODE_SYMLINK) !== 0,
        mode:
            (parsed.mode & 0o777) |
            ((parsed.mode & GO_MODE_SETUID) === 0 ? 0 : 0o4000) |
            ((parsed.mode & GO_MODE_SETGID) === 0 ? 0 : 0o2000) |
            ((parsed.mode & GO_MODE_STICKY) === 0 ? 0 : 0o1000),
        mtimeMs,
        size: parsed.size,
    };
}
