import { Type, type Static } from "@sinclair/typebox";

import { workspaceAgentIdSchema, workspaceIdSchema, workspaceOrderKeySchema } from "./Workspace.js";

/** One agent's durable place in a workspace's manually ordered agent list. */
export const workspaceAgentAssociationSchema = Type.Object(
    {
        workspaceId: workspaceIdSchema,
        agentId: workspaceAgentIdSchema,
        orderKey: workspaceOrderKeySchema,
    },
    { additionalProperties: false },
);

export const workspaceAgentAttachmentSchema = Type.Object(
    {
        workspaceId: workspaceIdSchema,
        agentId: workspaceAgentIdSchema,
    },
    { additionalProperties: false },
);

export const workspaceAgentLookupSchema = Type.Object(
    { agentId: workspaceAgentIdSchema },
    { additionalProperties: false },
);

export const workspaceAgentReorderInputSchema = Type.Object(
    {
        workspaceId: workspaceIdSchema,
        agentId: workspaceAgentIdSchema,
        afterAgentId: Type.Union([workspaceAgentIdSchema, Type.Null()]),
    },
    { additionalProperties: false },
);

export type WorkspaceAgentAssociation = Static<typeof workspaceAgentAssociationSchema>;
export type WorkspaceAgentAttachment = Static<typeof workspaceAgentAttachmentSchema>;
export type WorkspaceAgentLookup = Static<typeof workspaceAgentLookupSchema>;
export type WorkspaceAgentReorderInput = Static<typeof workspaceAgentReorderInputSchema>;

/** One entry in a workspace's ordered agent list. */
export const workspaceAgentOrderSchema = Type.Pick(workspaceAgentAssociationSchema, [
    "agentId",
    "orderKey",
]);

export type WorkspaceAgentOrder = Static<typeof workspaceAgentOrderSchema>;
