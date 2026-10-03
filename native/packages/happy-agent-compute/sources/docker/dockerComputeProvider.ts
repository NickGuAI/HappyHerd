import { randomUUID } from "node:crypto";

import Dockerode from "dockerode";

import type { ComputeProvider } from "../ComputeProvider.js";
import { createDockerCompute } from "./createDockerCompute.js";
import {
    dockerExecutionConfigSchema,
    type DockerExecutionConfig,
} from "./DockerExecutionConfig.js";

const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";

/** Creates the live Docker client a provider uses for one compute. */
export type DockerClientFactory = (config: DockerExecutionConfig) => Dockerode;

/**
 * Builds a Docker provider around its only live dependency.
 *
 * Provider configuration remains plain validated data. The Dockerode object is process state, so a
 * caller that needs a custom daemon connection supplies a factory when registering the provider
 * instead of trying to serialize a client into a config file or protocol message.
 */
export function createDockerComputeProvider(
    clientFactory: DockerClientFactory = (config) =>
        new Dockerode({ socketPath: config.socketPath ?? DEFAULT_DOCKER_SOCKET }),
): ComputeProvider<typeof dockerExecutionConfigSchema> {
    return {
        id: "docker",
        description: "Runs the agent inside a managed Docker image or an existing container.",
        configSchema: dockerExecutionConfigSchema,
        providesHostFileSystemAccess(config) {
            return config.container !== undefined || (config.mounts?.length ?? 0) > 0;
        },
        async create(_ctx, config) {
            return createDockerCompute({
                client: clientFactory(config),
                docker: config,
                ...(config.hostPolicy === undefined ? {} : { hostPolicy: config.hostPolicy }),
                sessionId: randomUUID(),
            });
        },
    };
}

/** The ordinary Docker provider, connected through the configured or default Docker socket. */
export const dockerComputeProvider = createDockerComputeProvider();
