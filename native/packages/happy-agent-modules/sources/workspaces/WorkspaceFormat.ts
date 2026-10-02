import type { Workspace } from "./Workspace.js";
import type { WorkspaceBranchMetadata } from "./WorkspaceBranchMetadata.js";
import {
    MAX_WORKSPACE_BRANCH_METADATA_DETAIL_PAGE_SIZE,
    type WorkspaceBranchMetadataPage,
} from "./WorkspaceBranchMetadataPage.js";
import {
    MAX_WORKSPACE_DETAIL_PAGE_SIZE,
    type WorkspaceDetailResult,
} from "./WorkspaceDetailPage.js";
import type { WorkspacePage } from "./WorkspacePage.js";

/**
 * Everything a person or a model reads about a workspace.
 *
 * Statuses and kinds are written the way someone would say them out loud; the raw values are
 * storage, not language. Identifiers appear only where they are labelled as identifiers.
 */
export function workspaceStatusText(workspace: Workspace): string {
    switch (workspace.status) {
        case "initializing":
            return "being set up";
        case "ready":
            return "ready";
        case "failed":
            return "failed";
        case "archiving":
            return "archived, cleanup still running";
        case "archived":
            return "archived";
    }
}

export function workspaceKindText(workspace: Workspace): string {
    return workspace.kind === "git_worktree" ? "Git worktree" : "copied folder";
}

/**
 * One list row: what it is called, how it is doing, and where to find it.
 *
 * When the budget is too small for all of that, the row gives up the parts a reader can look up
 * again — the branch and the path, then the name — rather than the ID, which is the one thing every
 * later call needs.
 */
export function workspaceRow(workspace: Workspace, maxCharacters: number): string {
    const status = workspaceStatusText(workspace);
    const prefix = `${workspace.name} — ${status}`;
    const rows = [
        `${prefix}\nBranch: ${workspace.branch} · Path: ${workspace.path} · ID: ${workspace.id}`,
        `${prefix}\nID: ${workspace.id}`,
        `ID: ${workspace.id} — ${status}`,
    ];
    return rows.find((row) => row.length <= maxCharacters) ?? rows[rows.length - 1]!;
}

export function workspaceDetailText(workspace: Workspace): string {
    return [
        `Workspace ID: ${workspace.id}`,
        `Name: ${workspace.name}`,
        `Name chosen deliberately: ${workspace.nameConfigured ? "yes" : "not yet"}`,
        `Status: ${workspaceStatusText(workspace)}`,
        `Kind: ${workspaceKindText(workspace)}`,
        `Branch: ${workspace.branch}`,
        `Project ref: ${workspace.projectRef}`,
        `Path: ${workspace.path}`,
        `Folder present: ${workspace.presence === "present" ? "yes" : "no"}`,
        `Base ref: ${workspace.baseRef ?? "(none)"}`,
        `Base commit: ${workspace.baseCommit ?? "(not resolved yet)"}`,
        `Shared Git directory: ${workspace.gitCommonDir ?? "(not resolved yet)"}`,
        `Git head: ${workspace.gitHead ?? "(unavailable)"}`,
        `Git upstream: ${workspace.gitUpstream ?? "(none)"}`,
        `Ahead: ${String(workspace.gitAhead)}`,
        `Behind: ${String(workspace.gitBehind)}`,
        `Detached: ${workspace.gitDetached ? "yes" : "no"}`,
        ...(workspace.creatorSessionId === undefined
            ? []
            : [`Created by session: ${workspace.creatorSessionId}`]),
        `Order key: ${workspace.orderKey}`,
        `Version: ${String(workspace.version)}`,
        `Setup attempts: ${String(workspace.initializationAttempt)}`,
        ...(workspace.initializationError === undefined
            ? []
            : [`Last failure: ${workspace.initializationError}`]),
        `Created at: ${String(workspace.createdAt)}`,
        `Updated at: ${String(workspace.updatedAt)}`,
        ...(workspace.archivedAt === undefined
            ? []
            : [`Archived at: ${String(workspace.archivedAt)}`]),
    ].join("\n");
}

export function workspaceBranchMetadataDetailText(metadata: WorkspaceBranchMetadata): string {
    return [
        `Workspace ID: ${metadata.workspaceId}`,
        `Branch: ${metadata.branch ?? "(detached or unavailable)"}`,
        `Head: ${metadata.head ?? "(unavailable)"}`,
        `Upstream: ${metadata.upstream ?? "(none)"}`,
        `Ahead: ${String(metadata.ahead)}`,
        `Behind: ${String(metadata.behind)}`,
        `Detached: ${metadata.detached ? "yes" : "no"}`,
    ].join("\n");
}

/** Keeps only the rows whose complete identity fits the model-output budget. */
export function fitPageForModel(page: WorkspacePage, maxOutputCharacters: number): WorkspacePage {
    if (page.workspaces.length === 0) return page;
    const continuationLength = (next: number): number =>
        `More workspaces at cursor ${String(next)}.`.length + 1;
    const visible: Workspace[] = [];
    let size = 0;
    for (const workspace of page.workspaces) {
        const row = workspaceRow(workspace, maxOutputCharacters);
        const nextSize = size + row.length + (visible.length === 0 ? 0 : 1);
        const candidateCount = visible.length + 1;
        const needsContinuation =
            page.nextCursor !== undefined || candidateCount < page.workspaces.length;
        const continuation = needsContinuation
            ? continuationLength(page.cursor + candidateCount)
            : 0;
        if (nextSize + continuation > maxOutputCharacters) break;
        visible.push(workspace);
        size = nextSize;
    }
    if (visible.length === 0) {
        throw new Error(
            "Workspace page cannot expose a complete identity within the output budget.",
        );
    }
    const consumedAll = visible.length === page.workspaces.length;
    const nextCursor =
        consumedAll && page.nextCursor === undefined ? undefined : page.cursor + visible.length;
    return {
        workspaces: visible,
        cursor: page.cursor,
        ...(nextCursor === undefined ? {} : { nextCursor }),
    };
}

export function firstWorkspaceDetailPage(
    workspace: Workspace,
    maxOutputCharacters: number,
): WorkspaceDetailResult {
    const detail = workspaceDetailText(workspace);
    return fitWorkspaceDetailPage(
        {
            workspace: structuredClone(workspace),
            detail: detail.slice(0, MAX_WORKSPACE_DETAIL_PAGE_SIZE),
            cursor: 0,
            total: detail.length,
            ...(detail.length > MAX_WORKSPACE_DETAIL_PAGE_SIZE
                ? { nextCursor: MAX_WORKSPACE_DETAIL_PAGE_SIZE }
                : {}),
        },
        maxOutputCharacters,
    );
}

export function fitWorkspaceDetailPage(
    page: WorkspaceDetailResult,
    maxOutputCharacters: number,
): WorkspaceDetailResult {
    let detail = page.detail;
    for (;;) {
        const candidate: WorkspaceDetailResult = {
            workspace: page.workspace,
            detail,
            cursor: page.cursor,
            total: page.total,
            ...(page.cursor + detail.length < page.total
                ? { nextCursor: page.cursor + detail.length }
                : {}),
        };
        const rendered = formatWorkspaceDetailPage(candidate, maxOutputCharacters);
        if (rendered.length <= maxOutputCharacters) return candidate;
        if (detail.length <= 1) {
            throw new Error("Workspace detail cannot fit the configured model-output bound.");
        }
        const excess = Math.max(1, rendered.length - maxOutputCharacters);
        detail = detail.slice(0, Math.max(1, detail.length - excess));
    }
}

export function formatWorkspaceDetailPage(
    page: WorkspaceDetailResult,
    maxOutputCharacters: number,
): string {
    const header = `${page.workspace.name} — ${workspaceStatusText(page.workspace)}`;
    const full = [
        header,
        `Detail [${String(page.cursor)}/${String(page.total)}]: ${page.detail}`,
        ...(page.nextCursor === undefined
            ? []
            : [`More detail starts at cursor ${String(page.nextCursor)}.`]),
    ].join("\n");
    if (full.length <= maxOutputCharacters) return full;

    const compact = [
        page.workspace.name,
        `Detail: ${page.detail}`,
        ...(page.nextCursor === undefined ? [] : [`More detail: ${String(page.nextCursor)}.`]),
    ].join("\n");
    if (compact.length <= maxOutputCharacters) return compact;

    return [
        `Detail: ${page.detail}`,
        ...(page.nextCursor === undefined ? [] : [`More detail: ${String(page.nextCursor)}.`]),
    ].join("\n");
}

export function firstBranchMetadataPage(
    metadata: WorkspaceBranchMetadata,
): WorkspaceBranchMetadataPage {
    const detail = workspaceBranchMetadataDetailText(metadata);
    return {
        ...structuredClone(metadata),
        detail: detail.slice(0, MAX_WORKSPACE_BRANCH_METADATA_DETAIL_PAGE_SIZE),
        cursor: 0,
        total: detail.length,
        ...(detail.length > MAX_WORKSPACE_BRANCH_METADATA_DETAIL_PAGE_SIZE
            ? { nextCursor: MAX_WORKSPACE_BRANCH_METADATA_DETAIL_PAGE_SIZE }
            : {}),
    };
}

export function fitWorkspaceBranchMetadataPage(
    page: WorkspaceBranchMetadataPage,
    maxOutputCharacters: number,
): WorkspaceBranchMetadataPage {
    let detail = page.detail;
    for (;;) {
        const candidate: WorkspaceBranchMetadataPage = { ...page, detail };
        if (page.cursor + detail.length < page.total) {
            candidate.nextCursor = page.cursor + detail.length;
        } else {
            delete candidate.nextCursor;
        }
        const rendered = formatWorkspaceBranchMetadataPage(candidate, maxOutputCharacters);
        if (rendered.length <= maxOutputCharacters) return candidate;
        if (detail.length <= 1) {
            throw new Error(
                "Workspace branch metadata cannot fit the configured model-output bound.",
            );
        }
        const excess = Math.max(1, rendered.length - maxOutputCharacters);
        detail = detail.slice(0, Math.max(1, detail.length - excess));
    }
}

export function formatWorkspaceBranchMetadataPage(
    page: WorkspaceBranchMetadataPage,
    maxOutputCharacters: number,
): string {
    const full = [
        `${page.branch ?? "detached branch"}${page.detached ? " (detached)" : ""}`,
        `Detail [${String(page.cursor)}/${String(page.total)}]: ${page.detail}`,
        ...(page.nextCursor === undefined
            ? []
            : [`More detail starts at cursor ${String(page.nextCursor)}.`]),
    ].join("\n");
    if (full.length <= maxOutputCharacters) return full;

    const compact = [
        page.workspaceId,
        `Detail: ${page.detail}`,
        ...(page.nextCursor === undefined ? [] : [`More detail: ${String(page.nextCursor)}.`]),
    ].join("\n");
    if (compact.length <= maxOutputCharacters) return compact;

    return [
        `Detail: ${page.detail}`,
        ...(page.nextCursor === undefined ? [] : [`More detail: ${String(page.nextCursor)}.`]),
    ].join("\n");
}
