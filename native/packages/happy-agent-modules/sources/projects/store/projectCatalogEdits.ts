import { sql } from "drizzle-orm";
import { agentDatabaseRows, agentDatabaseRun } from "@slopus/happy-agent-base";

import type { Project } from "../Project.js";
import { PROJECTS_TABLE, PROJECT_SETTINGS_TABLE } from "../ProjectMigrations.js";
import {
    parseProjectSettings,
    projectFromRow,
    type ProjectRow,
    type ProjectSettingsRow,
} from "../ProjectRow.js";
import type { ProjectStore } from "../ProjectStore.js";
import { sameJson } from "../ProjectTransition.js";
import {
    assertExpectedProjectVersion,
    databaseFor,
    requireProject,
    writeGuardedProject,
} from "./projectRecords.js";
import { deleteProjectAvatar, queryProjectAvatar, writeProjectAvatar } from "./projectAvatars.js";
import { projectOrderKeyBetween } from "./projectRootAgentOrdering.js";

/** The edits a person makes to a catalog row: its name, place, avatar and settings. */
export function createProjectCatalogEdits(): Pick<
    ProjectStore,
    "rename" | "reorder" | "setAvatar" | "clearAvatar" | "updateSettings"
> {
    return {
        rename: async (ctx, input) => {
            const database = databaseFor(ctx);
            const before = await requireProject(database, input.projectId);
            assertExpectedProjectVersion(
                before,
                input.expectedVersion,
                "The project changed before it could be renamed.",
            );
            if (before.name === input.name && before.nameSource === "user") {
                return {
                    operation: "rename",
                    changed: false,
                    project: before,
                };
            }
            const updatedAt = Date.now();
            return {
                operation: "rename",
                changed: true,
                project: await writeGuardedProject(
                    database,
                    input.projectId,
                    before.version,
                    sql`UPDATE ${sql.raw(PROJECTS_TABLE)}
                        SET name = ${input.name}, name_source = 'user',
                            updated_at = ${updatedAt}, version = version + 1
                        WHERE id = ${input.projectId} AND version = ${before.version}
                        RETURNING id`,
                    "The project changed before it could be renamed.",
                ),
            };
        },
        reorder: async (ctx, input) => {
            const database = databaseFor(ctx);
            const before = await requireProject(database, input.projectId);
            assertExpectedProjectVersion(
                before,
                input.expectedVersion,
                "The project changed before it could be reordered.",
            );
            if (input.afterId === input.projectId) {
                throw new Error("A project cannot be placed after itself.");
            }
            const rows = await agentDatabaseRows<ProjectRow>(
                database,
                sql`SELECT * FROM ${sql.raw(PROJECTS_TABLE)} ORDER BY order_key, id`,
            );
            const ordered = rows.map(projectFromRow);
            const currentIndex = ordered.findIndex((project) => project.id === input.projectId);
            if (currentIndex === -1) {
                throw new Error(`Project "${input.projectId}" was not found.`);
            }
            const withoutTarget = ordered.filter((project) => project.id !== input.projectId);
            const insertionIndex =
                input.afterId === null
                    ? 0
                    : (() => {
                          const afterIndex = withoutTarget.findIndex(
                              (project) => project.id === input.afterId,
                          );
                          if (afterIndex === -1) {
                              throw new Error(
                                  "The project to place after was not found in the catalog.",
                              );
                          }
                          return afterIndex + 1;
                      })();
            const reordered = [...withoutTarget];
            reordered.splice(insertionIndex, 0, before);
            const changed = reordered.some((project, index) => project.id !== ordered[index]?.id);
            if (!changed) {
                return {
                    operation: "reorder",
                    changed: false,
                    previousOrderKey: before.orderKey,
                    project: before,
                };
            }
            const remainingBefore = withoutTarget[insertionIndex - 1];
            const remainingAfter = withoutTarget[insertionIndex];
            const orderKey = projectOrderKeyBetween(
                remainingBefore?.orderKey ?? null,
                remainingAfter?.orderKey ?? null,
            );
            const updatedAt = Date.now();
            const moved = await writeGuardedProject(
                database,
                input.projectId,
                before.version,
                sql`UPDATE ${sql.raw(PROJECTS_TABLE)}
                    SET order_key = ${orderKey}, updated_at = ${updatedAt},
                        version = version + 1
                    WHERE id = ${input.projectId} AND version = ${before.version}
                    RETURNING id`,
                "The project changed before it could be reordered.",
            );
            return {
                operation: "reorder",
                changed: true,
                previousOrderKey: before.orderKey,
                project: moved,
            };
        },
        setAvatar: async (ctx, input) => {
            const database = databaseFor(ctx);
            const before = await requireProject(database, input.projectId);
            assertExpectedProjectVersion(
                before,
                input.expectedVersion,
                "The project changed before the avatar could be saved.",
            );
            const beforeAsset = await queryProjectAvatar(ctx, input.projectId);
            if (
                sameJson(before.avatar, input.avatar) &&
                beforeAsset?.contentHash === input.asset.contentHash
            ) {
                return {
                    operation: "set_avatar",
                    changed: false,
                    project: before,
                };
            }
            const updatedAt = Date.now();
            await writeProjectAvatar(ctx, input.projectId, input.asset);
            return {
                operation: "set_avatar",
                changed: true,
                project: await writeGuardedProject(
                    database,
                    input.projectId,
                    before.version,
                    sql`UPDATE ${sql.raw(PROJECTS_TABLE)}
                        SET avatar_json = ${JSON.stringify(input.avatar)},
                            updated_at = ${updatedAt}, version = version + 1
                        WHERE id = ${input.projectId} AND version = ${before.version}
                        RETURNING id`,
                    "The project changed before the avatar could be saved.",
                ),
            };
        },
        clearAvatar: async (ctx, input) => {
            const database = databaseFor(ctx);
            const before = await requireProject(database, input.projectId);
            assertExpectedProjectVersion(
                before,
                input.expectedVersion,
                "The project changed before the avatar could be cleared.",
            );
            if (before.avatar === undefined) {
                return {
                    operation: "clear_avatar",
                    changed: false,
                    project: before,
                };
            }
            const updatedAt = Date.now();
            await deleteProjectAvatar(ctx, input.projectId);
            return {
                operation: "clear_avatar",
                changed: true,
                project: await writeGuardedProject(
                    database,
                    input.projectId,
                    before.version,
                    sql`UPDATE ${sql.raw(PROJECTS_TABLE)}
                        SET avatar_json = ${null}, updated_at = ${updatedAt},
                            version = version + 1
                        WHERE id = ${input.projectId} AND version = ${before.version}
                        RETURNING id`,
                    "The project changed before the avatar could be cleared.",
                ),
            };
        },
        updateSettings: async (ctx, input) => {
            const database = databaseFor(ctx);
            const project = await requireProject(database, input.projectId);
            assertExpectedProjectVersion(
                project,
                input.expectedVersion,
                "The project changed before its settings could be saved.",
            );
            const rows = await agentDatabaseRows<ProjectSettingsRow>(
                database,
                sql`SELECT project_id, settings_json
                    FROM ${sql.raw(PROJECT_SETTINGS_TABLE)}
                    WHERE project_id = ${input.projectId} LIMIT 1`,
            );
            const row = rows[0];
            const before = row === undefined ? {} : parseProjectSettings(row.settings_json);
            const changed = !sameJson(before, input.settings);
            await agentDatabaseRun(
                database,
                sql`INSERT INTO ${sql.raw(PROJECT_SETTINGS_TABLE)} (project_id, settings_json)
                    VALUES (${input.projectId}, ${JSON.stringify(input.settings)})
                    ON CONFLICT (project_id) DO UPDATE
                    SET settings_json = excluded.settings_json`,
            );
            if (changed) {
                await writeGuardedProject(
                    database,
                    input.projectId,
                    project.version,
                    sql`UPDATE ${sql.raw(PROJECTS_TABLE)}
                        SET updated_at = ${Date.now()}, version = version + 1
                        WHERE id = ${input.projectId} AND version = ${project.version}
                        RETURNING id`,
                    "The project changed before its settings could be saved.",
                );
            }
            return {
                operation: "update_settings",
                changed,
                projectId: input.projectId,
                settings: structuredClone(input.settings),
                version: project.version + (changed ? 1 : 0),
            };
        },
    };
}
