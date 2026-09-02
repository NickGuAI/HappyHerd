import type { WorkspaceFeedbackComment, WorkspaceFeedbackReference } from '@/sync/workspaceFeedback';

export type InlineCommentAnchor = Omit<WorkspaceFeedbackComment, 'id' | 'feedback'>;

export type InlineCommentReviewProps = {
    originSessionId: string;
    reference: WorkspaceFeedbackReference;
    activeAnchor: InlineCommentAnchor | null;
    comments: readonly WorkspaceFeedbackComment[];
    onActiveAnchorChange: (anchor: InlineCommentAnchor | null) => void;
    onCommentsChange: (comments: WorkspaceFeedbackComment[]) => void;
};

/** Inline review is intentionally web-only; native retains the existing single-feedback composer. */
export function InlineCommentReview(_props: InlineCommentReviewProps) {
    return null;
}
