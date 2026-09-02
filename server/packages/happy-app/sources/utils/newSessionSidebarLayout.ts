export const NEW_SESSION_DESKTOP_MIN_WINDOW_WIDTH = 1100;
const COMMANDER_PICKER_MAX_HEIGHT = 320;
const COMMANDER_PICKER_VIEWPORT_RATIO = 0.45;

type NewSessionSidebarLayoutInput = {
    platform: 'web' | 'ios' | 'android' | 'macos' | 'windows';
    isMac: boolean;
    fileDiffsSidebarEnabled: boolean;
    zenMode: boolean;
    windowWidth: number;
};

export function getNewSessionSidebarLayout(input: NewSessionSidebarLayoutInput) {
    const canShowSidebar = input.fileDiffsSidebarEnabled
        && (input.isMac || input.platform === 'web')
        && input.windowWidth >= NEW_SESSION_DESKTOP_MIN_WINDOW_WIDTH;
    const showSidebar = canShowSidebar && !input.zenMode;
    const sidebarWidth = Math.min(Math.max(Math.floor(input.windowWidth * 0.3), 250), 360);

    return { canShowSidebar, showSidebar, sidebarWidth };
}

export function getNewSessionCommanderPickerOptionListMaxHeight(input: {
    platform: NewSessionSidebarLayoutInput['platform'];
    embedded: boolean;
    windowHeight: number;
}): number | undefined {
    if (input.platform !== 'web' || input.embedded) {
        return undefined;
    }

    return Math.min(
        COMMANDER_PICKER_MAX_HEIGHT,
        Math.floor(input.windowHeight * COMMANDER_PICKER_VIEWPORT_RATIO),
    );
}
