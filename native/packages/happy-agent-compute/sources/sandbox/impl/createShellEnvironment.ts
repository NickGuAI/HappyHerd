import type { ComputeHostPolicy } from "../../ComputeHostPolicy.js";

export function createShellEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    hostPolicy: ComputeHostPolicy = {},
): NodeJS.ProcessEnv {
    const privateVariableNames = new Set(hostPolicy.privatePathVariables ?? []);
    return Object.fromEntries(
        Object.entries(environment).filter(
            ([name, value]) => value !== undefined && !privateVariableNames.has(name),
        ),
    );
}
