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
        canUseFilePanels: false,
        ...overrides,
    });
}

describe('resolveSessionSidebarPresentation', () => {
    it('keeps side chats in the wide sidebar when file panels are unavailable', () => {
        expect(presentation()).toEqual({
            fileSidebarAvailable: false,
            sideChatSidebarAvailable: true,
            sideChatSurface: 'sidebar',
            rightPanelPresentation: 'docked',
        });
    });

    it('slides the panels in as the same sheet on Web phones', () => {
        expect(presentation({ windowWidth: 390, canUseFilePanels: true })).toEqual({
            fileSidebarAvailable: true,
            sideChatSidebarAvailable: true,
            sideChatSurface: 'sidebar',
            rightPanelPresentation: 'overlay',
        });
        expect(presentation({ windowWidth: 320 }).sideChatSurface).toBe('sidebar');
    });

    it('keeps the full-screen path on native phones and iPad', () => {
        expect(presentation({ platform: 'ios', windowWidth: 1400 }).sideChatSurface).toBe('fullscreen');
        expect(presentation({ platform: 'ios', windowWidth: 390 })).toMatchObject({ sideChatSurface: 'fullscreen', rightPanelPresentation: 'docked' });
        expect(presentation({ platform: 'android', windowWidth: 412 }).sideChatSurface).toBe('fullscreen');
    });

    it('presents the same panels as an overlay sheet on desktop Web below 1100px', () => {
        expect(presentation({ windowWidth: 1099, canUseFilePanels: true })).toEqual({
            fileSidebarAvailable: true,
            sideChatSidebarAvailable: true,
            sideChatSurface: 'sidebar',
            rightPanelPresentation: 'overlay',
        });
        expect(presentation({ windowWidth: 1024 }).rightPanelPresentation).toBe('overlay');
        expect(presentation({ windowWidth: 1100 }).rightPanelPresentation).toBe('docked');
        // Native Mac keeps its existing boundary: no overlay frame.
        expect(presentation({
            platform: 'ios',
            runningOnMac: true,
            windowWidth: 1024,
            canUseFilePanels: true,
        })).toMatchObject({ fileSidebarAvailable: false, sideChatSurface: 'fullscreen', rightPanelPresentation: 'docked' });
    });

    it('keeps workspace links and zen mode from competing with the side-chat sidebar', () => {
        expect(presentation({ workspaceLinkPanelOpen: true }).sideChatSurface).toBe('fullscreen');
        expect(presentation({ zenMode: true }).sideChatSurface).toBe('fullscreen');
        expect(presentation({ zenMode: true, windowWidth: 1024 }).sideChatSurface).toBe('fullscreen');
    });

    it('keeps the eligible wide file workspace host available when file panels are supported', () => {
        expect(presentation({ canUseFilePanels: true }).fileSidebarAvailable).toBe(true);
        expect(presentation({ canUseFilePanels: false }).fileSidebarAvailable).toBe(false);
    });

    it('retains the width and platform boundary for the file workspace host', () => {
        expect(presentation({ platform: 'android', windowWidth: 412, canUseFilePanels: true }).fileSidebarAvailable).toBe(false);
        expect(presentation({ platform: 'ios', windowWidth: 1400, canUseFilePanels: true }).fileSidebarAvailable).toBe(false);
    });

    it('offers the same wide file workspace frame on Mac', () => {
        expect(presentation({
            platform: 'ios',
            runningOnMac: true,
            windowWidth: 1100,
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
