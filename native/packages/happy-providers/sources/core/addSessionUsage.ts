import type { SessionUsage } from "@/core/SessionUsage.js";

export function addSessionUsage(
    left: SessionUsage | undefined,
    right: SessionUsage | undefined,
): SessionUsage | undefined {
    if (left === undefined) return right;
    if (right === undefined) return left;
    const input = left.input + right.input;
    const output = left.output + right.output;
    const cacheRead = left.cacheRead + right.cacheRead;
    const cacheWrite = left.cacheWrite + right.cacheWrite;
    return {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens: input + output,
    };
}
