import type { Metadata } from '@/sync/storageTypes';
import type { AcpInlineImageOverrides } from '@/utils/acpInlineImages';
import type { WorkspaceLinkRoute } from '@/utils/markdownWorkspaceLink';

export type Option = { title: string };

export type MarkdownWorkspaceProvenance = Pick<Metadata, 'machineId' | 'path' | 'os' | 'homeDir'>;

export type MarkdownLineCommentAnchor = Readonly<{
    line: number;
    column?: number;
}>;

export type MarkdownViewProps = {
    markdown: string;
    onOptionPress?: (option: Option) => void;
    sessionId?: string;
    enableWorkspaceLinks?: boolean;
    onWorkspaceLinkPress?: (route: WorkspaceLinkRoute) => void;
    inlineImages?: AcpInlineImageOverrides;
    externalCopyHandler?: boolean;
    /** Trusted host provenance for machine-scoped viewers. Link text can never override it. */
    workspaceProvenance?: MarkdownWorkspaceProvenance;
    /** Directory containing the rendered Markdown file. */
    relativeTo?: string;
    /** Explicit trusted session root for inline images; null fails closed. */
    workspaceImageRoot?: string | null;
    /** Web file viewer only: expose a gutter affordance at source-positioned blocks. */
    onLineComment?: (anchor: MarkdownLineCommentAnchor) => void;
};

const OPTION_LINK_PREFIX = '#happyherd-option:';

export function encodeMarkdownOptions(markdown: string): string {
    return markdown.replace(/<options>\s*([\s\S]*?)\s*<\/options>/giu, (_match, body: string) => {
        const items = Array.from(body.matchAll(/<option>([\s\S]*?)<\/option>/giu))
            .map((match) => match[1].trim())
            .filter(Boolean);
        if (!items.length) return '';
        const list = items
            .map((item) => `- [${item.replace(/[\[\]]/g, '\\$&')}](${OPTION_LINK_PREFIX}${encodeURIComponent(item)})`)
            .join('\n');
        // Comments keep adjacent ordinary bullets in a separate list without shifting source lines.
        return `<!--happyherd-options-start-->\n${list}\n<!--happyherd-options-end-->`;
    });
}

export function decodeMarkdownOption(url: string | undefined): string | null {
    if (!url?.startsWith(OPTION_LINK_PREFIX)) return null;
    try {
        return decodeURIComponent(url.slice(OPTION_LINK_PREFIX.length));
    } catch {
        return null;
    }
}
