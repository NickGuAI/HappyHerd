import type { ComputePermissions } from "../../ComputePermissions.js";
import type { ManagedNetworkPolicy } from "../../network/ManagedNetworkPolicy.js";

/**
 * Maps one operation's independent egress and listener grants onto Docker's two network paths.
 *
 * Direct container networking is safe whenever egress has no host or project allow-list. The
 * native supervisor enforces local-binding denial independently, so withholding listeners does
 * not require a separate proxy solely because localBinding is false. The returned intermediate
 * policy is translated into the native supervisor's network policy by the Docker shell.
 */
export function resolveDockerNetworkPermissions(
    permissions: ComputePermissions,
    projectPolicy?: ManagedNetworkPolicy,
): {
    directEgress: boolean;
    managedPolicy: ManagedNetworkPolicy | undefined;
} {
    const allowedHosts = permissions.network.allowedHosts ?? [];
    if (allowedHosts.includes("*")) {
        throw new Error(
            "Docker network allowedHosts cannot contain a bare '*'; leave allowedHosts empty for open egress.",
        );
    }
    if (!permissions.network.egress) {
        return { directEgress: false, managedPolicy: undefined };
    }
    // A present project policy is an allow-list even when it names no destinations. Treating an
    // empty policy as absent would silently turn deny-all into unrestricted container networking.
    const projectHostRestriction = projectPolicy !== undefined;
    const directEgress = allowedHosts.length === 0 && !projectHostRestriction;
    if (directEgress) return { directEgress: true, managedPolicy: undefined };

    const operationRules =
        allowedHosts.length === 0 ? [{ domain: "*" }] : allowedHosts.map((domain) => ({ domain }));
    return {
        directEgress: false,
        managedPolicy: {
            ...(allowedHosts.length === 0 && projectPolicy === undefined
                ? { allowPrivateAddresses: true }
                : {}),
            allowedDomains:
                projectPolicy === undefined
                    ? operationRules
                    : intersectDockerNetworkRules(
                          operationRules,
                          projectPolicy.allowedDomains ?? [],
                      ),
            ...(projectPolicy?.allowedLoopbackPorts === undefined
                ? {}
                : { allowedLoopbackPorts: projectPolicy.allowedLoopbackPorts }),
            ...(projectPolicy?.deniedDomains === undefined
                ? {}
                : { deniedDomains: projectPolicy.deniedDomains }),
        },
    };
}

function intersectDockerNetworkRules(
    operationRules: readonly { domain: string }[],
    projectRules: readonly { domain: string; ports?: readonly number[] }[],
): readonly { domain: string; ports?: readonly number[] }[] {
    return projectRules.flatMap((projectRule) =>
        operationRules.flatMap((operationRule) => {
            const domain = intersectDomainPattern(operationRule.domain, projectRule.domain);
            return domain === undefined
                ? []
                : [
                      {
                          domain,
                          ...(projectRule.ports === undefined ? {} : { ports: projectRule.ports }),
                      },
                  ];
        }),
    );
}

function intersectDomainPattern(left: string, right: string): string | undefined {
    const normalizedLeft = left.trim().toLowerCase().replace(/\.$/u, "");
    const normalizedRight = right.trim().toLowerCase().replace(/\.$/u, "");
    if (normalizedLeft === "*") return normalizedRight;
    if (normalizedRight === "*") return normalizedLeft;
    if (normalizedLeft.startsWith("*.") && normalizedRight.startsWith("*.")) {
        if (normalizedLeft.endsWith(normalizedRight.slice(1))) return normalizedLeft;
        if (normalizedRight.endsWith(normalizedLeft.slice(1))) return normalizedRight;
        return undefined;
    }
    if (domainPatternContains(normalizedLeft, normalizedRight)) return normalizedRight;
    if (domainPatternContains(normalizedRight, normalizedLeft)) return normalizedLeft;
    return undefined;
}

function domainPatternContains(pattern: string, candidate: string): boolean {
    if (pattern === candidate) return true;
    if (!pattern.startsWith("*.") || candidate.startsWith("*.")) return false;
    return candidate.length > pattern.length - 1 && candidate.endsWith(pattern.slice(1));
}
