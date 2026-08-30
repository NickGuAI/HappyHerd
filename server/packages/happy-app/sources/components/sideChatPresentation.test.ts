import { describe, expect, it } from 'vitest';

import {
    resolveActiveSideChatId,
    resolveSideChatSelectionAfterClose,
    resolveSessionSidebarPresentation,
    shouldShowLandscapeSideChatAccess,
} from './sideChatPresentation';

function presentation(overrides: Partial<Parameters<typeof resolveSessionSidebarPresentation>[0]> = {}) {
    return resolveSessionSidebarPresentation({
        platform: 'web',
        runningOnMac: false,
        windowWidth: 1100,
        zenMode: false,
        workspaceLinkPanelOpen: false,
        fileDiffsSidebarEnabled: false,
        canUseFilePanels: false,
        ...overrides,
    });
}

describe('resolveSessionSidebarPresentation', () => {
    it('keeps side chats in the wide sidebar without the default-off file-diff feature', () => {
        expect(presentation()).toEqual({
            fileSidebarAvailable: false,
            sideChatSidebarAvailable: true,
            sideChatSurface: 'sidebar',
        });
    });

    it('uses the full-screen path below 1100px and on native phones', () => {
        expect(presentation({ windowWidth: 1099 }).sideChatSurface).toBe('fullscreen');
        expect(presentation({ platform: 'ios', windowWidth: 1400 }).sideChatSurface).toBe('fullscreen');
    });

    it('keeps workspace links and zen mode from competing with the side-chat sidebar', () => {
        expect(presentation({ workspaceLinkPanelOpen: true }).sideChatSurface).toBe('fullscreen');
        expect(presentation({ zenMode: true }).sideChatSurface).toBe('fullscreen');
    });

    it('preserves the existing file-panel feature and capability gates', () => {
        expect(presentation({ fileDiffsSidebarEnabled: true, canUseFilePanels: true }).fileSidebarAvailable).toBe(true);
        expect(presentation({ fileDiffsSidebarEnabled: true, canUseFilePanels: false }).fileSidebarAvailable).toBe(false);
    });

    it('offers the same wide file workspace frame on Mac', () => {
        expect(presentation({
            platform: 'ios',
            runningOnMac: true,
            windowWidth: 1100,
            fileDiffsSidebarEnabled: true,
            canUseFilePanels: true,
        }).fileSidebarAvailable).toBe(true);
    });
});

describe('resolveActiveSideChatId', () => {
    it('keeps a live selection and otherwise focuses the newest child', () => {
        expect(resolveActiveSideChatId(['first', 'second'], 'first')).toBe('first');
        expect(resolveActiveSideChatId(['first', 'second'], 'archived')).toBe('second');
        expect(resolveActiveSideChatId(['first', 'second'], null)).toBe('second');
        expect(resolveActiveSideChatId([], 'first')).toBeNull();
    });
});

describe('resolveSideChatSelectionAfterClose', () => {
    it('keeps the focused child when a background tab closes', () => {
        expect(resolveSideChatSelectionAfterClose(['first', 'second', 'third'], 'third', 'first'))
            .toBe('third');
    });

    it('selects a neighbour only when the focused child closes', () => {
        expect(resolveSideChatSelectionAfterClose(['first', 'second', 'third'], 'second', 'second'))
            .toBe('first');
        expect(resolveSideChatSelectionAfterClose(['only'], 'only', 'only')).toBeNull();
    });
});

describe('shouldShowLandscapeSideChatAccess', () => {
    it('keeps externally created children reachable when native landscape hides the chat header', () => {
        expect(shouldShowLandscapeSideChatAccess({
            platform: 'ios',
            deviceType: 'phone',
            isLandscape: true,
            sideChatCount: 1,
            canCreateSideChat: false,
        })).toBe(true);
        expect(shouldShowLandscapeSideChatAccess({
            platform: 'web',
            deviceType: 'phone',
            isLandscape: true,
            sideChatCount: 1,
            canCreateSideChat: false,
        })).toBe(false);
        expect(shouldShowLandscapeSideChatAccess({
            platform: 'ios',
            deviceType: 'phone',
            isLandscape: true,
            sideChatCount: 0,
            canCreateSideChat: true,
        })).toBe(true);
    });
});
