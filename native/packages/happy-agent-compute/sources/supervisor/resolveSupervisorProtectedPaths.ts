import { createRequire } from "node:module";
import { dirname, parse, sep } from "node:path";

import {
    resolveLinuxSupervisorBinary,
    resolveSupervisorBinary,
} from "@slopus/happy-agent-supervisor";

const require = createRequire(import.meta.url);

/**
 * Installed supervisor files that a restricted host command must not modify.
 *
 * The native boundary is trusted code for the next command as well as the current one. A workspace
 * may contain this package's node_modules, so leaving these paths writable would let one restricted
 * command replace the supervisor that a later command executes before its sandbox exists.
 */
export function resolveSupervisorProtectedPaths(
    supervisorBinary = resolveSupervisorBinary(),
): readonly string[] {
    const binaries = [
        supervisorBinary,
        ...(["arm64", "x64"] as const).flatMap((architecture) => {
            try {
                return [resolveLinuxSupervisorBinary(architecture)];
            } catch {
                // A host-only installation may legitimately omit a foreign Docker artifact.
                return [];
            }
        }),
    ];
    return [
        ...new Set([
            packageRootFromEntry(require.resolve("@slopus/happy-agent-supervisor")),
            ...binaries.flatMap((binary) => [binary, packageRootFromBinary(binary)]),
        ]),
    ];
}

function packageRootFromEntry(entry: string): string {
    return dirname(dirname(entry));
}

function packageRootFromBinary(binary: string): string {
    const marker = `${sep}vendor${sep}`;
    const markerIndex = binary.lastIndexOf(marker);
    if (markerIndex >= 0) return binary.slice(0, markerIndex);
    // Repository-local native builds are a development fallback. Protect their immediate output
    // directory when the published package layout is not present rather than guessing a package.
    return parse(binary).dir;
}
