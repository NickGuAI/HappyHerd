import * as React from 'react';
import { Platform } from 'react-native';

/**
 * Number-key answers for pending permission cards on web (UI overhaul).
 *
 * One key press answers exactly one request: the oldest pending card that is
 * actually visible on screen. Hidden hosts (retained background sessions,
 * rows scrolled out of the chat list, display:none panels, cards covered by
 * an overlay), editable focus and open modal dialogs never receive the key,
 * so typing digits in the composer or a form cannot approve anything.
 */

export type PermissionShortcutKeyEvent = {
    key: string;
    repeat?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    isComposing?: boolean;
};

/** The zero-based choice a key press selects, or null when it is not a shortcut. */
export function resolvePermissionShortcutIndex(event: PermissionShortcutKeyEvent, choiceCount: number): number | null {
    if (event.repeat || event.isComposing) return null;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
    if (!/^[1-9]$/.test(event.key)) return null;
    const index = Number(event.key) - 1;
    return index < choiceCount ? index : null;
}

export type PermissionShortcutTarget = {
    id: string;
    /** Choice count and handlers are read at key time so they stay current. */
    getChoices: () => ReadonlyArray<() => void>;
    getNode: () => unknown;
};

const targets: PermissionShortcutTarget[] = [];
let listening = false;

function isEditableElement(element: Element | null): boolean {
    if (!element) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        return true;
    }
    return element instanceof HTMLElement && element.isContentEditable;
}

export type ShortcutRect = { left: number; top: number; right: number; bottom: number };

/** What remains of `rect` inside every clip box, or null when nothing does. */
export function clipShortcutRect(rect: ShortcutRect, clips: ReadonlyArray<ShortcutRect>): ShortcutRect | null {
    let { left, top, right, bottom } = rect;
    for (const clip of clips) {
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
    }
    return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** Nine points across `rect`, a little inside its edges. */
export function shortcutSamplePoints(rect: ShortcutRect): Array<[number, number]> {
    const across = (start: number, end: number) => {
        const inset = Math.min(4, (end - start) / 2);
        return [start + inset, (start + end) / 2, end - inset];
    };
    const xs = across(rect.left, rect.right);
    const ys = across(rect.top, rect.bottom);
    return xs.flatMap((x) => ys.map((y): [number, number] => [x, y]));
}

/** The viewport plus every ancestor that clips its overflow, per axis. */
function shortcutClipBoxes(node: HTMLElement): ShortcutRect[] {
    const boxes: ShortcutRect[] = [{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = window.getComputedStyle(parent);
        const clipsX = style.overflowX !== 'visible';
        const clipsY = style.overflowY !== 'visible';
        if (!clipsX && !clipsY) continue;
        const box = parent.getBoundingClientRect();
        boxes.push({
            left: clipsX ? box.left : -Infinity,
            right: clipsX ? box.right : Infinity,
            top: clipsY ? box.top : -Infinity,
            bottom: clipsY ? box.bottom : Infinity,
        });
    }
    return boxes;
}

/**
 * Visible means laid out, not hidden, not clipped away by a scrolling
 * ancestor such as the chat list, inside the viewport, and not covered: the
 * topmost element at one of nine points across what remains belongs to the
 * card. An overlay over the whole card hides it; a small control such as
 * "Jump to latest" over part of it does not.
 */
export function isShortcutNodeVisible(node: unknown): boolean {
    if (typeof window === 'undefined' || !(node instanceof HTMLElement)) return false;
    if (node.getClientRects().length === 0) return false;
    if (window.getComputedStyle(node).visibility === 'hidden') return false;
    const visible = clipShortcutRect(node.getBoundingClientRect(), shortcutClipBoxes(node));
    if (!visible) return false;
    return shortcutSamplePoints(visible).some(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && node.contains(hit);
    });
}

/** First registered (oldest) target that is visible. */
export function pickPermissionShortcutTarget(
    candidates: ReadonlyArray<PermissionShortcutTarget>,
    isVisible: (node: unknown) => boolean = isShortcutNodeVisible,
): PermissionShortcutTarget | null {
    for (const candidate of candidates) {
        if (candidate.getChoices().length > 0 && isVisible(candidate.getNode())) return candidate;
    }
    return null;
}

function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || targets.length === 0) return;
    if (isEditableElement(document.activeElement)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const target = pickPermissionShortcutTarget(targets);
    if (!target) return;
    const choices = target.getChoices();
    const index = resolvePermissionShortcutIndex(event, choices.length);
    if (index === null) return;
    event.preventDefault();
    choices[index]();
}

export function registerPermissionShortcutTarget(target: PermissionShortcutTarget): () => void {
    targets.push(target);
    if (!listening && typeof window !== 'undefined') {
        window.addEventListener('keydown', handleKeyDown);
        listening = true;
    }
    return () => {
        const index = targets.indexOf(target);
        if (index >= 0) targets.splice(index, 1);
        if (targets.length === 0 && listening && typeof window !== 'undefined') {
            window.removeEventListener('keydown', handleKeyDown);
            listening = false;
        }
    };
}

/**
 * Registers a pending permission card for number-key answers while `enabled`.
 * `choices` is read through a ref, so re-renders never re-register the card
 * and change its place in the queue.
 */
export function usePermissionShortcuts(options: {
    id: string;
    enabled: boolean;
    choices: ReadonlyArray<() => void>;
    nodeRef: React.RefObject<unknown>;
}) {
    const choicesRef = React.useRef(options.choices);
    choicesRef.current = options.choices;
    const { enabled, id, nodeRef } = options;
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !enabled) return;
        return registerPermissionShortcutTarget({
            id,
            getChoices: () => choicesRef.current,
            getNode: () => nodeRef.current,
        });
    }, [enabled, id, nodeRef]);
}
