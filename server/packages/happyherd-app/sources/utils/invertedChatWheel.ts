/**
 * Correct FlashList's inverted web axis, following f-liva's fix in PR #1767.
 * Unlike RN Web's FlatList, FlashList 2.3.1 does not compensate wheel deltas
 * for its flipped outer wrapper. Remove this correction if it gains one.
 * Upstream context: Shopify/flash-list#558, #1351, #1511.
 * Returns true only when the gesture belongs to the chat, not a child or zoom.
 */
export function handleInvertedChatWheel(node: HTMLElement, event: WheelEvent): boolean {
    if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.shiftKey) return false;

    // Shift-wheel belongs to the browser's horizontal gesture contract.
    const delta = event.deltaY;
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(event.deltaX) > Math.abs(delta)) return false;

    const view = node.ownerDocument.defaultView;
    if (!view) return false;
    // Inspect the real event path, including shadow-root descendants. A child
    // owns its native vertical scroll until its edge; contain/none owns the
    // edge too. Shift gestures over horizontal content must stay horizontal.
    const path = event.composedPath();
    if (!path.includes(node)) return false;
    for (const target of path) {
        if (target === node) break;
        if ((target as Node).nodeType !== 1) continue;
        const child = target as HTMLElement;
        const style = view.getComputedStyle(child);
        if (!/^(auto|scroll)$/.test(style.overflowY)) continue;
        if (style.overscrollBehaviorY === 'contain' || style.overscrollBehaviorY === 'none') return false;
        const max = child.scrollHeight - child.clientHeight;
        if (max <= 0) continue;
        const canScroll = delta < 0 ? child.scrollTop > 0 : child.scrollTop < max;
        if (canScroll) return false;
    }

    let pixels = delta;
    if (event.deltaMode === 1) {
        const style = view.getComputedStyle(node);
        const lineHeight = Number.parseFloat(style.lineHeight);
        pixels *= lineHeight > 0 ? lineHeight : 16;
    } else if (event.deltaMode === 2) {
        pixels *= node.clientHeight;
    } else if (event.deltaMode !== 0) {
        return false;
    }

    // Cancel even at a chat boundary: letting the native default run there
    // would move back into history in the opposite direction.
    event.preventDefault();
    node.scrollTop = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, node.scrollTop - pixels));
    return true;
}