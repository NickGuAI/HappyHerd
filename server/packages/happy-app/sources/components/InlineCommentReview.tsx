import type { WorkspaceFeedbackComment, WorkspaceFeedbackReference } from '@/sync/workspaceFeedback';

export type InlineCommentAnchor = Omit<WorkspaceFeedbackComment, 'id' | 'feedback'>;

export type InlineCommentReviewProps = {
    originSessionId: string;
    reference: WorkspaceFeedbackReference;
    activeAnchor: InlineCommentAnchor | null;
    comments: readonly WorkspaceFeedbackComment[];
    onActiveAnchorChange: (anchor: InlineCommentAnchor | null) => void;
    onCommentsChange: (comments: WorkspaceFeedbackComment[]) => void;
    /** Web file viewers render line threads in-place and keep only the batch bar docked. */
    mode?: 'docked' | 'bar';
};

export type InlineCommentThreadProps = Omit<InlineCommentReviewProps, 'originSessionId' | 'reference' | 'mode'> & {
    /** Restrict this thread to one source line. Omit it for docked element/node review. */
    anchor?: InlineCommentAnchor | null;
};

/** Inline review is intentionally web-only; native retains the existing single-feedback composer. */
export function InlineCommentReview(_props: InlineCommentReviewProps) {
    return null;
}

/** Line threads are web-only; native file review remains unchanged. */
export function InlineCommentThread(_props: InlineCommentThreadProps) {
    return null;
}
