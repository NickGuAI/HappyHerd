import { Value } from "@sinclair/typebox/value";

import type { Project } from "./Project.js";
import { projectSettingsSchema, type ProjectSettings } from "./ProjectSettings.js";

/** Facts about a project that no operation may ever rewrite. */
const PROJECT_IMMUTABLE_FIELDS = [
    "id",
    "repositoryRef",
    "kind",
    "storageKey",
    "createdAt",
] as const satisfies readonly (keyof Project)[];

export function assertProjectSettings(value: unknown): asserts value is ProjectSettings {
    if (!Value.Check(projectSettingsSchema, value)) {
        throw new Error("Project settings are invalid.");
    }
}

/** Invariants the catalog holds for every stored project, however it was written. */
export function assertProjectRecord(project: Project): void {
    if (project.updatedAt < project.createdAt) {
        throw new Error("Project timestamps are not ordered.");
    }
    if (project.status === "archived") {
        if (project.archivedAt === undefined) {
            throw new Error("Archived project is missing its archival time.");
        }
        if (project.archivedAt < project.createdAt || project.archivedAt > project.updatedAt) {
            throw new Error("Project archival time is inconsistent with its timestamps.");
        }
    } else if (project.archivedAt !== undefined) {
        throw new Error("Active project has an archival time.");
    }
    if (project.kind === "home" && project.initializationStatus !== "ready") {
        throw new Error("The home project is never initialized.");
    }
    if (project.initializationError !== undefined && project.initializationStatus !== "failed") {
        throw new Error("Only a failed project keeps an initialization error.");
    }
    if (
        project.worktreeUnsupportedReason !== undefined &&
        project.worktreeSupport !== "unsupported"
    ) {
        throw new Error("Only a project without worktree support keeps a reason.");
    }
}

/**
 * Checks one durable write. Every operation names the fields it is allowed to
 * touch; a changed row must advance its version by exactly one, and an
 * unchanged row must be byte-identical to what was there before.
 */
export function assertProjectTransition(
    before: Project,
    after: Project,
    changeable: readonly (keyof Project)[],
): void {
    assertProjectRecord(after);
    const left = before as unknown as Record<string, unknown>;
    const right = after as unknown as Record<string, unknown>;
    for (const field of PROJECT_IMMUTABLE_FIELDS) {
        if (!sameJson(left[field], right[field])) {
            throw new Error(`A project mutation changed its durable "${field}".`);
        }
    }
    const allowed = new Set<string>([...changeable, "version", "updatedAt"]);
    for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (allowed.has(field)) continue;
        if (!sameJson(left[field], right[field])) {
            throw new Error(`A project mutation changed "${field}" outside its transition.`);
        }
    }
    if (sameJson(before, after)) return;
    if (after.version !== before.version + 1) {
        throw new Error("A changed project must advance its version by one.");
    }
    if (after.updatedAt < before.updatedAt) {
        throw new Error("A changed project moved its update time backwards.");
    }
}

export function sameJson(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

/** Stable encoding used for equality, so property order cannot fake a change. */
export function canonicalJson(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0));
    return `{${entries
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
        .join(",")}}`;
}
