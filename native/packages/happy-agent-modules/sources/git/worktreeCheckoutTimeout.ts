/**
 * Creating or removing a worktree writes the whole working tree, so it needs the same generous
 * budget as a network command; the 5-second local default kills a large checkout mid-write.
 */
export const WORKTREE_CHECKOUT_TIMEOUT_MS = 5 * 60 * 1_000;
