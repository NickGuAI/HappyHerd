/** Git state: branch and sync facts plus the working tree's changes. */

import type { Cuid2, GitSummary, Timestamp } from "./common.js";

/** What happened to a single changed file. */
export type GitFileStatus =
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "conflicted"
    | "type_changed"
    | "submodule";

/** One changed file against the comparison base. */
export interface GitFileChange {
    path: string;
    status: GitFileStatus;
    staged: boolean;
    unstaged: boolean;
    binary: boolean;
    insertions: number;
    deletions: number;
}

/**
 * The git state object.
 *
 * Git state is computed rather than mutated, so it carries no version chain:
 * the newest snapshot simply replaces what a client held.
 */
export interface GitState {
    facts: GitSummary;
    /** `"unavailable"` when no sensible base exists yet; then only `facts` mean anything. */
    comparison: "ready" | "unavailable";
    /** What the changes are measured against. */
    base: string | null;
    changedFiles: number;
    insertions: number;
    deletions: number;
    /** `false` when a large tree made the daemon estimate. */
    countsExact: boolean;
    conflicted: boolean;
    files: GitFileChange[];
    /** `true` when the file list was capped. */
    filesTruncated: boolean;
    scannedAt: Timestamp;
}

/** `GET /v0/workspaces/:workspaceId/git` */
export interface GitStateResponse {
    git: GitState;
}

/** `POST /v0/git/watch` */
export interface WatchGitRequest {
    workspaceIds: Cuid2[];
}

/**
 * `POST /v0/git/watch`
 *
 * Whatever the watcher already knows for the requested workspaces. A repository
 * it has not scanned yet is simply absent, and its first `git.updated` event
 * follows shortly.
 */
export interface WatchGitResponse {
    snapshots: Record<string, GitState>;
}
