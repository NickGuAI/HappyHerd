import { type Static, Type } from "@sinclair/typebox";

import { computeHostPolicySchema } from "../ComputeHostPolicy.js";
import type { ComputeProvider } from "../ComputeProvider.js";
import { createJustBashCompute } from "./createJustBashCompute.js";

const exact = { additionalProperties: false } as const;
const hostPolicyConfigSchema = Type.Object(computeHostPolicySchema.properties, exact);
const fileContentSchema = Type.Union([Type.String(), Type.Uint8Array()]);
const initialFileSchema = Type.Union([
    fileContentSchema,
    Type.Object(
        {
            content: fileContentSchema,
            mode: Type.Optional(Type.Integer({ minimum: 0 })),
            mtime: Type.Optional(Type.Date()),
        },
        exact,
    ),
]);
const memoryConfigSchema = Type.Object(
    {
        storage: Type.Literal("memory"),
        cwd: Type.String({ minLength: 1 }),
        files: Type.Optional(Type.Record(Type.String(), initialFileSchema)),
        hostPolicy: Type.Optional(hostPolicyConfigSchema),
    },
    exact,
);
const folderConfigSchema = Type.Object(
    {
        storage: Type.Literal("folder"),
        cwd: Type.String({ minLength: 1 }),
        folder: Type.String({ minLength: 1 }),
        hostPolicy: Type.Optional(hostPolicyConfigSchema),
    },
    exact,
);

/** Data accepted when the in-process backend is selected through the provider registry. */
export const justBashComputeConfigSchema = Type.Union([memoryConfigSchema, folderConfigSchema]);

export type JustBashComputeConfig = Static<typeof justBashComputeConfigSchema>;

export const justBashComputeProvider: ComputeProvider<typeof justBashComputeConfigSchema> = {
    id: "just-bash",
    description: "Runs an isolated Bash-compatible shell entirely inside this process.",
    providesHostFileSystemAccess: (config) => config.storage === "folder",
    configSchema: justBashComputeConfigSchema,
    async create(_ctx, config) {
        return createJustBashCompute(config);
    },
};
