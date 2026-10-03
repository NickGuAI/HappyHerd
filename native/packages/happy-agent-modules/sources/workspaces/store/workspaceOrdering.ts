import type { Workspace } from "../Workspace.js";

const ORDER_DIGITS = "0123456789";

/**
 * An order key strictly between two neighbours, read as decimal fractions so that lexicographic
 * order is the list order. Either end may be null, meaning the start or the end of the list.
 */
export function orderKeyBetween(before: string | null, after: string | null): string {
    const lower = before ?? "";
    if (after !== null && lower >= after) {
        throw new Error("Workspace order keys are out of order.");
    }
    let prefix = "";
    for (let index = 0; ; index += 1) {
        const low = index < lower.length ? lower.charCodeAt(index) - 48 : 0;
        const high = after !== null && index < after.length ? after.charCodeAt(index) - 48 : 10;
        if (high - low > 1) {
            return `${prefix}${ORDER_DIGITS[low + Math.floor((high - low) / 2)]!}`;
        }
        if (high - low === 1) {
            return `${prefix}${ORDER_DIGITS[low]!}${orderKeyAbove(lower.slice(index + 1))}`;
        }
        prefix += ORDER_DIGITS[low]!;
    }
}

/** The shortest key strictly above `rest` that still leaves room on both sides of itself. */
function orderKeyAbove(rest: string): string {
    let prefix = "";
    for (let index = 0; ; index += 1) {
        const digit = index < rest.length ? rest.charCodeAt(index) - 48 : 0;
        if (digit < 9) {
            return `${prefix}${ORDER_DIGITS[digit + Math.floor((10 - digit) / 2)]!}`;
        }
        prefix += "9";
    }
}

export function lowestOrderKey(workspaces: readonly Workspace[]): string | null {
    const sorted = [...workspaces].sort(byOrder);
    return sorted[0]?.orderKey ?? null;
}

export function byOrder(left: Workspace, right: Workspace): number {
    if (left.orderKey === right.orderKey) return left.id < right.id ? -1 : 1;
    return left.orderKey < right.orderKey ? -1 : 1;
}
