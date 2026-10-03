import { posix } from "node:path";

import type { ComputeHostPolicy } from "../../ComputeHostPolicy.js";
import type { DockerEnvironment } from "../DockerEnvironment.js";

/** Copies caller-owned policy arrays so later caller mutation cannot change a live compute. */
export function snapshotDockerHostPolicy(policy: ComputeHostPolicy): ComputeHostPolicy {
    return {
        ...(policy.protectedProjectFiles === undefined
            ? {}
            : { protectedProjectFiles: [...policy.protectedProjectFiles] }),
        ...(policy.networkPolicyFiles === undefined
            ? {}
            : { networkPolicyFiles: [...policy.networkPolicyFiles] }),
        ...(policy.privateDirectories === undefined
            ? {}
            : { privateDirectories: [...policy.privateDirectories] }),
        ...(policy.readableDirectories === undefined
            ? {}
            : { readableDirectories: [...policy.readableDirectories] }),
        ...(policy.privatePathVariables === undefined
            ? {}
            : { privatePathVariables: [...policy.privatePathVariables] }),
    };
}

/** The declared root files whose creation or modification changes the product boundary. */
export function dockerProtectedProjectFileNames(policy: ComputeHostPolicy): readonly string[] {
    return unique([
        ...(policy.protectedProjectFiles ?? []),
        ...(policy.networkPolicyFiles ?? []),
    ]).map(assertProjectFileName);
}

/** The declared root files whose contents can grant network access. */
export function dockerNetworkPolicyFileNames(policy: ComputeHostPolicy): readonly string[] {
    return unique(policy.networkPolicyFiles ?? []).map(assertProjectFileName);
}

/** Absolute caller-owned directories that remain read-only for a restricted operation. */
export function dockerReadableDirectories(policy: ComputeHostPolicy): readonly string[] {
    return unique(policy.readableDirectories ?? []).map(assertAbsolutePolicyPath);
}

/**
 * Resolves every caller-owned private directory, including paths named by container environment
 * variables. Values are inspected only for variables the caller explicitly declared as paths.
 */
export async function resolveDockerPrivateDirectories(
    environment: DockerEnvironment,
    policy: ComputeHostPolicy,
    commandEnvironment: Readonly<Record<string, string>> = {},
): Promise<readonly string[]> {
    const variables = new Set(policy.privatePathVariables ?? []);
    const configuredValues = new Map<string, string>();
    if (variables.size > 0) {
        const details = await (await environment.container()).inspect();
        for (const entry of details.Config.Env ?? []) {
            const separator = entry.indexOf("=");
            if (separator < 1) continue;
            const name = entry.slice(0, separator);
            if (variables.has(name)) configuredValues.set(name, entry.slice(separator + 1));
        }
    }
    for (const [name, value] of Object.entries(commandEnvironment)) {
        if (variables.has(name)) configuredValues.set(name, value);
    }
    return unique([
        ...(policy.privateDirectories ?? []).map(assertAbsolutePolicyPath),
        ...[...configuredValues.values()].map((value) =>
            posix.isAbsolute(value)
                ? posix.normalize(value)
                : posix.resolve(environment.config.workingDirectory, value),
        ),
    ]);
}

function assertProjectFileName(name: string): string {
    if (
        name.length === 0 ||
        posix.isAbsolute(name) ||
        posix.dirname(name) !== "." ||
        name === "." ||
        name === ".."
    ) {
        throw new Error(`Docker project policy file '${name}' must be a root file name.`);
    }
    return name;
}

function assertAbsolutePolicyPath(path: string): string {
    if (!posix.isAbsolute(path)) {
        throw new Error(`Docker host-policy path '${path}' must be absolute.`);
    }
    return posix.normalize(path);
}

function unique(values: readonly string[]): string[] {
    return values.filter((value, index) => values.indexOf(value) === index);
}
