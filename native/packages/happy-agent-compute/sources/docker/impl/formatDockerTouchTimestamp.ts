/**
 * Renders a modification time in the POSIX `touch -t` format BusyBox understands.
 *
 * `touch` is the portable way to restore an mtime inside a container that may only ship BusyBox
 * coreutils, and it accepts whole seconds in the local timezone. The backend always runs `touch`
 * under `TZ=UTC0`, so this formats the components in UTC and drops sub-second precision.
 */
export function formatDockerTouchTimestamp(mtimeMs: number): string {
    const date = new Date(mtimeMs);
    if (!Number.isFinite(date.getTime())) {
        throw new Error("Could not restore an invalid Docker file modification time.");
    }

    const year = date.getUTCFullYear();
    if (year < 0 || year > 9_999) {
        throw new Error("Could not restore a Docker file modification time outside years 0-9999.");
    }

    const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = date.getUTCDate().toString().padStart(2, "0");
    const hours = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    const seconds = date.getUTCSeconds().toString().padStart(2, "0");
    return `${year.toString().padStart(4, "0")}${month}${day}${hours}${minutes}.${seconds}`;
}
