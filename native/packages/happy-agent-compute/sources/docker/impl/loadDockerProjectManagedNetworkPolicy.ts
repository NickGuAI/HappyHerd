import { posix } from "node:path";

import type Dockerode from "dockerode";

import type { ManagedNetworkConfig } from "../../network/loadProjectManagedNetworkPolicy.js";
import { toManagedNetworkPolicy } from "../../network/loadProjectManagedNetworkPolicy.js";
import type { ManagedNetworkPolicy } from "../../network/ManagedNetworkPolicy.js";
import { runDockerExec } from "./runDockerExec.js";

/** One caller-declared project file that can grant network access. */
export interface DockerProjectNetworkPolicyFile {
    name: string;
    text: string;
}

/**
 * Interprets the caller's network-policy files.
 *
 * The embedder owns their format and merge order, so the Docker backend provides the validated
 * root file names and their raw text without assuming a product or configuration language.
 */
export type ParseDockerProjectNetworkConfig = (
    files: readonly DockerProjectNetworkPolicyFile[],
) => ManagedNetworkConfig | undefined | Promise<ManagedNetworkConfig | undefined>;

export interface DockerProjectManagedNetworkPolicyLifecycle {
    /**
     * Claims ownership of a newly created placeholder before the project parser runs. The caller
     * can then coordinate cleanup with other commands that share the same container.
     */
    onPlaceholderCreated?: (networkPolicyFile: string) => void | Promise<void>;
}

/** What the backend learned while fixing a command's project network boundary. */
export interface DockerProjectManagedNetworkPolicyState {
    absentNetworkPolicyFiles: readonly string[];
    placeholderNetworkPolicyFile?: string;
    policy: ManagedNetworkPolicy | undefined;
    readyNetworkPolicyFiles: readonly string[];
}

/**
 * Reads every declared network-policy file and atomically reserves the first when all are absent.
 *
 * A restricted command sees ready files through read-only mounts. When no policy exists, the empty
 * hard-linked placeholder closes the creation race before the command's missing-path monitor starts.
 * The marker lives below the already protected project root, so the command cannot replace it.
 */
export async function loadDockerProjectManagedNetworkPolicyState(
    container: Dockerode.Container,
    cwd: string,
    projectRoot: string,
    placeholderMarkerPath: string,
    networkPolicyFiles: readonly string[],
    parseNetworkConfig?: ParseDockerProjectNetworkConfig,
    lifecycle: DockerProjectManagedNetworkPolicyLifecycle = {},
): Promise<DockerProjectManagedNetworkPolicyState> {
    if (networkPolicyFiles.length === 0) {
        return {
            absentNetworkPolicyFiles: [],
            policy: undefined,
            readyNetworkPolicyFiles: [],
        };
    }
    const paths = networkPolicyFiles.map((name) => projectFilePath(cwd, name));
    const result = await runDockerExec(container, [
        "/bin/sh",
        "-c",
        [
            "project_root=$1",
            "marker=$2",
            "shift 2",
            'case "$marker" in "$project_root"/.policy-*) ;; *) exit 46 ;; esac',
            '[ -d "$project_root" ] && [ ! -L "$project_root" ] || exit 47',
            "found=0",
            'for path do [ ! -L "$path" ] || exit 48; [ -f "$path" ] && found=1; done',
            "placeholder=0",
            'if [ "$found" -eq 0 ]; then',
            '  if (umask 077; set -C; : > "$marker") 2>/dev/null; then',
            '    if ln "$marker" "$1" 2>/dev/null; then',
            "      placeholder=1",
            "    else",
            '      rm -f -- "$marker"',
            '      for path do [ ! -L "$path" ] || exit 48; [ -f "$path" ] && found=1; done',
            '      [ "$found" -eq 1 ] || exit 44',
            "    fi",
            "  else",
            "    exit 45",
            "  fi",
            "fi",
            'if [ "$placeholder" -eq 1 ]; then printf "P"; else printf "N"; fi',
            "for path do",
            '  if [ -L "$path" ]; then exit 48; elif [ -f "$path" ]; then',
            '    printf "F\\0"; cat "$path"; printf "\\0"',
            "  else",
            '    printf "A\\0\\0"',
            "  fi",
            "done",
        ].join("\n"),
        "compute-policy",
        projectRoot,
        placeholderMarkerPath,
        ...paths,
    ]);
    if (result.exitCode !== 0 || result.stdout.length === 0) {
        throw new Error("Could not read the Docker project's network policy.");
    }
    const parsed = parseDockerNetworkPolicyOutput(result.stdout, networkPolicyFiles);
    const placeholderNetworkPolicyFile = parsed.placeholderCreated
        ? networkPolicyFiles[0]
        : undefined;
    let placeholderClaimed = false;
    try {
        if (
            placeholderNetworkPolicyFile !== undefined &&
            lifecycle.onPlaceholderCreated !== undefined
        ) {
            placeholderClaimed = true;
            await lifecycle.onPlaceholderCreated(placeholderNetworkPolicyFile);
        }
        const network =
            parseNetworkConfig === undefined ? undefined : await parseNetworkConfig(parsed.files);
        return {
            absentNetworkPolicyFiles: parsed.absent,
            ...(placeholderNetworkPolicyFile === undefined ? {} : { placeholderNetworkPolicyFile }),
            policy: toManagedNetworkPolicy(network),
            readyNetworkPolicyFiles: parsed.ready,
        };
    } catch (error) {
        if (placeholderNetworkPolicyFile !== undefined && !placeholderClaimed) {
            await cleanupDockerNetworkPolicyPlaceholder(
                container,
                cwd,
                projectRoot,
                placeholderMarkerPath,
                placeholderNetworkPolicyFile,
            ).catch(() => undefined);
        }
        throw error;
    }
}

/** Parses the NUL-framed output emitted by the policy-loading container command. */
export function parseDockerNetworkPolicyOutput(
    output: Uint8Array,
    networkPolicyFiles: readonly string[],
): {
    absent: readonly string[];
    files: readonly DockerProjectNetworkPolicyFile[];
    placeholderCreated: boolean;
    ready: readonly string[];
} {
    const bytes = Buffer.from(output);
    const marker = bytes.subarray(0, 1).toString("utf8");
    if (marker !== "N" && marker !== "P") {
        throw new Error("Could not identify the Docker project's network policy.");
    }
    const fields = bytes.subarray(1).toString("utf8").split("\0");
    if (fields.length !== networkPolicyFiles.length * 2 + 1 || fields.at(-1) !== "") {
        throw new Error("Docker returned incomplete network-policy file data.");
    }
    const absent: string[] = [];
    const files: DockerProjectNetworkPolicyFile[] = [];
    const ready: string[] = [];
    for (const [index, name] of networkPolicyFiles.entries()) {
        const status = fields[index * 2];
        const text = fields[index * 2 + 1];
        if (status === "A" && text === "") {
            absent.push(name);
        } else if (status === "F" && text !== undefined) {
            files.push({ name, text });
            ready.push(name);
        } else {
            throw new Error("Docker returned incomplete network-policy file data.");
        }
    }
    return { absent, files, placeholderCreated: marker === "P", ready };
}

/** Removes an unchanged empty policy placeholder owned by one command. */
export async function cleanupDockerNetworkPolicyPlaceholder(
    container: Dockerode.Container,
    cwd: string,
    projectRoot: string,
    placeholderMarkerPath: string,
    networkPolicyFile: string,
): Promise<void> {
    const path = projectFilePath(cwd, networkPolicyFile);
    const result = await runDockerExec(container, [
        "/bin/sh",
        "-c",
        [
            "path=$1",
            "project_root=$2",
            "marker=$3",
            'case "$marker" in "$project_root"/.policy-*) ;; *) exit 46 ;; esac',
            '[ -d "$project_root" ] && [ ! -L "$project_root" ] || exit 47',
            'if [ -f "$marker" ]; then',
            '  if [ ! -f "$path" ] || [ ! "$path" -ef "$marker" ]; then exit 48; fi',
            '  if [ ! -s "$path" ]; then rm -f -- "$path"; fi',
            '  rm -f -- "$marker"',
            "fi",
        ].join("\n"),
        "compute-policy-cleanup",
        path,
        projectRoot,
        placeholderMarkerPath,
    ]);
    if (result.exitCode !== 0) {
        throw new Error("Could not remove the temporary Docker network-policy placeholder.");
    }
}

function projectFilePath(cwd: string, name: string): string {
    if (
        name.length === 0 ||
        posix.isAbsolute(name) ||
        posix.dirname(name) !== "." ||
        name === "." ||
        name === ".."
    ) {
        throw new Error(`Docker network-policy file '${name}' must be a root file name.`);
    }
    return posix.join(cwd, name);
}
