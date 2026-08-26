import { describe, expect, it } from 'vitest';
import {
    getNewSessionCommanderPickerOptionListMaxHeight,
    getNewSessionSidebarLayout,
} from './newSessionSidebarLayout';

describe('getNewSessionSidebarLayout', () => {
    it('enables the right sidebar on supported wide web layouts', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1200,
        })).toEqual({
            canShowSidebar: true,
            showSidebar: true,
            sidebarWidth: 360,
        });
    });

    it('disables the sidebar when the setting is off', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: false,
            zenMode: false,
            windowWidth: 1200,
        }).showSidebar).toBe(false);
    });

    it('disables the sidebar in zen mode', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: true,
            windowWidth: 1200,
        }).showSidebar).toBe(false);
    });

    it('disables the sidebar below the minimum width', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'web',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1099,
        }).showSidebar).toBe(false);
    });

    it('disables the sidebar on unsupported native platforms', () => {
        expect(getNewSessionSidebarLayout({
            platform: 'ios',
            isMac: false,
            fileDiffsSidebarEnabled: true,
            zenMode: false,
            windowWidth: 1400,
        }).showSidebar).toBe(false);
    });
});

describe('getNewSessionCommanderPickerOptionListMaxHeight', () => {
    it('bounds a long narrow-web commander list below its full option height', () => {
        const maxHeight = getNewSessionCommanderPickerOptionListMaxHeight({
            platform: 'web',
            embedded: false,
            windowHeight: 844,
        });

        expect(maxHeight).toBe(320);
        expect(maxHeight).toBeLessThan(10 * 44);
    });

    it('scales down with a shorter narrow-web viewport', () => {
        expect(getNewSessionCommanderPickerOptionListMaxHeight({
            platform: 'web',
            embedded: false,
            windowHeight: 480,
        })).toBe(216);
    });

    it('leaves the embedded desktop sidebar picker unchanged', () => {
        expect(getNewSessionCommanderPickerOptionListMaxHeight({
            platform: 'web',
            embedded: true,
            windowHeight: 844,
        })).toBeUndefined();
    });

    it('leaves native picker sizing unchanged', () => {
        expect(getNewSessionCommanderPickerOptionListMaxHeight({
            platform: 'ios',
            embedded: false,
            windowHeight: 844,
        })).toBeUndefined();
    });
});
