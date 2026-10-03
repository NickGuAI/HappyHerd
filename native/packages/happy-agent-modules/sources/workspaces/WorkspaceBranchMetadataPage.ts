import { Type, type Static } from "@sinclair/typebox";

import { workspaceBranchMetadataSchema } from "./WorkspaceBranchMetadata.js";
import { workspaceCursorSchema } from "./WorkspacePage.js";

/**
 * Branch names, heads, and upstreams are each bounded but may still exceed a small model-output
 * budget together. Keep the host result at the top level and page the human-readable detail stream
 * with the module's one cursor convention.
 */
export const MAX_WORKSPACE_BRANCH_METADATA_DETAIL_PAGE_SIZE = 1_024;

export const workspaceBranchMetadataDetailQuerySchema = Type.Object(
    {
        cursor: Type.Optional(workspaceCursorSchema),
        limit: Type.Optional(
            Type.Integer({
                minimum: 1,
                maximum: MAX_WORKSPACE_BRANCH_METADATA_DETAIL_PAGE_SIZE,
            }),
        ),
    },
    { additionalProperties: false },
);

export const workspaceBranchMetadataPageSchema = Type.Object(
    {
        ...workspaceBranchMetadataSchema.properties,
        detail: Type.String({ maxLength: MAX_WORKSPACE_BRANCH_METADATA_DETAIL_PAGE_SIZE }),
        cursor: workspaceCursorSchema,
        total: workspaceCursorSchema,
        nextCursor: Type.Optional(workspaceCursorSchema),
    },
    { additionalProperties: false },
);

export type WorkspaceBranchMetadataDetailQuery = Static<
    typeof workspaceBranchMetadataDetailQuerySchema
>;
export type WorkspaceBranchMetadataPage = Static<typeof workspaceBranchMetadataPageSchema>;
