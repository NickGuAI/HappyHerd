import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
    MAX_WORKSPACE_NAME_LENGTH,
    MAX_WORKSPACE_STORAGE_KEY_LENGTH,
    workspaceBranchSchema,
    workspaceMigrations,
} from "../../sources/workspaces/index.js";
import { moduleDatabase } from "../support/moduleDatabase.js";
import { temporaryWorkspacesCatalog } from "../support/workspacesModule.js";

function workspaceDatabase(name: string): ReturnType<typeof moduleDatabase> {
    const database = moduleDatabase([], name);
    const ready = database.ready.then(async () => {
        for (const [, migrate] of workspaceMigrations) {
            await migrate(database.context, database.database);
        }
    });
    return { ...database, ready };
}

async function reserve(name: string, database: ReturnType<typeof workspaceDatabase>, id: string) {
    const { workspaces } = await temporaryWorkspacesCatalog();
    return {
        workspaces,
        workspace: (
            await workspaces.reserve(database.context, {
                id,
                projectRef: "project-a",
                name,
            })
        ).workspace,
    };
}

describe("WorkspacesModule edge contracts", () => {
    it("owns generated timestamps and identifiers", async () => {
        const database = workspaceDatabase("workspaces-clock-edge");
        await database.ready;
        try {
            const { workspaces } = await temporaryWorkspacesCatalog();
            const before = Date.now();
            const workspace = (
                await workspaces.reserve(database.context, {
                    projectRef: "project-a",
                    name: "Clocked workspace",
                })
            ).workspace;
            const after = Date.now();

            expect(workspace.id).toMatch(/^[^\s]+$/);
            expect(workspace.createdAt).toBe(workspace.updatedAt);
            expect(workspace.createdAt).toBeGreaterThanOrEqual(before);
            expect(workspace.createdAt).toBeLessThanOrEqual(after);
        } finally {
            database.close();
        }
    });

    it("rejects invalid availability answers instead of coercing them", async () => {
        const database = workspaceDatabase("workspaces-invalid-probe-edge");
        await database.ready;
        try {
            const { workspaces } = await temporaryWorkspacesCatalog();
            await expect(
                workspaces.reserve(
                    database.context,
                    {
                        id: "workspace-invalid-probe",
                        projectRef: "project-a",
                        name: "Invalid probe",
                    },
                    { isBranchUnavailable: (() => 0) as never },
                ),
            ).rejects.toThrow(/invalid|boolean/i);
        } finally {
            database.close();
        }
    });

    it("does not resolve a path that does not identify a workspace", async () => {
        const database = workspaceDatabase("workspaces-path-input-edge");
        await database.ready;
        try {
            const { workspaces } = await reserve("Workspace", database, "workspace-path");
            await expect(
                workspaces.getByPath(database.context, "project-a/workspace"),
            ).resolves.toBe(undefined);
        } finally {
            database.close();
        }
    });

    it("does not accept a replay that changes durable reservation details", async () => {
        const database = workspaceDatabase("workspaces-replay-settings-edge");
        await database.ready;
        try {
            const { workspaces } = await temporaryWorkspacesCatalog();
            const input = {
                id: "workspace-replay-settings",
                operationId: "create-replay-settings",
                projectRef: "project-a",
                name: "Settings",
                baseRef: "origin/main",
                baseCommit: "abcdef",
            };
            await workspaces.reserve(database.context, input);
            const { baseCommit: _baseCommit, baseRef: _baseRef, ...withoutBase } = input;

            await expect(workspaces.reserve(database.context, withoutBase)).rejects.toThrow(
                /different base|different commit/i,
            );
        } finally {
            database.close();
        }
    });

    it("applies a repeated durable rename as the requested state", async () => {
        const database = workspaceDatabase("workspaces-rename-replay-edge");
        await database.ready;
        try {
            const { workspaces, workspace } = await reserve(
                "Original",
                database,
                "workspace-rename-replay",
            );
            await workspaces.rename(database.context, {
                workspaceId: workspace.id,
                name: "First rename",
                operationId: "rename-first",
            });
            await workspaces.rename(database.context, {
                workspaceId: workspace.id,
                name: "Second rename",
                operationId: "rename-second",
            });

            const replay = await workspaces.rename(database.context, {
                workspaceId: workspace.id,
                name: "First rename",
                operationId: "rename-first",
            });
            expect(replay.name).toBe("First rename");
            await expect(workspaces.get(database.context, workspace.id)).resolves.toMatchObject({
                name: "First rename",
            });
        } finally {
            database.close();
        }
    });

    it("keeps collision suffixes inside the public name and storage schemas", async () => {
        const database = workspaceDatabase("workspaces-max-name-collision-edge");
        await database.ready;
        try {
            const { workspaces } = await temporaryWorkspacesCatalog();
            const name = "A".repeat(MAX_WORKSPACE_NAME_LENGTH);
            await workspaces.reserve(database.context, {
                id: "workspace-max-name-1",
                projectRef: "project-a",
                name,
            });
            const second = await workspaces.reserve(database.context, {
                id: "workspace-max-name-2",
                projectRef: "project-a",
                name,
                storageKeySeed: "a".repeat(MAX_WORKSPACE_STORAGE_KEY_LENGTH),
            });

            expect(second.workspace.name.length).toBeLessThanOrEqual(MAX_WORKSPACE_NAME_LENGTH);
            expect(second.workspace.storageKey.length).toBeLessThanOrEqual(
                MAX_WORKSPACE_STORAGE_KEY_LENGTH,
            );
        } finally {
            database.close();
        }
    });

    it("rejects malformed Git refs in every component", () => {
        expect(Value.Check(workspaceBranchSchema, "worktree/component./branch")).toBe(false);
        expect(Value.Check(workspaceBranchSchema, "worktree/component/branch")).toBe(true);
    });

    it("does not publish a post-commit event when an outer transaction rolls back", async () => {
        const transactional: string[] = [];
        const postCommit: string[] = [];
        const database = workspaceDatabase("workspaces-outer-rollback-edge");
        await database.ready;
        try {
            const { workspaces } = await temporaryWorkspacesCatalog();
            const transactionalUnsubscribe = workspaces.onEventTransactional((_ctx, event) => {
                transactional.push(event.type);
            });
            const postCommitUnsubscribe = workspaces.onEvent((_ctx, event) => {
                postCommit.push(event.type);
            });
            await expect(
                database.context.inTx(async (txCtx) => {
                    await workspaces.reserve(txCtx, {
                        id: "workspace-rollback",
                        projectRef: "project-a",
                        name: "Rollback",
                    });
                    throw new Error("roll back outer transaction");
                }),
            ).rejects.toThrow("roll back outer transaction");

            expect(await workspaces.get(database.context, "workspace-rollback")).toBe(undefined);
            expect(transactional).toEqual(["workspace_created"]);
            expect(postCommit).toEqual([]);
            transactionalUnsubscribe();
            postCommitUnsubscribe();
        } finally {
            database.close();
        }
    });

    it("hides a logically archived workspace from the active list", async () => {
        const database = workspaceDatabase("workspaces-archive-list-edge");
        await database.ready;
        try {
            const { workspaces, workspace } = await reserve(
                "Archive me",
                database,
                "workspace-archive-list",
            );
            const archived = await workspaces.beginArchive(database.context, workspace.id);

            expect(archived.status).toBe("archiving");
            expect(await workspaces.list(database.context)).toEqual([]);
            expect(await workspaces.list(database.context, { includeArchived: true })).toEqual([
                archived,
            ]);
        } finally {
            database.close();
        }
    });
});
