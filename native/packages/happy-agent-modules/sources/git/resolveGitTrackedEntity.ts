import { Type, type Static } from "@sinclair/typebox";

import type { GitTrackedEntity } from "./types.js";

export const trackedProjectSchema = Type.Object(
    {
        id: Type.String({ minLength: 1 }),
        path: Type.String({ minLength: 1 }),
        presence: Type.Union([Type.Literal("present"), Type.Literal("missing")]),
    },
    { additionalProperties: true },
);
export type TrackedProject = Static<typeof trackedProjectSchema>;

export const trackedWorkspaceSchema = Type.Object(
    {
        id: Type.String({ minLength: 1 }),
        path: Type.String({ minLength: 1 }),
        presence: Type.Union([Type.Literal("present"), Type.Literal("missing")]),
        projectId: Type.String({ minLength: 1 }),
        status: Type.String(),
    },
    { additionalProperties: true },
);
export type TrackedWorkspace = Static<typeof trackedWorkspaceSchema>;

export function resolveGitTrackedEntity(
    project: TrackedProject,
    workspace?: TrackedWorkspace,
): GitTrackedEntity | undefined {
    if (workspace === undefined) {
        return project.presence === "present"
            ? { path: project.path, projectId: project.id }
            : undefined;
    }
    return workspace.status === "ready" && workspace.presence === "present"
        ? {
              path: workspace.path,
              projectId: workspace.projectId,
              workspaceId: workspace.id,
          }
        : undefined;
}
