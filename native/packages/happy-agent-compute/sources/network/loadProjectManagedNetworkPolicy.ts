import type { ManagedNetworkPolicy } from "./ManagedNetworkPolicy.js";

/**
 * A repository's network configuration, as a project config file expresses it.
 *
 * Reading and merging project policy files is config machinery that lives in the agent layer
 * above the compute. The compute takes the already-parsed configuration and turns it into an
 * enforceable policy.
 */
export interface ManagedNetworkConfig {
    allowLocalBinding?: boolean;
    allowedDomains?: readonly string[];
    allowedLoopbackPorts?: readonly number[];
    allowedPorts?: readonly number[];
    deniedDomains?: readonly string[];
}

/**
 * Resolve a repository's managed network policy from its parsed configuration.
 *
 * The `loadNetworkConfig` callback is injected because reading and merging the project's config
 * files is the agent layer's responsibility; the compute only decides what the resulting policy
 * means for the sandbox. Passing a fresh loader keeps the boundary honest — the root config is
 * re-read on every command rather than cached, so a later command sees policy the user just added.
 */
export async function loadProjectManagedNetworkPolicy(
    cwd: string,
    loadNetworkConfig: (cwd: string) => Promise<ManagedNetworkConfig | undefined>,
): Promise<ManagedNetworkPolicy | undefined> {
    return toManagedNetworkPolicy(await loadNetworkConfig(cwd));
}

export function toManagedNetworkPolicy(
    network: ManagedNetworkConfig | undefined,
): ManagedNetworkPolicy | undefined {
    if (network === undefined) return undefined;
    const ports = network.allowedPorts ?? [443];
    return {
        ...(network.allowLocalBinding === undefined
            ? {}
            : { allowLocalBinding: network.allowLocalBinding }),
        ...(network.allowedDomains === undefined
            ? {}
            : {
                  allowedDomains: network.allowedDomains.map((domain) => ({ domain, ports })),
              }),
        ...(network.deniedDomains === undefined
            ? {}
            : {
                  deniedDomains: network.deniedDomains.map((domain) => ({ domain })),
              }),
        ...(network.allowedLoopbackPorts === undefined
            ? {}
            : { allowedLoopbackPorts: network.allowedLoopbackPorts }),
    };
}
