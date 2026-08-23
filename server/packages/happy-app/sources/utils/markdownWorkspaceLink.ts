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
    metadata?: Pick<Metadata, 'machineId' | 'path'> | null;
}>;

/**
 * Resolve an explicit Markdown target using only immutable provenance from the
 * session that rendered it. The link target can select a path, but it cannot
 * select or override the owning session or machine.
 */
export function resolveMarkdownWorkspaceLinkRoute(
    input: ResolveMarkdownWorkspaceLinkRouteInput,
): WorkspaceLinkRoute | null {
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
    });
    if (!fileLink) {
        return null;
    }

    return buildWorkspaceLinkRoute({
        originSessionId,
        machineId: metadata.machineId,
        absolutePath: fileLink.absolutePath,
        line: fileLink.line,
        column: fileLink.column,
    });
}
