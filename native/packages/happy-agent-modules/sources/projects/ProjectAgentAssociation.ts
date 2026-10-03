import { Type, type Static } from "@sinclair/typebox";

import { projectAgentIdSchema, projectIdSchema, projectOrderKeySchema } from "./Project.js";

/**
 * One top-level agent rooted at a project. Agent identity, configuration, and
 * archival remain in Agent Base; this is only the durable project placement.
 */
export const projectAgentAssociationSchema = Type.Object(
    {
        agentId: projectAgentIdSchema,
        projectId: projectIdSchema,
        orderKey: projectOrderKeySchema,
    },
    { additionalProperties: false },
);

/** The caller chooses the project and agent; the catalog assigns the opaque order key. */
export const projectAgentAttachmentSchema = Type.Omit(projectAgentAssociationSchema, ["orderKey"]);

export type ProjectAgentAssociation = Static<typeof projectAgentAssociationSchema>;
export type ProjectAgentAttachment = Static<typeof projectAgentAttachmentSchema>;

/** One entry in a project's ordered agent list. */
export const projectAgentOrderSchema = Type.Pick(projectAgentAssociationSchema, [
    "agentId",
    "orderKey",
]);

export type ProjectAgentOrder = Static<typeof projectAgentOrderSchema>;
