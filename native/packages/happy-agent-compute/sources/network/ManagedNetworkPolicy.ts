/**
 * One project-managed network rule. The native supervisor accepts host patterns but not
 * per-host ports, so Docker rejects rules carrying `ports` before starting a restricted command.
 */
export interface ManagedNetworkRule {
    domain: string;
    ports?: readonly number[];
}

/**
 * Parsed project network policy consumed by the Docker/native-supervisor translation.
 *
 * The old compute-local proxy and interception lifecycle are intentionally not part of this
 * contract. Egress enforcement belongs to `@slopus/happy-agent-supervisor`; this value only
 * carries the project policy that must be intersected with one operation's permissions.
 */
export interface ManagedNetworkPolicy {
    allowLocalBinding?: boolean;
    allowPrivateAddresses?: boolean;
    allowedDomains?: readonly ManagedNetworkRule[];
    allowedLoopbackPorts?: readonly number[];
    deniedDomains?: readonly ManagedNetworkRule[];
}
