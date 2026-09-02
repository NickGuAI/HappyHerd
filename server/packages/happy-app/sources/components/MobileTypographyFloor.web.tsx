import * as React from 'react';

export const MOBILE_TYPOGRAPHY_MIN_FONT_SIZE = 16;

const FLOOR_CLASS = 'hh-mobile-typography-floor';
const FLOOR_MARKER = 'data-hh-mobile-typography-floor';
const STYLE_ID = 'hh-mobile-typography-floor-style';
const EXCLUDED_TAGS = new Set(['CANVAS', 'PATH', 'SCRIPT', 'STYLE', 'SVG']);
const TEXT_ENTRY_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
const ICON_FONT_PATTERN = /(?:icon|fontawesome|material|octicons)/iu;

let activePhoneHosts = 0;
let stopGlobalFloor: (() => void) | null = null;

function hasDirectVisibleText(element: HTMLElement): boolean {
    if (element.matches(TEXT_ENTRY_SELECTOR)) return true;
    return Array.from(element.childNodes).some((node) => (
        node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
    ));
}

function isEligibleTextElement(element: HTMLElement): boolean {
    if (EXCLUDED_TAGS.has(element.tagName) || !hasDirectVisibleText(element)) return false;
    const computed = getComputedStyle(element);
    if (computed.display === 'none' || computed.visibility === 'hidden') return false;
    return !ICON_FONT_PATTERN.test(computed.fontFamily);
}

function startGlobalFloor(): () => void {
    const target = document.body;
    const styleElement = document.createElement('style');
    styleElement.id = STYLE_ID;
    styleElement.textContent = `.${FLOOR_CLASS}{font-size:${MOBILE_TYPOGRAPHY_MIN_FONT_SIZE}px!important}`;
    document.head.appendChild(styleElement);

    const pending = new Set<HTMLElement>();
    const ownClassWrites = new WeakMap<HTMLElement, number>();
    let animationFrame: number | null = null;

    const noteOwnClassWrite = (element: HTMLElement) => {
        ownClassWrites.set(element, (ownClassWrites.get(element) ?? 0) + 1);
    };
    const removeFloor = (element: HTMLElement) => {
        if (element.classList.contains(FLOOR_CLASS)) {
            noteOwnClassWrite(element);
            element.classList.remove(FLOOR_CLASS);
        }
        element.removeAttribute(FLOOR_MARKER);
    };
    const enforceFloor = (element: HTMLElement) => {
        if (element.hasAttribute(FLOOR_MARKER)) removeFloor(element);
        if (!isEligibleTextElement(element)) return;
        const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
        if (!Number.isFinite(fontSize) || fontSize >= MOBILE_TYPOGRAPHY_MIN_FONT_SIZE) return;
        noteOwnClassWrite(element);
        element.classList.add(FLOOR_CLASS);
        element.setAttribute(FLOOR_MARKER, 'true');
    };
    const queueElement = (element: HTMLElement) => pending.add(element);
    const queueSubtree = (node: Node) => {
        if (!(node instanceof HTMLElement)) return;
        pending.add(node);
        node.querySelectorAll<HTMLElement>('*').forEach(queueElement);
    };
    const flush = () => {
        animationFrame = null;
        for (const element of pending) {
            if (element.isConnected && target.contains(element)) enforceFloor(element);
        }
        pending.clear();
    };
    const requestFlush = () => {
        if (animationFrame !== null) return;
        animationFrame = requestAnimationFrame(flush);
    };

    const observer = new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === 'childList') {
                if (record.target instanceof HTMLElement) queueElement(record.target);
                record.addedNodes.forEach(queueSubtree);
            } else if (record.type === 'characterData') {
                if (record.target.parentElement) queueElement(record.target.parentElement);
            } else if (record.target instanceof HTMLElement) {
                if (record.attributeName === 'class') {
                    const ownWrites = ownClassWrites.get(record.target) ?? 0;
                    if (ownWrites > 0) {
                        if (ownWrites === 1) ownClassWrites.delete(record.target);
                        else ownClassWrites.set(record.target, ownWrites - 1);
                        continue;
                    }
                }
                // A hidden portal being revealed may expose many descendants.
                queueSubtree(record.target);
            }
        }
        // Batch token-stream and React commits into one layout pass per frame.
        if (pending.size > 0) requestFlush();
    });
    observer.observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'contenteditable', 'hidden', 'placeholder', 'style'],
    });

    // Observe before the synchronous first pass so our own class writes are
    // consumed from ownClassWrites instead of masking the first external
    // class replacement that follows mount.
    queueSubtree(target);
    flush();

    const handleResize = () => {
        queueSubtree(target);
        requestFlush();
    };
    window.addEventListener('resize', handleResize, { passive: true });

    return () => {
        observer.disconnect();
        window.removeEventListener('resize', handleResize);
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        target.querySelectorAll<HTMLElement>(`.${FLOOR_CLASS}, [${FLOOR_MARKER}]`).forEach((element) => {
            element.classList.remove(FLOOR_CLASS);
            element.removeAttribute(FLOOR_MARKER);
        });
        styleElement.remove();
    };
}

function retainGlobalFloor(): () => void {
    activePhoneHosts += 1;
    if (activePhoneHosts === 1) stopGlobalFloor = startGlobalFloor();
    return () => {
        activePhoneHosts = Math.max(0, activePhoneHosts - 1);
        if (activePhoneHosts !== 0) return;
        stopGlobalFloor?.();
        stopGlobalFloor = null;
    };
}

/** Activates one document-wide phone route invariant, including RN Web portals. */
export function MobileTypographyFloor(props: { active: boolean; children: React.ReactNode }) {
    React.useLayoutEffect(() => (
        props.active ? retainGlobalFloor() : undefined
    ), [props.active]);
    return <>{props.children}</>;
}
