import type Dockerode from "dockerode";
import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "../Compute.js";
import { EMPTY_COMPUTE_HOST_POLICY, type ComputeHostPolicy } from "../ComputeHostPolicy.js";
import { runCleanupSteps } from "../sandbox/impl/runCleanupSteps.js";
import { createDockerFileSystem } from "./createDockerFileSystem.js";
import { createDockerShell } from "./createDockerShell.js";
import { DockerEnvironment } from "./DockerEnvironment.js";
import type { DockerExecutionConfig } from "./DockerExecutionConfig.js";
import type { ParseDockerProjectNetworkConfig } from "./impl/loadDockerProjectManagedNetworkPolicy.js";
import { snapshotDockerHostPolicy } from "./impl/resolveDockerHostPolicy.js";

/** How a Docker compute is constructed. */
export interface DockerComputeOptions {
    /** Which container to attach to or image to start, and the fixed working directory. */
    readonly docker: DockerExecutionConfig;
    /** Identifies the session, so a managed container is named and labelled for it. */
    readonly sessionId: string;
    /** Product-owned paths and project files this compute must protect. */
    readonly hostPolicy?: ComputeHostPolicy;
    /** Environment variables injected into every command, such as the session's Git identity. */
    readonly environment?: Readonly<Record<string, string>>;
    /** Interprets a project config file into a managed-network configuration. */
    readonly parseNetworkConfig?: ParseDockerProjectNetworkConfig;
    /** A pre-built dockerode client, mainly so tests can supply a fake. */
    readonly client?: Dockerode;
}

/**
 * Creates a Docker compute: one filesystem and shell inside a container, with the working directory
 * fixed at construction.
 *
 * The container is resolved lazily on first use, so building a compute never blocks on the daemon.
 * Every operation brings its own immutable permission value. Disposing the compute stops every
 * command it left running and releases its container ownership; the last owner removes a managed
 * container, while a container the caller attached remains untouched.
 */
export function createDockerCompute(options: DockerComputeOptions): Compute {
    const hostPolicy = snapshotDockerHostPolicy(
        options.hostPolicy ?? options.docker.hostPolicy ?? EMPTY_COMPUTE_HOST_POLICY,
    );
    const environment =
        options.client === undefined
            ? new DockerEnvironment(options.docker, options.sessionId)
            : new DockerEnvironment(options.docker, options.sessionId, options.client);
    const shell = createDockerShell(environment, {
        hostPolicy,
        ...(options.environment === undefined ? {} : { baseEnvironment: options.environment }),
        ...(options.parseNetworkConfig === undefined
            ? {}
            : { parseNetworkConfig: options.parseNetworkConfig }),
    });

    return {
        id: "docker",
        kind: "docker",
        cwd: environment.config.workingDirectory,
        fs: createDockerFileSystem(environment, hostPolicy),
        shell,
        async dispose(_ctx: Context) {
            shell.setSessionExitListener?.(undefined);
            shell.setActiveSessionCountListener?.(undefined);
            await runCleanupSteps("Docker compute", [
                async () => {
                    await shell.killAllSessions?.();
                },
                () => environment.release(),
            ]);
        },
    };
}
