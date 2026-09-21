import type { MarkdownWorkspaceProvenance } from './markdown/MarkdownView.types';
import type { InlineCommentAnchor } from './InlineCommentReview';

export type CanvasFileViewerProps = {
    content: string;
    sessionId: string;
    active?: boolean;
    workspaceProvenance?: MarkdownWorkspaceProvenance;
    relativeTo: string;
    workspaceImageRoot?: string | null;
    commentedNodeIds?: readonly string[];
    onNodeComment: (anchor: InlineCommentAnchor) => void;
};

export function CanvasFileViewer(_props: CanvasFileViewerProps) {
    return null;
}
