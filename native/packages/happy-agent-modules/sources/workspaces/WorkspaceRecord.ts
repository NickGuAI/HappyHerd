import type { Workspace } from "./Workspace.js";

/** Invariants the row itself must satisfy, whatever produced it. */
export function assertWorkspaceRecord(workspace: Workspace): void {
    if (workspace.updatedAt < workspace.createdAt) {
        throw new Error("Workspace timestamps are not ordered.");
    }
    assertArchivalRecord(workspace);
    // A reservation is written once, as a workspace that is still being set up and whose folder
    // nothing has created yet, and every later change advances the version. A row that is already
    // ready, failed, or present at its first version therefore describes a lifecycle that never
    // happened.
    if (
        workspace.version === 1 &&
        (workspace.status !== "initializing" || workspace.presence !== "missing")
    ) {
        throw new Error(
            "Workspace lifecycle is impossible: a workspace that has only been reserved cannot " +
                "already be ready or have a folder on disk.",
        );
    }
}

function assertArchivalRecord(workspace: Workspace): void {
    if (workspace.archivedAt === undefined) {
        if (workspace.status === "archived") {
            throw new Error("Archived workspace is missing archivedAt.");
        }
        return;
    }
    if (workspace.status !== "archived" && workspace.status !== "archiving") {
        throw new Error("Non-archived workspace has archivedAt.");
    }
    if (workspace.archivedAt < workspace.createdAt || workspace.archivedAt > workspace.updatedAt) {
        throw new Error("Workspace archivedAt is inconsistent with its timestamps.");
    }
}
