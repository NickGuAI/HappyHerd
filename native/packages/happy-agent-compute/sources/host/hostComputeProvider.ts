import { type Static, Type } from "@sinclair/typebox";

import { computeHostPolicySchema } from "../ComputeHostPolicy.js";
import type { ComputeProvider } from "../ComputeProvider.js";
import { createHostCompute } from "./createHostCompute.js";

const exact = { additionalProperties: false } as const;
const hostPolicyConfigSchema = Type.Object(computeHostPolicySchema.properties, exact);

/** Data accepted when the host backend is selected through the provider registry. */
export const hostComputeConfigSchema = Type.Object(
    {
        cwd: Type.String({ minLength: 1 }),
        hostPolicy: Type.Optional(hostPolicyConfigSchema),
    },
    exact,
);

export type HostComputeConfig = Static<typeof hostComputeConfigSchema>;

export const hostComputeProvider: ComputeProvider<typeof hostComputeConfigSchema> = {
    id: "host",
    description: "Runs commands and accesses files directly on this machine.",
    providesHostFileSystemAccess: () => true,
    configSchema: hostComputeConfigSchema,
    async create(ctx, config) {
        return createHostCompute({
            ctx,
            cwd: config.cwd,
            ...(config.hostPolicy === undefined ? {} : { hostPolicy: config.hostPolicy }),
        });
    },
};
