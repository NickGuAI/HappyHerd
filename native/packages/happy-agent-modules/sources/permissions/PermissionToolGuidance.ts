import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";

const MAX_TOOL_PERMISSION_INSTRUCTIONS = 8_192;
const MAX_TOOL_PERMISSION_GUIDANCE_ITEMS = 256;

/**
 * The only part of a tool the permissions prompt needs. Keeping this boundary structural lets
 * the host provide the currently active tools without making the permissions module know how
 * another module assembles or executes them.
 */
export const permissionToolGuidanceSchema = Type.Object(
    {
        autoPermissionInstructions: Type.Optional(
            Type.String({ maxLength: MAX_TOOL_PERMISSION_INSTRUCTIONS }),
        ),
    },
    { additionalProperties: false },
);

export type PermissionToolGuidance = Static<typeof permissionToolGuidanceSchema>;
export const permissionToolGuidancesSchema = Type.Unsafe<readonly PermissionToolGuidance[]>(
    Type.Array(permissionToolGuidanceSchema, {
        maxItems: MAX_TOOL_PERMISSION_GUIDANCE_ITEMS,
    }),
);

export type PermissionToolGuidances = Static<typeof permissionToolGuidancesSchema>;

/** Merge independently bounded host sources without allowing duplicates to overflow the aggregate. */
export function mergePermissionToolGuidances(
    sources: readonly (readonly PermissionToolGuidance[])[],
): PermissionToolGuidances {
    const merged: PermissionToolGuidance[] = [];
    const seen = new Set<string>();
    for (const source of sources) {
        if (!Value.Check(permissionToolGuidancesSchema, source)) {
            throw new Error("Permission tool guidance is invalid.");
        }
        for (const tool of source) {
            const instruction = tool.autoPermissionInstructions;
            if (instruction === undefined || seen.has(instruction)) continue;
            seen.add(instruction);
            merged.push({ autoPermissionInstructions: instruction });
            if (merged.length === MAX_TOOL_PERMISSION_GUIDANCE_ITEMS) return merged;
        }
    }
    return merged;
}

const permissionContextSchema = Type.Unsafe<Context>(
    Type.Object({}, { additionalProperties: false }),
);
const permissionAgentIdSchema = Type.String({ minLength: 1, maxLength: 128 });

/** Host-owned source for the tools active on one agent at the next inference. */
export const permissionToolGuidanceProviderSchema = Type.Function(
    [permissionContextSchema, permissionAgentIdSchema],
    Type.Union([permissionToolGuidancesSchema, Type.Promise(permissionToolGuidancesSchema)]),
);

export type PermissionToolGuidanceProvider = Static<typeof permissionToolGuidanceProviderSchema>;

export { MAX_TOOL_PERMISSION_GUIDANCE_ITEMS, MAX_TOOL_PERMISSION_INSTRUCTIONS };
