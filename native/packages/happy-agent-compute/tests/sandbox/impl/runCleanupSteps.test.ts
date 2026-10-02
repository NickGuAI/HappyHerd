import { describe, expect, it, vi } from "vitest";

import { runCleanupSteps } from "../../../sources/sandbox/impl/runCleanupSteps.js";

describe("runCleanupSteps", () => {
    it("attempts every cleanup step before reporting failures", async () => {
        const laterCleanup = vi.fn(async () => {});

        await expect(
            runCleanupSteps("managed network", [
                async () => {
                    throw new Error("resource cleanup failed");
                },
                laterCleanup,
            ]),
        ).rejects.toThrow("Could not fully clean up managed network.");
        expect(laterCleanup).toHaveBeenCalledOnce();
    });
});
