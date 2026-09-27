import * as React from 'react';
import { Platform, type View } from 'react-native';

/** DOM attribute each glide-enabled row carries (`dataSet={{ herdRow: id }}`). */
export const HERD_ROW_ATTRIBUTE = 'data-herd-row';

let lastSelectedRowId: string | null = null;

/** Test hook: forget the previous selection. */
export function resetHerdSelectionGlide(): void {
    lastSelectedRowId = null;
}

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function findRow(id: string): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/"/g, '\\"');
    return document.querySelector<HTMLElement>(`[${HERD_ROW_ATTRIBUTE}="${escaped}"]`);
}

/**
 * The vertical offset a newly selected row's highlight should start from so
 * it appears to travel from the previous row. Null when the rows are not in
 * the same column (another list or pane), so the highlight simply appears.
 */
export function resolveSelectionGlideStart(
    from: { top: number; left: number; width: number; height: number },
    to: { top: number; left: number; width: number; height: number },
    viewportHeight: number,
): { offsetY: number; height: number } | null {
    if (Math.abs(from.left - to.left) > 1 || Math.abs(from.width - to.width) > 1) return null;
    const offsetY = from.top - to.top;
    if (offsetY === 0 || Math.abs(offsetY) > viewportHeight * 1.5) return null;
    return { offsetY, height: from.height };
}

/**
 * Web-only FLIP for the sidebar selection: when a row becomes selected, its
 * highlight starts over the previously selected row and glides into place
 * (the `.herd-glide` transition). Works across list virtualization because it
 * measures rows only at the moment selection changes.
 */
export function useHerdSelectionGlide(
    rowId: string,
    selected: boolean,
    highlightRef: React.RefObject<View | null>,
): void {
    React.useLayoutEffect(() => {
        if (Platform.OS !== 'web' || !selected) return;
        const previousId = lastSelectedRowId;
        lastSelectedRowId = rowId;
        const highlight = highlightRef.current as unknown as HTMLElement | null;
        if (!highlight || !previousId || previousId === rowId || prefersReducedMotion()) return;
        const previous = findRow(previousId);
        const current = findRow(rowId);
        if (!previous || !current) return;
        const start = resolveSelectionGlideStart(
            previous.getBoundingClientRect(),
            current.getBoundingClientRect(),
            window.innerHeight,
        );
        if (!start) return;

        const endHeight = current.getBoundingClientRect().height;
        highlight.style.transition = 'none';
        highlight.style.bottom = 'auto';
        highlight.style.height = `${start.height}px`;
        highlight.style.transform = `translateY(${start.offsetY}px)`;
        void highlight.offsetHeight;
        highlight.style.transition = '';
        highlight.style.transform = '';
        highlight.style.height = `${endHeight}px`;

        const settle = () => {
            highlight.style.height = '';
            highlight.style.bottom = '';
        };
        highlight.addEventListener('transitionend', settle, { once: true });
        const fallback = setTimeout(settle, 700);
        return () => {
            clearTimeout(fallback);
            highlight.removeEventListener('transitionend', settle);
            settle();
        };
    }, [highlightRef, rowId, selected]);
}
