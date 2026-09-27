const HORIZONTAL_MARGIN = 16;
// A phone dialog (UI overhaul) spans the window less 8 px a side.
const PHONE_DIALOG_MARGIN = 8;
const MAX_WIDTH = 560;
const MAX_HEIGHT_RATIO = 0.85;

export function getDuplicateSheetFrame(
    window: { width: number; height: number },
    phoneDialog = false,
): { width: number; maxHeight: number } {
    const margin = phoneDialog ? PHONE_DIALOG_MARGIN : HORIZONTAL_MARGIN;
    const availableWidth = Math.max(0, Math.floor(window.width) - margin * 2);
    return {
        width: phoneDialog ? availableWidth : Math.min(MAX_WIDTH, availableWidth),
        maxHeight: Math.round(Math.floor(window.height) * MAX_HEIGHT_RATIO),
    };
}
