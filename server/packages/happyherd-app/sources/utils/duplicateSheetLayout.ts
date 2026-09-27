const HORIZONTAL_MARGIN = 16;
// A phone dialog (UI overhaul) spans the window less 8 px a side.
const PHONE_DIALOG_MARGIN = 8;
const MAX_WIDTH = 560;
const MAX_HEIGHT_RATIO = 0.85;
const NO_INSETS = { left: 0, right: 0 };

/**
 * `insets` are the window's side safe-area insets, such as a landscape
 * phone's notch. The sheet stays inside them, as `BaseModal` pads by them.
 */
export function getDuplicateSheetFrame(
    window: { width: number; height: number },
    phoneDialog = false,
    insets: { left: number; right: number } = NO_INSETS,
): { width: number; maxHeight: number } {
    const margin = phoneDialog ? PHONE_DIALOG_MARGIN : HORIZONTAL_MARGIN;
    const availableWidth = Math.max(0, Math.floor(window.width - insets.left - insets.right) - margin * 2);
    return {
        width: phoneDialog ? availableWidth : Math.min(MAX_WIDTH, availableWidth),
        maxHeight: Math.round(Math.floor(window.height) * MAX_HEIGHT_RATIO),
    };
}
