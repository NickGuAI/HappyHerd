import { agentPermissionModeSchema } from "@slopus/happy-agent-base";
import { Type, type Static } from "@sinclair/typebox";
import type { Context } from "@steve.kite/stdlib";

import { permissionUnprovenKindSchema } from "./impl/permissionRefusalMessage.js";
import {
    permissionReviewTranscriptSchema,
    permissionRiskSchema,
    permissionUserAuthorizationSchema,
} from "./PermissionReviewer.js";

const permissionContextSchema = Type.Unsafe<Context>(
    Type.Object({}, { additionalProperties: false }),
);
const permissionAgentIdSchema = Type.String({ minLength: 1, maxLength: 128 });
const permissionCallIdSchema = Type.String({ minLength: 1, maxLength: 256 });
const permissionToolSchema = Type.String({ minLength: 1, maxLength: 256 });
const permissionActionSchema = Type.String({ minLength: 1, maxLength: 16_384 });
const permissionReasonSchema = Type.String({ minLength: 1, maxLength: 4_096 });

/** Everything that happened to one agent's permissions, as the module saw it. */
export const permissionEventSchema = Type.Union([
    Type.Object(
        {
            type: Type.Literal("permission_mode_changed"),
            agentId: permissionAgentIdSchema,
            previousMode: agentPermissionModeSchema,
            mode: agentPermissionModeSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("permission_mode_cleanup_failed"),
            agentId: permissionAgentIdSchema,
            previousMode: agentPermissionModeSchema,
            mode: agentPermissionModeSchema,
            reason: permissionReasonSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("permission_action_reviewed"),
            agentId: permissionAgentIdSchema,
            callId: permissionCallIdSchema,
            tool: permissionToolSchema,
            action: permissionActionSchema,
            elevated: Type.Boolean(),
            reason: permissionReasonSchema,
            risk: permissionRiskSchema,
            userAuthorization: permissionUserAuthorizationSchema,
            transcript: Type.Optional(permissionReviewTranscriptSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("permission_action_denied"),
            agentId: permissionAgentIdSchema,
            callId: permissionCallIdSchema,
            tool: permissionToolSchema,
            action: permissionActionSchema,
            reason: permissionReasonSchema,
            risk: permissionRiskSchema,
            userAuthorization: permissionUserAuthorizationSchema,
            transcript: Type.Optional(permissionReviewTranscriptSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("permission_action_unproven"),
            agentId: permissionAgentIdSchema,
            callId: permissionCallIdSchema,
            tool: permissionToolSchema,
            action: permissionActionSchema,
            kind: permissionUnprovenKindSchema,
            reason: permissionReasonSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("permission_action_out_of_mode"),
            agentId: permissionAgentIdSchema,
            callId: permissionCallIdSchema,
            tool: permissionToolSchema,
            mode: agentPermissionModeSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            type: Type.Literal("permission_turn_stopped"),
            agentId: permissionAgentIdSchema,
            consecutiveRefusals: Type.Integer({ minimum: 1 }),
            recentRefusals: Type.Integer({ minimum: 1 }),
            recentWindowLength: Type.Integer({ minimum: 1 }),
            reason: permissionReasonSchema,
        },
        { additionalProperties: false },
    ),
]);

export type PermissionEvent = Static<typeof permissionEventSchema>;

/** Runtime contract for the host listener supplied to the module. */
export const permissionModuleListenerSchema = Type.Object(
    {
        onEventTransactional: Type.Optional(
            Type.Function(
                [permissionContextSchema, permissionEventSchema],
                Type.Union([Type.Void(), Type.Promise(Type.Void())]),
            ),
        ),
        onEvent: Type.Optional(
            Type.Function(
                [permissionContextSchema, permissionEventSchema],
                Type.Union([Type.Void(), Type.Promise(Type.Void())]),
            ),
        ),
    },
    { additionalProperties: false },
);

/**
 * Whoever the permissions module reports to. Both callbacks see the same events; what differs is
 * when.
 *
 * `onEventTransactional` runs inside the transaction that commits the change it describes, which
 * only a mode change has: a listener writing a record of its own commits it with the change, and
 * its failure rolls both back. `onEvent` runs once the change is durable, and every decision about
 * a single tool call — which commits nothing — is reported only there. It may be asynchronous, and
 * the module awaits it so that a healthy host has durably recorded what happened before the run
 * settles; a listener that throws is contained and never changes the permission decision.
 */
export type PermissionModuleListener = Static<typeof permissionModuleListenerSchema>;
