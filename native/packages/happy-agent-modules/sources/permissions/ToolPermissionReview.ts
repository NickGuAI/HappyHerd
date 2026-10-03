import { Type, type Static } from "@sinclair/typebox";

import { permissionUnprovenKindSchema } from "./impl/permissionRefusalMessage.js";
import { permissionRiskSchema, permissionUserAuthorizationSchema } from "./PermissionReviewer.js";

const permissionReviewReasonSchema = Type.String({ minLength: 1, maxLength: 4_096 });

/** The bounded, client-safe result of reviewing one tool call. */
export const toolPermissionReviewSchema = Type.Union([
    Type.Object(
        {
            outcome: Type.Literal("allowed"),
            reason: permissionReviewReasonSchema,
            risk: permissionRiskSchema,
            userAuthorization: permissionUserAuthorizationSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            outcome: Type.Literal("denied"),
            reason: permissionReviewReasonSchema,
            risk: permissionRiskSchema,
            userAuthorization: permissionUserAuthorizationSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            outcome: Type.Literal("unproven"),
            kind: permissionUnprovenKindSchema,
            reason: permissionReviewReasonSchema,
        },
        { additionalProperties: false },
    ),
]);

/** The bounded, client-safe result of reviewing one tool call. */
export type ToolPermissionReview = Static<typeof toolPermissionReviewSchema>;
