import type { TSchema } from "@sinclair/typebox";

import { toLlmParametersSchema } from "@/tools/sanitizeSchema.js";

/**
 * Converts a TypeBox schema to a plain JSON Schema object.
 * For tool parameters, this also strips regex patterns (moving constraints to descriptions)
 * so that model providers never receive unsupported pattern syntax.
 */
export function toJsonSchema(schema: TSchema): Record<string, unknown> {
    // toLlmParametersSchema does the stringify + sanitize + object enforcement.
    return toLlmParametersSchema(schema);
}
