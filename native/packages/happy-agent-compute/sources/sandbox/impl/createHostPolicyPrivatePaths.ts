import type { ComputeHostPolicy } from "../../ComputeHostPolicy.js";

/** Resolves the private paths an embedder declared directly or through environment variables. */
export function createHostPolicyPrivatePaths(
    hostPolicy: ComputeHostPolicy = {},
    environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
    return [
        ...(hostPolicy.privateDirectories ?? []),
        ...(hostPolicy.privatePathVariables ?? []).map((name) => environment[name]),
    ].filter(
        (path, index, paths): path is string =>
            typeof path === "string" && path.length > 0 && paths.indexOf(path) === index,
    );
}
