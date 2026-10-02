/**
 * Files: read-mostly access to a workspace's folder.
 *
 * Every path is relative to the workspace root; absolute paths, `..`, and
 * symlinks escaping the root are rejected by the daemon.
 */

/** One result from ranked fuzzy workspace-file search. */
export interface FileMatch {
    path: string;
    fileName: string;
}

/** `GET /v0/workspaces/:workspaceId/files` query parameters. */
export interface FileSearchQuery {
    /** A fuzzy relative-path query. May be empty to list initial picker suggestions. */
    query: string;
    /** Maximum results, from 1 through 50. The daemon defaults to 50. */
    limit?: number;
}

/** `GET /v0/workspaces/:workspaceId/files` */
export interface FileSearchResponse {
    /** Best fuzzy match first. */
    files: FileMatch[];
}

/** One entry of a directory listing. */
export interface FileTreeEntry {
    name: string;
    path: string;
    type: "file" | "directory" | "symlink" | "other";
    size: number;
    modified: number;
}

/** `GET /v0/workspaces/:workspaceId/file-tree` query parameters. */
export interface FileTreeQuery {
    /** Defaults to the workspace root. */
    path?: string;
    cursor?: string;
    limit?: number;
}

/** `GET /v0/workspaces/:workspaceId/file-tree` */
export interface FileTreeResponse {
    entries: FileTreeEntry[];
    nextCursor: string | null;
}

/** `GET /v0/workspaces/:workspaceId/file` */
export interface FileContentResponse {
    /** Base64, because files are bytes and not necessarily text. */
    content: string;
    /** The sha256 hex digest, which is the write guard. */
    hash: string;
}

/** `PUT /v0/workspaces/:workspaceId/file` */
export interface WriteFileRequest {
    path: string;
    /** Base64 file content. */
    content: string;
    /**
     * The compare-and-swap: the sha256 the client read, or `null` to require
     * that the file not exist yet.
     */
    expectedHash: string | null;
}

/** `PUT /v0/workspaces/:workspaceId/file` */
export interface WriteFileResponse {
    hash: string;
}

/** `GET /v0/workspaces/:workspaceId/file-revision` query parameters. */
export interface FileRevisionQuery {
    path: string;
    /** A commit-ish. */
    revision: string;
}

/** `GET /v0/workspaces/:workspaceId/file-revision` */
export interface FileRevisionResponse {
    /** Base64 file content as of the revision. */
    content: string;
}
