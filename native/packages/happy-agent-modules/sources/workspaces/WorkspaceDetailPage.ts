import { Type, type Static } from "@sinclair/typebox";

import { workspaceSchema } from "./Workspace.js";
import { workspaceCursorSchema } from "./WorkspacePage.js";

/**
 * A workspace row carries branch, storage, Git, and lifecycle fields that together exceed a small
 * model-output budget. Detail is exposed as a stable character stream under the module's one cursor
 * convention, so a tight budget cannot silently hide a field.
 */
export const MAX_WORKSPACE_DETAIL_PAGE_SIZE = 1_024;

export const workspaceDetailQuerySchema = Type.Object(
    {
        cursor: Type.Optional(workspaceCursorSchema),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_WORKSPACE_DETAIL_PAGE_SIZE })),
    },
    { additionalProperties: false },
);

const workspaceDetailResultSchema = Type.Object(
    {
        workspace: workspaceSchema,
        detail: Type.String({ maxLength: MAX_WORKSPACE_DETAIL_PAGE_SIZE }),
        cursor: workspaceCursorSchema,
        total: workspaceCursorSchema,
        nextCursor: Type.Optional(workspaceCursorSchema),
    },
    { additionalProperties: false },
);

/** A bounded workspace lookup result, or a stable empty result for an unknown ID. */
export const workspaceDetailPageSchema = Type.Union([
    workspaceDetailResultSchema,
    Type.Object({ workspace: Type.Null() }, { additionalProperties: false }),
]);

export type WorkspaceDetailQuery = Static<typeof workspaceDetailQuerySchema>;
export type WorkspaceDetailPage = Static<typeof workspaceDetailPageSchema>;

export type WorkspaceDetailResult = Extract<
    WorkspaceDetailPage,
    { readonly workspace: Static<typeof workspaceSchema> }
>;
