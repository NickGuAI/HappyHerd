import type { Metadata } from '@/sync/storageTypes';
import { parseExplicitSessionFileLink } from './sessionFileLinks';

export const WORKSPACE_LINK_ROUTE_PATHNAME = '/workspace' as const;

export type WorkspaceLinkRouteParams = Readonly<{
    mode: 'link';
    originSessionId: string;
    machineId: string;
    absolutePath: string;
    line?: string;
    column?: string;
}>;

export type WorkspaceLinkRoute = Readonly<{
    pathname: typeof WORKSPACE_LINK_ROUTE_PATHNAME;
    params: WorkspaceLinkRouteParams;
}>;

export type MarkdownWorkspaceImageReference = Readonly<{
    rootPath: string;
    workspaceRoute: WorkspaceLinkRoute;
}>;

type BuildWorkspaceLinkRouteInput = Readonly<{
    originSessionId: string;
    machineId: string;
    absolutePath: string;
    line?: number | null;
    column?: number | null;
}>;

export function buildWorkspaceLinkRoute(input: BuildWorkspaceLinkRouteInput): WorkspaceLinkRoute {
    return {
        pathname: WORKSPACE_LINK_ROUTE_PATHNAME,
        params: {
            mode: 'link',
            originSessionId: input.originSessionId,
            machineId: input.machineId,
            absolutePath: input.absolutePath,
            ...(input.line !== null && input.line !== undefined ? { line: String(input.line) } : {}),
            ...(input.column !== null && input.column !== undefined ? { column: String(input.column) } : {}),
        },
    };
}

type ResolveMarkdownWorkspaceLinkRouteInput = Readonly<{
    url: string;
    label?: string | null;
    originSessionId?: string | null;
    metadata?: Pick<Metadata, 'machineId' | 'path' | 'os' | 'homeDir'> | null;
}>;

type ResolvedMarkdownWorkspaceLink = Readonly<{
    originSessionId: string;
    machineId: string;
    rootPath: string;
    fileLink: NonNullable<ReturnType<typeof parseExplicitSessionFileLink>>;
}>;

function resolveMarkdownWorkspaceLink(
    input: ResolveMarkdownWorkspaceLinkRouteInput,
): ResolvedMarkdownWorkspaceLink | null {
    const { originSessionId, metadata } = input;
    if (
        !originSessionId?.trim()
        || !metadata?.machineId?.trim()
        || !metadata.path?.trim()
    ) {
        return null;
    }

    const fileLink = parseExplicitSessionFileLink(input.url, {
        label: input.label,
        sessionRoot: metadata.path,
        platform: metadata.os,
        homeDir: metadata.homeDir,
    });
    if (!fileLink) {
        return null;
    }

    return {
        originSessionId,
        machineId: metadata.machineId,
        rootPath: metadata.path,
        fileLink,
    };
}

/**
 * Resolve an explicit Markdown target using only immutable provenance from the
 * session that rendered it. The link target can select a path, but it cannot
 * select or override the owning session or machine.
 */
export function resolveMarkdownWorkspaceLinkRoute(
    input: ResolveMarkdownWorkspaceLinkRouteInput,
): WorkspaceLinkRoute | null {
    const resolved = resolveMarkdownWorkspaceLink(input);
    if (!resolved) return null;

    return buildWorkspaceLinkRoute({
        originSessionId: resolved.originSessionId,
        machineId: resolved.machineId,
        absolutePath: resolved.fileLink.absolutePath,
        line: resolved.fileLink.line,
        column: resolved.fileLink.column,
    });
}

/** Resolve inline image bytes only within the immutable originating workspace. */
export function resolveMarkdownWorkspaceImageReference(
    input: ResolveMarkdownWorkspaceLinkRouteInput,
): MarkdownWorkspaceImageReference | null {
    const resolved = resolveMarkdownWorkspaceLink(input);
    if (
        !resolved?.fileLink.withinSessionRoot
        || /^(?:[A-Za-z]:[/\\]|[/\\]|~(?:[/\\]|$))/.test(resolved.fileLink.path)
    ) {
        return null;
    }

    return {
        rootPath: resolved.rootPath,
        workspaceRoute: buildWorkspaceLinkRoute({
            originSessionId: resolved.originSessionId,
            machineId: resolved.machineId,
            absolutePath: resolved.fileLink.absolutePath,
        }),
    };
}
