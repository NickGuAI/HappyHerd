import { MAX_PROJECT_ORDER_KEY_LENGTH } from "../Project.js";

const ORDER_DIGITS = "0123456789";

/**
 * Creates the shortest decimal-fraction key strictly between two neighbouring
 * project-agent keys. Lexicographic order is the visible order.
 */
export function projectOrderKeyBetween(before: string | null, after: string | null): string {
    const lower = before ?? "";
    if (after !== null && lower >= after) {
        throw new Error("Project agent order keys are out of order.");
    }

    let prefix = "";
    for (let index = 0; ; index += 1) {
        const low = index < lower.length ? lower.charCodeAt(index) - 48 : 0;
        const high = after !== null && index < after.length ? after.charCodeAt(index) - 48 : 10;
        if (high - low > 1) {
            return checkedProjectAgentOrderKey(
                `${prefix}${ORDER_DIGITS[low + Math.floor((high - low) / 2)]}`,
            );
        }
        if (high - low === 1) {
            return checkedProjectAgentOrderKey(
                `${prefix}${ORDER_DIGITS[low]!}${projectAgentOrderKeyAbove(lower.slice(index + 1))}`,
            );
        }
        prefix += ORDER_DIGITS[low]!;
        if (prefix.length >= MAX_PROJECT_ORDER_KEY_LENGTH) {
            throw new Error("Project agent order key space is exhausted.");
        }
    }
}

function projectAgentOrderKeyAbove(rest: string): string {
    let prefix = "";
    for (let index = 0; ; index += 1) {
        const digit = index < rest.length ? rest.charCodeAt(index) - 48 : 0;
        if (digit < 9) {
            return `${prefix}${ORDER_DIGITS[digit + Math.floor((10 - digit) / 2)]!}`;
        }
        prefix += "9";
        if (prefix.length >= MAX_PROJECT_ORDER_KEY_LENGTH) {
            throw new Error("Project agent order key space is exhausted.");
        }
    }
}

function checkedProjectAgentOrderKey(key: string): string {
    if (key.length > MAX_PROJECT_ORDER_KEY_LENGTH) {
        throw new Error("Project agent order key space is exhausted.");
    }
    return key;
}
