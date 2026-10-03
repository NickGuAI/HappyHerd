import { constants } from "node:os";

const CODE_PATTERN = /^(E[A-Z]+): /;
const SYSCALL_PATH_PATTERN = /, ([a-zA-Z][\w-]*) '([^']+)'/;

/**
 * just-bash's filesystem backends write an operation's errno into the thrown message
 * (`ENOENT: no such file or directory, lstat '/path'`) but never set the properties Node's own
 * `fs` does. Callers above this package branch on `error.code`, `error.errno`, `error.syscall`,
 * and `error.path` the way they would against a real filesystem, so an error missing them turns
 * an ordinary condition — a file that is simply not there — into an error nothing recognizes.
 *
 * `os.constants.errno` supplies the numeric value for the current platform rather than a guessed
 * constant, matching how Node itself derives `error.errno` from `error.code`.
 */
export function normalizeJustBashFileSystemError(error: unknown): unknown {
    if (!(error instanceof Error)) return error;
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== undefined) return error;
    const code = CODE_PATTERN.exec(error.message)?.[1];
    if (code === undefined) return error;
    nodeError.code = code;
    const errno = (constants.errno as Record<string, number | undefined>)[code];
    if (errno !== undefined) nodeError.errno = -errno;
    const syscallPath = SYSCALL_PATH_PATTERN.exec(error.message);
    if (syscallPath !== null) {
        nodeError.syscall = syscallPath[1];
        nodeError.path = syscallPath[2];
    }
    return error;
}
