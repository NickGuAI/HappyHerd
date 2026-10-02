import { Value } from "@sinclair/typebox/value";

import {
    dockerExecutionConfigSchema,
    type DockerExecutionConfig,
} from "../DockerExecutionConfig.js";

/**
 * Asserts an unknown value is a well-formed {@link DockerExecutionConfig}.
 *
 * The exported schema is the one validation boundary for both direct callers and the provider, so
 * the accepted data shape cannot drift between two independent implementations.
 */
export function validateDockerExecutionConfig(
    config: unknown,
): asserts config is DockerExecutionConfig {
    const errors = [...Value.Errors(dockerExecutionConfigSchema, config)];
    if (errors.length === 0) return;
    const detail = errors
        .slice(0, 3)
        .map((error) => `${error.path || "/"} ${error.message}`)
        .join("; ");
    throw new Error(`Docker environment settings are not valid: ${detail}.`);
}
